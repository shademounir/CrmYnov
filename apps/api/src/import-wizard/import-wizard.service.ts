import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";

export const IMPORT_WIZARD_STEPS = ["FILE", "SHEET", "PROFILE", "MAPPING", "PREVIEW", "QUALITY", "ASSIGNMENT", "DRY_RUN", "CONFIRMATION", "REPORT"] as const;
export const IMPORT_WIZARD_PROFILES = ["FORMINATOR_ZAPIER", "YNOV_MA_LEGACY", "YNOV_COM", "JOBINTECH", "LEGACY_RELAUNCH", "CUSTOM_CONTROLLED"] as const;
export type ImportWizardProfile = typeof IMPORT_WIZARD_PROFILES[number];

export interface StartImportWizardInput { profile: ImportWizardProfile; fileName: string; fileSha256: string }
export interface ReconcileImportWizardInput {
  profileId: string; sheetName: string; mappingId: string; mappingVersion: number;
  previewed: boolean; requiredFieldsValid: boolean; countersReconciled: boolean;
  collisionsResolved: boolean; assignmentReconciled: boolean; dryRunMutated: false;
}
export interface ImportWizardSession {
  id: string; profile: ImportWizardProfile; fileName: string; fileSha256: string; currentStep: typeof IMPORT_WIZARD_STEPS[number];
  confirmationToken?: string; confirmed: boolean; mutated: false; rawFileRetained: false;
}

const SAFE_FILE = /^[a-z0-9][a-z0-9._ -]{0,119}\.(csv|xlsx)$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{2,79}$/i;

@Injectable()
export class ImportWizardService {
  private readonly sessions = new Map<string, ImportWizardSession>();

  start(input: StartImportWizardInput, principal: Principal): ImportWizardSession {
    this.assertOperator(principal);
    if (!input || !IMPORT_WIZARD_PROFILES.includes(input.profile) || !SAFE_FILE.test(input.fileName) || input.fileName.includes("..") || !SHA256.test(input.fileSha256))
      throw new BadRequestException({ code: "import_wizard_start_invalid" });
    const session: ImportWizardSession = { id: randomUUID(), profile: input.profile, fileName: input.fileName,
      fileSha256: input.fileSha256, currentStep: "FILE", confirmed: false, mutated: false, rawFileRetained: false };
    this.sessions.set(session.id, session); return { ...session };
  }

  reconcile(id: string, input: ReconcileImportWizardInput, principal: Principal): ImportWizardSession {
    this.assertOperator(principal); const session = this.required(id);
    if (!input || !SAFE_ID.test(input.profileId) || input.sheetName.trim().length === 0 || input.sheetName.length > 120
      || !SAFE_ID.test(input.mappingId) || !Number.isInteger(input.mappingVersion) || input.mappingVersion < 1 || input.dryRunMutated !== false)
      throw new BadRequestException({ code: "import_wizard_evidence_invalid" });
    const gates = [input.previewed, input.requiredFieldsValid, input.countersReconciled, input.collisionsResolved, input.assignmentReconciled];
    if (gates.some((gate) => gate !== true)) throw new ConflictException({ code: "import_wizard_not_reconciled" });
    const confirmationToken = createHash("sha256").update(`${session.id}:${session.fileSha256}:${input.mappingId}:${input.mappingVersion}`).digest("hex");
    const updated = { ...session, currentStep: "CONFIRMATION" as const, confirmationToken };
    this.sessions.set(id, updated); return { ...updated };
  }

  confirm(id: string, confirmationToken: string, principal: Principal): ImportWizardSession {
    this.assertOperator(principal); const session = this.required(id);
    if (session.currentStep !== "CONFIRMATION" || !session.confirmationToken || confirmationToken !== session.confirmationToken)
      throw new ConflictException({ code: "import_wizard_confirmation_refused" });
    const completed = { ...session, currentStep: "REPORT" as const, confirmed: true, mutated: false as const, rawFileRetained: false as const };
    this.sessions.set(id, completed); return { ...completed };
  }

  get(id: string, principal: Principal): ImportWizardSession { this.assertOperator(principal); return { ...this.required(id) }; }
  private required(id: string): ImportWizardSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new NotFoundException({ code: "import_wizard_not_found" });
    }
    return session;
  }
  private assertOperator(principal: Principal): void {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "import_wizard_forbidden" });
  }
}
