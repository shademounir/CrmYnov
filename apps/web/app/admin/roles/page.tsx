"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "../../_components/ui/page-header";
import { PermissionEditor } from "./permission-editor";
import { ChangePreview, EffectivePermissions, PermissionHistory } from "./permission-evidence";
import { TeamResponsibilities } from "./team-responsibilities";
import { permissionRequest, type Catalogue, type Configuration, type Explanation, type Preview, type Scope, type Version } from "./permission-types";

export default function RolesPage(): React.JSX.Element {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [campus, setCampus] = useState(""); const [role, setRole] = useState("MANAGER");
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [grants, setGrants] = useState<Record<string, Scope>>({});
  const [versions, setVersions] = useState<Version[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [leadId, setLeadId] = useState(""); const [reason, setReason] = useState("ACCESS_REVIEW");
  const [confirmed, setConfirmed] = useState(false); const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setBusy(true); setPreview(null); setConfirmed(false); setConfiguration(null); setRestoreVersion(null); setExplanation(null); setError("");
    const cataloguePath = campus ? "catalogue?campus=" + encodeURIComponent(campus) : "catalogue";
    void permissionRequest<Catalogue>(cataloguePath).then(async (data) => {
      const query = new URLSearchParams({ campus: data.campus, role, kind: role === "*" ? "CEILING" : "ROLE" });
      const [config, history] = await Promise.all([permissionRequest<Configuration>(`configuration?${query}`), permissionRequest<{ versions: Version[] }>(`history?${query}`)]);
      if (current) { setCatalogue(data); setConfiguration(config); setGrants({ ...config.grants }); setVersions(history.versions); setBusy(false); }
    }).catch((error_: unknown) => { if (current) { setError(message(error_)); setBusy(false); } });
    return (): void => { current = false; };
  }, [campus, role, revision]);
  const editable = Boolean(catalogue && (catalogue.global || catalogue.roles.find((item) => item.role === role)?.editable));
  function payload(): Record<string, unknown> {
    if (!configuration) throw new Error("Rechargez la configuration avant de continuer.");
    return { kind: configuration.kind, role: configuration.role, campus: configuration.campus, expectedVersion: configuration.version, grants, reason, confirmed };
  }
  async function operation(action: () => Promise<void>): Promise<void> {
    setBusy(true); setError(""); setSuccess("");
    try { await action(); } catch (error_) { setError(message(error_)); setPreview(null); setConfirmed(false); } finally { setBusy(false); }
  }
  function updateGrant(key: string, value: Scope): void { setGrants((current) => ({ ...current, [key]: value })); setPreview(null); setConfirmed(false); setSuccess(""); }
  async function save(): Promise<void> {
    await operation(async () => { await permissionRequest("configuration", payload()); setSuccess("Nouvelle version enregistrée et auditée. Les prochaines requêtes utilisent ces droits."); setRevision((value) => value + 1); });
  }
  async function restore(): Promise<void> {
    await operation(async () => {
      const base = payload(); delete base.grants;
      await permissionRequest("restore", { ...base, restoreVersion, reason: "RESTORE_VERSION", confirmed: true });
      setRestoreVersion(null); setSuccess("Restauration auditée dans une nouvelle version."); setRevision((value) => value + 1);
    });
  }
  return <main><PageHeader eyebrow="Administration · sécurité" title="Rôles et permissions" description="Droits configurables, plafonds explicites et protections métier intangibles." />
    <p>Les rôles se cumulent : « Aucun droit » sur un rôle ne retire pas le droit d’un autre. Aucun rôle ne peut supprimer silencieusement un lead.</p>
    <OperationFeedback busy={busy} error={error} success={success} />
    <button type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Recharger depuis le serveur</button>
    {catalogue ? <ConfigurationSelector catalogue={catalogue} campus={configuration?.campus ?? campus} role={role} busy={busy} onCampus={(value) => { setCampus(value); setSuccess(""); }} onRole={(value) => { setRole(value); setSuccess(""); }} /> : null}
    {configuration && catalogue ? <>
      <p>{catalogue.roles.find((item) => item.role === role)?.description ?? "Plafond de sécurité commun à tous les rôles."}</p>
      <PermissionEditor items={catalogue.catalogue} configuration={configuration} grants={grants} editable={editable} busy={busy} onChange={updateGrant} />
      <section className="panel permission-toolbar"><label>Motif<select value={reason} disabled={busy || !editable} onChange={(event) => { setReason(event.target.value); setPreview(null); setConfirmed(false); }}><option value="ACCESS_REVIEW">Revue des accès</option><option value="RESPONSIBILITY_CHANGE">Changement de responsabilités</option><option value="CAMPUS_RESTRICTION">Restriction campus</option></select></label><button disabled={busy || !editable} type="button" onClick={() => void operation(async () => setPreview(await permissionRequest<Preview>("preview", payload())))}>Prévisualiser les changements</button><button disabled={busy} type="button" onClick={() => { setGrants({ ...configuration.grants }); setPreview(null); setConfirmed(false); setSuccess("Modifications locales annulées ; aucun enregistrement."); }}>Annuler</button></section>
      {preview ? <><ChangePreview preview={preview} /><section className="panel permission-toolbar"><label className="permission-toggle"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Je confirme les modifications et leurs conséquences sur les accès.</label><button disabled={busy || !editable || !confirmed || !preview.changes.length} type="button" onClick={() => void save()}>Enregistrer la nouvelle version</button></section></> : null}
      <PermissionHistory versions={versions} busy={busy} editable={editable} onRestore={setRestoreVersion} />
      {restoreVersion !== null ? <section className="panel" aria-label="Confirmation de restauration"><h2>Confirmer la restauration de v{restoreVersion} ?</h2><p>Cette action réapplique les validations actuelles et ajoute une version. L’historique restera intact.</p><button disabled={busy} type="button" onClick={() => void restore()}>Confirmer la restauration</button><button disabled={busy} type="button" onClick={() => setRestoreVersion(null)}>Annuler la restauration</button></section> : null}
      <section className="panel permission-toolbar"><label>Identifiant technique du lead (facultatif)<input value={leadId} maxLength={36} onChange={(event) => { setLeadId(event.target.value); setExplanation(null); }} /></label><button disabled={busy} type="button" onClick={() => void operation(async () => {
        const query = new URLSearchParams({ campus: configuration.campus });
        if (leadId) { query.set("leadId", leadId); }
        setExplanation(await permissionRequest<Explanation>(`effective?${query}`));
      })}>Expliquer mes droits dans ce contexte</button></section>
      {explanation ? <EffectivePermissions explanation={explanation} /> : null}
      {catalogue.global ? <TeamResponsibilities campuses={catalogue.campuses} /> : null}
    </> : null}
  </main>;
}
function OperationFeedback({ busy, error, success }: Readonly<{ busy: boolean; error: string; success: string }>): React.JSX.Element {
  return <>
    {busy ? <p><output>Chargement / validation en cours…</output></p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {success ? <p><output>{success}</output></p> : null}
  </>;
}
function ConfigurationSelector({ catalogue, campus, role, busy, onCampus, onRole }: Readonly<{
  catalogue: Catalogue; campus: string; role: string; busy: boolean;
  onCampus: (value: string) => void; onRole: (value: string) => void;
}>): React.JSX.Element {
  return <section className="panel permission-toolbar">
    <label>Campus<select value={campus} disabled={busy} onChange={(event) => onCampus(event.target.value)}>
      {catalogue.global ? <option value="GLOBAL">Plafond global / rôles globaux</option> : null}
      {catalogue.campuses.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
    </select></label>
    <label>Rôle système<select value={role} disabled={busy} onChange={(event) => onRole(event.target.value)}>
      {catalogue.global ? <option value="*">Plafond de toutes les permissions</option> : null}
      {catalogue.roles.map((item) => <option key={item.role} value={item.role}>{item.label} — {item.users} utilisateurs{item.editable ? "" : " · lecture seule"}</option>)}
    </select></label>
    <p>5 rôles système · suppression interdite · registre v{catalogue.catalogueVersion}</p>
  </section>;
}
function message(failure: unknown): string { return failure instanceof Error ? failure.message : "Service indisponible. Aucun changement confirmé."; }
