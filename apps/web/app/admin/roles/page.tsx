"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, FloppyDisk, ShieldCheck } from "@phosphor-icons/react";
import { PageHeader } from "../../_components/ui/page-header";
import { StatCard } from "../../_components/ui/stat-card";
import { StatusBadge } from "../../_components/ui/status-badge";
import { PermissionEditor } from "./permission-editor";
import { ChangePreview, EffectivePermissions, PermissionHistory } from "./permission-evidence";
import { ConfigurationImpact, DashboardGuidance } from "./permission-guidance";
import { TeamResponsibilities } from "./team-responsibilities";
import { draftChanges, permissionRequest, type Catalogue, type Configuration, type Explanation, type Preview, type Scope, type Version } from "./permission-types";

export default function RolesPage(): React.JSX.Element {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [campus, setCampus] = useState(""); const [role, setRole] = useState("MANAGER");
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [grants, setGrants] = useState<Record<string, Scope>>({});
  const [versions, setVersions] = useState<Version[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [leadId, setLeadId] = useState("");
  const [leadOptions, setLeadOptions] = useState<Array<{ id: string; leadCode: string; firstName: string; lastName: string }>>([]);
  const [reason, setReason] = useState("ACCESS_REVIEW");
  const [confirmed, setConfirmed] = useState(false); const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [revision, setRevision] = useState(0);
  const contextGeneration = useRef(0);
  const operationGeneration = useRef(0);
  const operationController = useRef<AbortController | null>(null);
  useEffect(() => (): void => { contextGeneration.current += 1; operationController.current?.abort(); }, []);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const generation = ++contextGeneration.current;
    operationController.current?.abort();
    setBusy(true); setPreview(null); setConfirmed(false); setConfiguration(null); setRestoreVersion(null); setExplanation(null); setError("");
    setGrants({}); setVersions([]); setLeadId(""); setLeadOptions([]);
    const cataloguePath = campus ? "catalogue?campus=" + encodeURIComponent(campus) : "catalogue";
    void permissionRequest<Catalogue>(cataloguePath, undefined, controller.signal).then(async (data) => {
      const query = new URLSearchParams({ campus: data.campus, role, kind: role === "*" ? "CEILING" : "ROLE" });
      const [config, history] = await Promise.all([permissionRequest<Configuration>(`configuration?${query}`, undefined, controller.signal), permissionRequest<{ versions: Version[] }>(`history?${query}`, undefined, controller.signal)]);
      if (current && contextGeneration.current === generation) { setCatalogue(data); setConfiguration(config); setGrants({ ...config.grants }); setVersions(history.versions); setBusy(false); }
    }).catch((error_: unknown) => { if (current && contextGeneration.current === generation && !controller.signal.aborted) { setError(message(error_)); setBusy(false); } });
    return (): void => { current = false; controller.abort(); };
  }, [campus, role, revision]);
  useEffect(() => {
    if (!configuration) { setLeadOptions([]); return; }
    const controller = new AbortController();
    const query = new URLSearchParams({ page: "1", pageSize: "100" });
    void fetch(`/api/crm/leads?${query}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("leads_unavailable"); const body = await response.json() as { items?: unknown }; if (controller.signal.aborted) return; const items = Array.isArray(body.items) ? body.items : []; setLeadOptions(items.flatMap((item): Array<{ id: string; leadCode: string; firstName: string; lastName: string }> => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && typeof (item as { leadCode?: unknown }).leadCode === "string" ? [{ id: (item as { id: string }).id, leadCode: (item as { leadCode: string }).leadCode, firstName: typeof (item as { firstName?: unknown }).firstName === "string" ? (item as { firstName: string }).firstName : "", lastName: typeof (item as { lastName?: unknown }).lastName === "string" ? (item as { lastName: string }).lastName : "" }] : [])); })
      .catch((failure: unknown) => { if (!controller.signal.aborted && !(failure instanceof DOMException && failure.name === "AbortError")) setLeadOptions([]); });
    return (): void => controller.abort();
  }, [configuration]);
  const editable = Boolean(catalogue && (catalogue.global || catalogue.roles.find((item) => item.role === role)?.editable));
  const changedCount = catalogue && configuration ? draftChanges(catalogue.catalogue, configuration, grants) : 0;
  const selectedRole = catalogue?.roles.find((item) => item.role === role);
  function payload(): Record<string, unknown> {
    if (!configuration) throw new Error("Rechargez la configuration avant de continuer.");
    return { kind: configuration.kind, role: configuration.role, campus: configuration.campus, expectedVersion: configuration.version, grants, reason, confirmed };
  }
  function invalidateContext(): void {
    contextGeneration.current += 1; operationController.current?.abort();
    setConfiguration(null); setPreview(null); setConfirmed(false); setExplanation(null); setRestoreVersion(null); setSuccess(""); setBusy(true);
  }
  function invalidateOperation(): void {
    operationGeneration.current += 1;
    if (operationController.current) { operationController.current.abort(); operationController.current = null; setBusy(false); }
  }
  async function operation(action: (isCurrent: () => boolean, signal: AbortSignal) => Promise<void>): Promise<void> {
    operationController.current?.abort();
    const controller = new AbortController(); operationController.current = controller;
    const context = contextGeneration.current, generation = ++operationGeneration.current;
    const isCurrent = (): boolean => !controller.signal.aborted && contextGeneration.current === context && operationGeneration.current === generation;
    setBusy(true); setError(""); setSuccess("");
    try { await action(isCurrent, controller.signal); } catch (error_) { if (isCurrent()) { setError(message(error_)); setPreview(null); setConfirmed(false); } } finally { if (isCurrent()) { setBusy(false); operationController.current = null; } }
  }
  function updateGrant(key: string, value: Scope): void { invalidateOperation(); setGrants((current) => ({ ...current, [key]: value })); setPreview(null); setConfirmed(false); setSuccess(""); }
  async function save(): Promise<void> {
    await operation(async (isCurrent, signal) => { await permissionRequest("configuration", payload(), signal); if (isCurrent()) { setSuccess("Nouvelle version enregistrée et auditée. Les prochaines requêtes utilisent ces droits."); setRevision((value) => value + 1); } });
  }
  async function restore(): Promise<void> {
    await operation(async (isCurrent, signal) => {
      const base = payload(); delete base.grants;
      await permissionRequest("restore", { ...base, restoreVersion, reason: "RESTORE_VERSION", confirmed: true }, signal);
      if (isCurrent()) { setRestoreVersion(null); setSuccess("Restauration auditée dans une nouvelle version."); setRevision((value) => value + 1); }
    });
  }
  return <main className="permission-center"><PageHeader eyebrow="Administration · sécurité" title="Rôles et permissions" description="Définir un périmètre clair, vérifier les conséquences, puis enregistrer une version auditée." actions={<button className="secondary-button" type="button" disabled={busy} onClick={() => { invalidateContext(); setRevision((value) => value + 1); }}><ArrowsClockwise size={18} aria-hidden="true" />Recharger depuis le serveur</button>} />
    <OperationFeedback busy={busy} error={error} success={success} />
    {catalogue ? <ConfigurationSelector catalogue={catalogue} campus={configuration?.campus ?? catalogue.campus} role={role} busy={busy} dirty={changedCount > 0} editable={editable} configuration={configuration} onCampus={(value) => { invalidateContext(); setCampus(value); }} onRole={(value) => { invalidateContext(); setRole(value); }} /> : null}
    {configuration && catalogue ? <>
      <div className="permission-stats"><StatCard label="Capacités attribuées" value={`${catalogue.catalogue.filter((item) => (grants[item.key] ?? "NONE") !== "NONE").length} / ${catalogue.catalogue.length}`} hint="Valeurs du brouillon, pas une garantie d’accès effectif" /><StatCard label="Modifications locales" value={String(changedCount)} hint={changedCount ? "À prévisualiser avant confirmation" : "Brouillon identique à la configuration chargée"} /><StatCard label="Utilisateurs associés" value={selectedRole ? String(selectedRole.users) : "Tous les rôles"} hint="Comptés dans le contexte sélectionné" /></div>
      <DashboardGuidance catalogue={catalogue} configuration={configuration} grants={grants} />
      <PermissionEditor items={catalogue.catalogue} configuration={configuration} grants={grants} editable={editable} busy={busy} onChange={updateGrant} />
      <section className="panel permission-review" aria-labelledby="permission-review-title"><div className="permission-section-heading"><div><p className="eyebrow">Revue du brouillon</p><h2 id="permission-review-title">Vérifier avant d’appliquer</h2><p>{changedCount} modification{changedCount > 1 ? "s" : ""} locale{changedCount > 1 ? "s" : ""} · aucun droit enregistré à cette étape.</p></div><StatusBadge tone={changedCount ? "warning" : "neutral"}>{changedCount ? "Brouillon non enregistré" : "Aucun changement local"}</StatusBadge></div><ConfigurationImpact catalogue={catalogue} configuration={configuration} /><div className="permission-toolbar"><label>Motif<select value={reason} disabled={busy || !editable} onChange={(event) => { invalidateOperation(); setReason(event.target.value); setPreview(null); setConfirmed(false); }}><option value="ACCESS_REVIEW">Revue des accès</option><option value="RESPONSIBILITY_CHANGE">Changement de responsabilités</option><option value="CAMPUS_RESTRICTION">Restriction campus</option></select></label><div className="permission-actions"><button className="primary-button" disabled={busy || !editable} type="button" onClick={() => void operation(async (isCurrent, signal) => { const result = await permissionRequest<Preview>("preview", payload(), signal); if (isCurrent()) setPreview(result); })}>Prévisualiser les changements</button><button className="secondary-button" disabled={busy} type="button" onClick={() => { setGrants({ ...configuration.grants }); setPreview(null); setConfirmed(false); setSuccess("Modifications locales annulées ; aucun enregistrement."); }}>Annuler</button></div></div><p className="permission-help">Les rôles se cumulent : « Aucun droit » sur un rôle ne retire pas le droit d’un autre. Aucun rôle ne peut supprimer silencieusement un Lead.</p></section>
      {preview ? <><ChangePreview preview={preview} /><section className="panel permission-confirmation"><label className="permission-toggle"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>Je confirme les modifications et leurs conséquences sur les accès.</span></label><button className="primary-button" disabled={busy || !editable || !confirmed || !preview.changes.length} type="button" onClick={() => void save()}><FloppyDisk size={18} aria-hidden="true" />Enregistrer la nouvelle version</button></section></> : null}
      <PermissionHistory versions={versions} busy={busy} editable={editable} onRestore={setRestoreVersion} />
      {restoreVersion !== null ? <section className="panel permission-restore" aria-label="Confirmation de restauration"><h2>Confirmer la restauration de v{restoreVersion} ?</h2><p>Cette action réapplique les validations actuelles et ajoute une version. L’historique restera intact. Elle ne reprend pas votre brouillon local.</p><div className="permission-actions"><button className="primary-button" disabled={busy} type="button" onClick={() => void restore()}>Confirmer la restauration</button><button className="secondary-button" disabled={busy} type="button" onClick={() => setRestoreVersion(null)}>Annuler la restauration</button></div></section> : null}
      <section className="panel permission-effective-context" aria-labelledby="permission-effective-title"><div className="permission-section-heading"><div><p className="eyebrow">Comprendre mon accès</p><h2 id="permission-effective-title">Mes droits actuellement enregistrés</h2><p>Cette explication concerne votre compte connecté et ses rôles cumulés, pas le rôle sélectionné ni son brouillon.</p></div></div><div className="permission-toolbar"><label>Contexte Lead (facultatif)<select value={leadId} disabled={busy} onChange={(event) => { invalidateOperation(); setLeadId(event.target.value); setExplanation(null); }}><option value="">Droits généraux du campus</option>{leadOptions.map((lead) => <option key={lead.id} value={lead.id}>{lead.leadCode} — {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Prospect"}</option>)}</select></label><button className="secondary-button" disabled={busy} type="button" onClick={() => void operation(async (isCurrent, signal) => {
        const query = new URLSearchParams({ campus: configuration.campus });
        if (leadId) { query.set("leadId", leadId); }
        const result = await permissionRequest<Explanation>(`effective?${query}`, undefined, signal);
        if (isCurrent()) setExplanation(result);
      })}>Expliquer mes droits dans ce contexte</button></div></section>
      {explanation ? <EffectivePermissions explanation={explanation} /> : null}
      {catalogue.global ? <TeamResponsibilities campuses={catalogue.campuses} /> : null}
    </> : null}
  </main>;
}
function OperationFeedback({ busy, error, success }: Readonly<{ busy: boolean; error: string; success: string }>): React.JSX.Element {
  return <>
    {busy ? <p className="permission-feedback" role="status"><output>Chargement / validation en cours…</output></p> : null}
    {error ? <p className="permission-feedback" role="alert">{error}</p> : null}
    {success ? <p className="permission-feedback permission-feedback--success" role="status"><output>{success}</output></p> : null}
  </>;
}
function ConfigurationSelector({ catalogue, campus, role, busy, dirty, editable, configuration, onCampus, onRole }: Readonly<{
  catalogue: Catalogue; campus: string; role: string; busy: boolean; dirty: boolean; editable: boolean; configuration: Configuration | null;
  onCampus: (value: string) => void; onRole: (value: string) => void;
}>): React.JSX.Element {
  return <section className="panel permission-context" aria-labelledby="permission-context-title"><div className="permission-section-heading"><div className="permission-context-heading"><ShieldCheck size={24} aria-hidden="true" /><div><h2 id="permission-context-title">Configuration ciblée</h2><p>{catalogue.roles.length} rôles système · registre v{catalogue.catalogueVersion} · suppression des rôles interdite</p></div></div><StatusBadge tone={editable ? "info" : "neutral"}>{editable ? "Édition sous contrôle serveur" : "Lecture seule"}</StatusBadge></div><div className="permission-context-selectors">
    <label>Campus<select value={campus} disabled={busy} onChange={(event) => onCampus(event.target.value)}>
      {catalogue.global ? <option value="GLOBAL">Configuration globale</option> : null}
      {catalogue.campuses.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
    </select></label>
    <label>Rôle système<select value={role} disabled={busy} onChange={(event) => onRole(event.target.value)}>
      {catalogue.global ? <option value="*">Plafond de toutes les permissions</option> : null}
      {catalogue.roles.map((item) => <option key={item.role} value={item.role}>{item.label} — {item.users} utilisateurs{item.editable ? "" : " · lecture seule"}</option>)}
    </select></label>
    </div><div className="permission-context-footer"><p>{catalogue.roles.find((item) => item.role === role)?.description ?? "Plafond de sécurité commun à tous les rôles."}</p>{configuration ? <StatusBadge tone={dirty ? "warning" : "neutral"}>{dirty ? "Brouillon modifié" : configuration.inherited ? "Droits standards chargés" : `Version ${configuration.version} chargée`}</StatusBadge> : null}</div>{dirty ? <p className="permission-help">Changer de rôle ou de campus abandonne les modifications locales non enregistrées.</p> : null}</section>;
}
function message(failure: unknown): string { return failure instanceof Error ? failure.message : "Service indisponible. Aucun changement confirmé."; }
