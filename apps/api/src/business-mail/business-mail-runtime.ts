import type { PrismaClient, Prisma } from "@prisma/client";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { BUSINESS_MAIL_CONFIGURATION_ID, parseBusinessMailSettings } from "./business-mail-settings.js";
import { currentMailFacts, discoverMailCandidates, estimateHeldMailBacklog, type MailCandidate } from "./business-mail-facts.js";
import { currentMailRecipients } from "./business-mail-recipients.js";
import { prepareBusinessMail, type BusinessMailPolicy, type PreparedBusinessMail } from "./business-mail-policy.js";
import { businessMailEvidence } from "./business-mail-evidence.js";
import { BusinessMailJournal } from "./business-mail-journal.js";
import { GmailBusinessMailSender } from "./gmail-business-mail.sender.js";
import { mailStage } from "../permissions/safe-mail-diagnostic.js";

export interface MailRuntimeReport { configurationVersion: number; proposedActivationAt: string | null; inspected: number; prepared: number; accepted: number; uncertain: number; recipientDeliveries: number; held: Record<string, number>; byType: Record<string, number>; byScope: Record<string, number>; roster: Record<string, number> }
export const emptyMailReport = (): MailRuntimeReport => ({ configurationVersion: 0, proposedActivationAt: null, inspected: 0, prepared: 0, accepted: 0, uncertain: 0, recipientDeliveries: 0, held: {}, byType: {}, byScope: {}, roster: {} });
const hold = (report: MailRuntimeReport, reason: string): void => { report.held[reason] = (report.held[reason] ?? 0) + 1; };
export interface BusinessMailTransport { configured(): boolean; sendPrepared(message: PreparedBusinessMail, signal: AbortSignal): Promise<{ providerMessageId: string }> }

/** Dedicated external worker only. No AppModule, invitation or generic outbox hook.
 * Each irreversible call remains inside the real shared permission/closure fences;
 * its journal uses a separate root transaction and never retries a send. */
export class BusinessMailRuntime {
  constructor(private readonly client: PrismaClient, private readonly permissions: DynamicPermissionRepository,
    private readonly journal: BusinessMailJournal, private readonly sender: BusinessMailTransport = new GmailBusinessMailSender(),
    private readonly origin = process.env.CRM_PUBLIC_ORIGIN ?? "") {}

  async run(mode: "PREFLIGHT" | "SEND", signal = AbortSignal.timeout(240000)): Promise<MailRuntimeReport> {
    const report = emptyMailReport();
    signal.throwIfAborted();
    const configuration = await mailStage("CONFIGURATION_READ", () => this.client.businessMailConfiguration.findUnique({ where: { id: BUSINESS_MAIL_CONFIGURATION_ID } }));
    if (!configuration) { hold(report, "CONFIGURATION_MISSING"); return report; }
    if (mode === "SEND" && (!configuration.enabled || !configuration.activatedAt || !configuration.qualificationKey)) { hold(report, "DISABLED"); return report; }
    if (mode === "SEND" && !this.sender.configured()) throw new Error("business_mail_transport_unconfigured");
    const settings = parseBusinessMailSettings(configuration.settings);
    const clock = await this.client.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const now = clock[0]!.now;
    const baseline = configuration.activatedAt ?? now;
    report.configurationVersion = configuration.version; report.proposedActivationAt = baseline.toISOString();
    const options = { businessMailFence: { signal } };
    const candidates = await mailStage("DISCOVERY_FENCE", () => this.permissions.readTransaction(tx => discoverMailCandidates(tx, settings, baseline, now), options));
    if (mode === "PREFLIGHT") await mailStage("DISCOVERY_FENCE", () => this.permissions.readTransaction(async tx => {
      report.held = await estimateHeldMailBacklog(tx, settings, baseline);
      const members = await tx.collaborator.findMany({ where: { id: { in: settings.memberUserIds } }, select: { active: true, firstLoginRequired: true } });
      report.roster = { configuredAccounts: settings.memberUserIds.length, configuredMemberships: await tx.businessMailMembership.count({ where: { campusId: settings.campusId, campaignId: { in: settings.campaignIds }, active: true } }),
        activatedAccounts: members.filter(row => row.active && !row.firstLoginRequired).length, firstLoginPending: members.filter(row => row.active && row.firstLoginRequired).length,
        inactiveOrUnavailable: settings.memberUserIds.length - members.filter(row => row.active).length };
    }, options));
    signal.throwIfAborted();
    if (mode === "SEND") await mailStage("RETAIN_INTERRUPTED", () => this.journal.retainInterrupted(new Date(now.valueOf() - 300000)));
    for (const candidate of candidates) {
      signal.throwIfAborted();
      await this.inspect(candidate, mode, signal, report);
    }
    return report;
  }

  private async inspect(candidate: MailCandidate, mode: "PREFLIGHT" | "SEND", signal: AbortSignal, report: MailRuntimeReport): Promise<void> {
    await mailStage("CANDIDATE_FENCE", () => this.permissions.transaction(async tx => {
      signal.throwIfAborted();
      // Waiting for the initial fence must not consume a fresh candidate's
      // bounded action window. The original global deadline is never reset.
      const candidateSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
      await mailStage("CANDIDATE_FACTS", async () => {
      report.inspected++;
      const configuration = await tx.businessMailConfiguration.findUniqueOrThrow({ where: { id: BUSINESS_MAIL_CONFIGURATION_ID } });
      if (configuration.version !== report.configurationVersion) throw new Error("business_mail_configuration_changed_during_scan");
      if (mode === "SEND" && (!configuration.enabled || !configuration.activatedAt || !configuration.qualificationKey)) { hold(report, "DISABLED"); return; }
      if (mode === "SEND" && (await tx.businessMailDelivery.findUnique({ where: { key: configuration.qualificationKey! }, select: { status: true } }))?.status !== "ACCEPTED") { hold(report, "TRANSPORT_NOT_QUALIFIED"); return; }
      const settings = parseBusinessMailSettings(configuration.settings);
      const clock = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const generatedAt = clock[0]!.now;
      const facts = await currentMailFacts(tx, candidate, settings);
      if (!facts) { hold(report, "CURRENT_FACTS_OR_SCOPE_UNAVAILABLE"); return; }
      const recipients = await currentMailRecipients(tx, facts, candidate.leadId, await this.permissions.snapshots(tx));
      const policy: BusinessMailPolicy = { enabled: mode === "PREFLIGHT" || configuration.enabled, activatedAt: configuration.activatedAt ?? generatedAt, generatedAt,
        warningCadenceHours: settings.warningCadenceHours, maximumWarnings: settings.maximumWarnings };
      const prepared = prepareBusinessMail(facts, policy, recipients.members, recipients.owners);
      if (prepared.status === "HELD") { hold(report, prepared.reason); return; }
      if (await tx.businessMailDelivery.findUnique({ where: { key: prepared.message.key }, select: { key: true } })) { hold(report, "ALREADY_RETAINED_NO_REPLAY"); return; }
      report.prepared++; report.byType[facts.type] = (report.byType[facts.type] ?? 0) + 1;
      const scope = facts.scope.campusId + "/" + facts.scope.campaignId; report.byScope[scope] = (report.byScope[scope] ?? 0) + 1;
      report.recipientDeliveries += prepared.message.recipientUserIds.length;
      if (mode === "PREFLIGHT") return;
      await this.emit(tx, facts.resourceId, facts.scope, prepared.message, settings, candidateSignal, report);
      });
    }, "read-audited", { businessMailFence: { signal } }));
  }

  private async emit(tx: Prisma.TransactionClient, resourceId: string, scope: { campusId: string; campaignId: string | null }, message: PreparedBusinessMail,
    limits: Parameters<BusinessMailJournal["reserveSending"]>[0]["limits"], signal: AbortSignal, report: MailRuntimeReport): Promise<void> {
    signal.throwIfAborted();
    const evidence = businessMailEvidence(message, scope, this.origin);
    const reservation = await mailStage("JOURNAL_RESERVATION", () => this.journal.reserveSending({ key: message.key, eventType: message.type, resourceId, templateVersion: message.templateVersion, ...evidence, limits }));
    if (!reservation.reserved) { hold(report, "reason" in reservation ? reservation.reason : "ALREADY_RETAINED_NO_REPLAY"); return; }
    // Check the outer transaction and caller deadline after the independent commit.
    // A failed fence/deadline after SENDING is uncertain, never a free retry token.
    let transportAccepted = false;
    try {
      await tx.$queryRaw`SELECT 1`;
      signal.throwIfAborted();
      const result = await mailStage("TRANSPORT", () => this.sender.sendPrepared(message, signal));
      transportAccepted = true;
      if (!await mailStage("JOURNAL_ACCEPTANCE", () => this.journal.accepted(message.key, reservation.token, result.providerMessageId))) throw new Error("business_mail_acceptance_commit_unconfirmed");
      report.accepted++;
    } catch {
      report.uncertain++;
      await mailStage("JOURNAL_UNCERTAIN", () => this.journal.uncertain(message.key, reservation.token, transportAccepted ? "ACCEPTANCE_COMMIT_UNCONFIRMED" : "TRANSPORT_UNCONFIRMED"));
    }
  }
}
