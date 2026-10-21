"use client";

import { useEffect, useRef, useState } from "react";
import { loadReferences, ReferenceSelect, type ReferenceOption } from "../../../_components/reference-controls";
import { sheetApiValue } from "../../scheduled-sheets/sheets-client";
import { poolAdministration, poolConfiguration, poolSourceLabels, type PoolAdministration, type PoolConfiguration, type PoolRule } from "./pool-contract";

async function api(endpoint: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/crm/assignment/${endpoint}`, { credentials: "same-origin", cache: "no-store", method: body ? "PUT" : "GET", headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(response.status === 409 ? "Conflit de version : rechargez avant toute nouvelle modification." : response.status === 403 ? "Administration des pools non autorisée dans ce campus." : response.status === 401 ? "Session expirée." : "Service indisponible ou configuration refusée.");
  return sheetApiValue(await response.json());
}

export function PoolEditor(): React.JSX.Element {
  const [campuses, setCampuses] = useState<ReferenceOption[]>([]), [campus, setCampus] = useState("");
  const [campaigns, setCampaigns] = useState<ReferenceOption[]>([]), [configuration, setConfiguration] = useState<PoolConfiguration | null>(null);
  const [administration, setAdministration] = useState<PoolAdministration | null>(null), [rules, setRules] = useState<PoolRule[]>([]);
  const [automatic, setAutomatic] = useState(false), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [mustReload, setMustReload] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState(""); const revision = useRef(0);
  useEffect(() => { let active = true; void loadReferences("CAMPUS").then(rows => { if (active) setCampuses(rows); }).catch(() => { if (active) setError("Campus autorisés indisponibles."); });
    return (): void => { active = false; revision.current++; }; }, []);
  async function load(value: string): Promise<void> {
    const token = ++revision.current; setBusy(true); setConfiguration(null); setAdministration(null); setConfirmed(false); setError(""); setMessage("");
    try {
      const selected = campuses.find(c => c.code === value); if (!selected) throw new Error("Choisissez un campus actif autorisé.");
      const [config, admin, references] = await Promise.all([api(`config?campusId=${encodeURIComponent(value)}`), api(`pool-administration?campusId=${encodeURIComponent(value)}`), loadReferences("CAMPAIGN", selected.id)]);
      const saved = poolConfiguration(config), projection = poolAdministration(admin);
      if (saved.campusId !== projection.campusId || saved.version !== projection.version) throw new Error("Configuration modifiée pendant la lecture : rechargez.");
      if (token !== revision.current) return;
      setConfiguration(saved); setAdministration(projection); setRules(saved.rules); setAutomatic(saved.automaticEnabled); setCampaigns(references); setMustReload(false);
    } catch (e) { if (token === revision.current) setError(e instanceof Error ? e.message : "Lecture impossible."); }
    finally { if (token === revision.current) setBusy(false); }
  }
  function changeRule(index: number, patch: Partial<PoolRule>): void { setConfirmed(false); setMessage(""); setRules(rows => rows.map((rule, i) => {
    if (i !== index) return rule;
    const next = { ...rule, ...patch }; if (patch.scope === "GLOBAL") delete next.matchValue; return next;
  })); }
  function addRule(): void { setConfirmed(false); setRules(rows => [...rows, { id: crypto.randomUUID(), scope: rows.length ? "CAMPAIGN" : "GLOBAL", strategy: "CONTROLLED_RANDOM", balanceNewEntrants: true, enabled: true, candidates: [] }]); }
  async function save(): Promise<void> {
    if (!configuration || !confirmed || mustReload) return; const token = ++revision.current; setBusy(true); setError(""); setMessage("");
    try {
      const saved = poolConfiguration(await api("config", { campusId: configuration.campusId, expectedVersion: configuration.version, automaticEnabled: automatic, confirmedNewCohort: true, rules }));
      if (token !== revision.current) return;
      setConfiguration(saved); setRules(saved.rules); setConfirmed(false); setAdministration(null); setMessage(`Configuration enregistrée : version ${saved.version}. Aucun dossier historique n’a été réaffecté.`);
      try { const current = poolAdministration(await api(`pool-administration?campusId=${encodeURIComponent(saved.campusId)}`));
        if (token === revision.current) {
          if (current.version === saved.version) setAdministration(current);
          else { setMustReload(true); setError("Une autre version a été enregistrée. Actualisez avant une nouvelle modification."); }
        }
      } catch { if (token === revision.current) setError("Enregistrement confirmé, mais compteurs indisponibles. Actualisez en lecture seule."); }
    } catch (e) { if (token === revision.current) { setMustReload(true); setError(`${e instanceof Error ? e.message : "Réponse non confirmée."} Aucun rejeu automatique. Rechargez la version serveur avant une autre tentative.`); } }
    finally { if (token === revision.current) setBusy(false); }
  }
  const disabled = busy || mustReload;
  return <section className="pool-admin" aria-label="Pools des nouveaux entrants" aria-busy={busy}>
    <div className="pool-admin__toolbar"><ReferenceSelect name="pool-campus" label="Campus autorisé" options={campuses} value={campus} disabled={busy} onChange={value => { setCampus(value); void load(value); }} />
      <button type="button" className="secondary-button" disabled={!campus || busy} onClick={() => { void load(campus); }}>Actualiser la version serveur</button></div>
    {configuration ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>Version enregistrée : <strong>{configuration.version}</strong>. Priorité : campagne → source → repli du campus. Aucune modification n’active Sheets.</p>
      <p>Équité : nouveaux entrants de ce campus, de cette version et de chaque règle. Enregistrer une nouvelle version ouvre une nouvelle cohorte de compteurs ; les anciens reçus restent conservés. La charge ouverte n’est pas le compteur d’équité. Une capacité explicite est requise pour chaque conseiller ; une règle de repli active est requise si des règles existent.</p>
      <label className="pool-admin__check"><input type="checkbox" checked={automatic} disabled={disabled} onChange={event => { setAutomatic(event.target.checked); setConfirmed(false); }} />Affectation automatique des nouveaux entrants</label>
      {rules.map((rule, index) => <PoolRuleEditor key={rule.id} rule={rule} index={index} campaigns={campaigns} administration={administration} disabled={disabled} onChange={patch => changeRule(index, patch)} onRemove={() => { setConfirmed(false); setRules(rows => rows.filter((_, i) => i !== index)); }} />)}
      <button type="button" className="secondary-button" disabled={disabled || rules.length >= 100} onClick={addRule}>Ajouter un pool / une règle</button>
      {!rules.length ? <p>Aucune règle : les nouveaux dossiers resteront dans « À affecter ».</p> : null}
      <label className="pool-admin__check"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} />Je confirme ce routage prospectif et la nouvelle version, sans redistribution des dossiers existants.</label>
      <button type="submit" disabled={disabled || !confirmed}>Enregistrer les pools et le routage</button>
    </form> : !busy && !error ? <p>Choisissez un campus pour lire sa configuration et ses conseillers autorisés.</p> : null}
    {busy ? <p role="status">Contrôle auprès du serveur…</p> : message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}
  </section>;
}

function PoolRuleEditor({ rule, index, campaigns, administration, disabled, onChange, onRemove }: Readonly<{ rule: PoolRule; index: number; campaigns: ReferenceOption[]; administration: PoolAdministration | null; disabled: boolean; onChange: (patch: Partial<PoolRule>) => void; onRemove: () => void }>): React.JSX.Element {
  const members = rule.candidates, available = administration?.candidates.filter(c => !members.some(m => m.userId === c.id)) ?? [];
  return <fieldset className="pool-admin__rule" disabled={disabled}><legend>Pool {index + 1}</legend>
    <div className="pool-admin__fields"><label>Périmètre de la règle<select value={rule.scope} onChange={event => onChange({ scope: event.target.value as PoolRule["scope"], ...(event.target.value === "GLOBAL" ? {} : { matchValue: "" }) })}><option value="GLOBAL">Repli du campus</option><option value="CAMPAIGN">Campagne</option><option value="SOURCE">Source</option></select></label>
      {rule.scope === "CAMPAIGN" ? <ReferenceSelect name={`pool-campaign-${index}`} label="Campagne active" options={campaigns} value={rule.matchValue ?? ""} onChange={value => onChange({ matchValue: value })} /> : rule.scope === "SOURCE" ? <label>Source<select required value={rule.matchValue ?? ""} onChange={event => onChange({ matchValue: event.target.value })}><option value="">Choisir une source</option>{Object.entries(poolSourceLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label> : null}
      <label>Répartition<select value={rule.balanceNewEntrants ? "BALANCED_NEW" : rule.strategy} onChange={event => onChange({ strategy: event.target.value === "ROUND_ROBIN" ? "ROUND_ROBIN" : "CONTROLLED_RANDOM", balanceNewEntrants: event.target.value === "BALANCED_NEW" })}><option value="BALANCED_NEW">Aléatoire équilibré · nouveaux entrants</option><option value="ROUND_ROBIN">Tour de rôle · historique</option><option value="CONTROLLED_RANDOM">Aléatoire reproductible · non équilibré</option></select></label></div>
    <label className="pool-admin__check"><input type="checkbox" checked={rule.enabled} onChange={event => onChange({ enabled: event.target.checked })} />Règle active</label>
    {members.map((member, memberIndex) => { const candidate = administration?.candidates.find(c => c.id === member.userId), counter = administration?.counters.find(c => c.ruleId === rule.id && c.userId === member.userId);
      return <div className="pool-admin__member" key={member.userId}><div><strong>{candidate?.label ?? counter?.label ?? "Conseiller indisponible · membre conservé"}</strong><p>Charge ouverte actuelle : {candidate?.activeLeadCount ?? "indisponible"} · Nouveaux entrants de la version enregistrée : {rule.balanceNewEntrants ? counter?.assignedCount ?? (administration ? 0 : "indisponible") : "non applicable"}</p>{member.suspended || member.excluded ? <p>Suspension ou exclusion conservée : ce membre n’est pas éligible.</p> : null}</div>
        <label>Capacité ouverte<input type="number" min="1" max="1000000" required value={member.capacity === 0 ? "" : member.capacity} onChange={event => onChange({ candidates: members.map((m, i) => i === memberIndex ? { ...m, capacity: Number(event.target.value) } : m) })} /></label>
        <label className="pool-admin__check"><input type="checkbox" checked={member.active} onChange={event => onChange({ candidates: members.map((m, i) => i === memberIndex ? { ...m, active: event.target.checked } : m) })} />Participe</label>
        <button type="button" className="secondary-button" onClick={() => onChange({ candidates: members.filter((_, i) => i !== memberIndex) })}>Retirer du pool</button></div>;
    })}
    <label>Ajouter un conseiller éligible<select value="" disabled={!administration || members.length >= 100 || !available.length} onChange={event => { if (event.target.value) onChange({ candidates: [...members, { userId: event.target.value, active: true, capacity: 0, activeLeadCount: 0, suspended: false, excluded: false }] }); }}><option value="">Sélectionner un nom d’utilisateur CRM</option>{available.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    {administration && !available.length ? <p>Aucun autre Commercial activé et autorisé n’est disponible dans ce campus.</p> : null}
    <button type="button" className="secondary-button" onClick={onRemove}>Retirer cette règle de la prochaine version</button>
  </fieldset>;
}
