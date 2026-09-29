"use client";

import { useCallback, useEffect, useState } from "react";
import { loadReferences, type ReferenceOption } from "../../_components/reference-controls";
import { TemporarySecretForm } from "./temporary-secret-form";

type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "ADMISSIONS" | "AUDITOR";
type User = { id: string; professionalEmail: string; roles: Role[]; campusId?: string; teamId?: string; active: boolean };
const labels: Record<Role, string> = { SUPER_ADMIN: "Super Admin", ADMIN: "Admin", MANAGER: "Manager", ADMISSIONS: "Commercial", AUDITOR: "Lecteur" };
const roles = Object.keys(labels) as Role[];
const reasons = { RESPONSIBILITY_CHANGE: "Responsabilités", TEAM_CHANGE: "Équipe", CAMPUS_CHANGE: "Campus", ACCESS_REVIEW: "Revue des accès" } as const;

async function api(path: string, method = "GET", body?: object): Promise<unknown> {
  const response = await fetch(`/api/crm/${path}`, { method, credentials: "same-origin", cache: "no-store", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(response.status === 409 ? "Conflit : rechargez avant de réessayer." : response.status === 403 ? "Accès refusé pour ce rôle ou ce périmètre." : `Opération non confirmée (${response.status}).`);
  return response.json();
}

export function UsersConsole(): React.JSX.Element {
  const [users, setUsers] = useState<User[]>([]), [campuses, setCampuses] = useState<ReferenceOption[]>([]);
  const [selected, setSelected] = useState(""), [role, setRole] = useState<Role>("ADMISSIONS"), [campusId, setCampusId] = useState(""), [teamId, setTeamId] = useState("");
  const [reason, setReason] = useState<keyof typeof reasons>("ACCESS_REVIEW"), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const reload = useCallback(async (): Promise<void> => {
    const data = await api("users") as { users?: User[] };
    if (!Array.isArray(data.users)) throw new Error("Liste des utilisateurs invalide.");
    setUsers(data.users);
  }, []);
  useEffect(() => { let active = true; void Promise.all([api("users"), loadReferences("CAMPUS")]).then(([data, references]) => {
    if (!active) return;
    const result = data as { users?: User[] };
    if (!Array.isArray(result.users)) throw new Error("Liste des utilisateurs invalide.");
    setUsers(result.users); setCampuses(references); setLoading(false);
  }).catch((failure: unknown) => { if (active) { setError(failure instanceof Error ? failure.message : "Administration indisponible."); setLoading(false); } }); return () => { active = false; }; }, []);
  const current = users.find((item) => item.id === selected);
  async function mutate(action: () => Promise<unknown>, message: string): Promise<void> {
    setBusy(true); setError(""); setSuccess("");
    try { await action(); await reload(); setSuccess(message); setConfirmed(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Écriture ou relecture non confirmée. Vérifiez la liste avant de réessayer."); }
    finally { setBusy(false); }
  }
  function choose(user: User): void { setSelected(user.id); setRole(user.roles[0] ?? "ADMISSIONS"); setCampusId(user.campusId ?? ""); setTeamId(user.teamId ?? ""); setConfirmed(false); setError(""); setSuccess(""); }
  if (loading) return <p role="status">Chargement des comptes et des campus…</p>;
  return <div className="users-grid">
    <section className="users-card" aria-labelledby="users-list-title"><h2 id="users-list-title">Comptes <small>{users.length}</small></h2><div className="users-list">{users.map((user) => <button key={user.id} type="button" className={user.id === selected ? "is-selected" : ""} onClick={() => choose(user)}><strong>{user.professionalEmail}</strong><span>{user.roles.map((value) => labels[value] ?? value).join(", ")} · {campuses.find((item) => item.id === user.campusId)?.label ?? user.campusId ?? "Global"}</span><small>{user.active ? "Actif" : "Désactivé"}</small></button>)}{users.length === 0 ? <p>Aucun compte.</p> : null}</div></section>
    <div className="users-actions"><section className="users-card"><h2>Créer un utilisateur</h2><p>Le secret temporaire est émis séparément après création.</p><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void (async () => {
      const email = String(form.get("professionalEmail") ?? "").trim(); const newRole = String(form.get("role") ?? "") as Role; const newCampus = String(form.get("campusId") ?? ""); const newTeam = String(form.get("teamId") ?? "").trim();
      if (newRole !== "SUPER_ADMIN" && !newCampus) { setError("Choisissez explicitement un campus pour ce rôle."); return; }
      await mutate(async () => { const created = await api("users", "POST", { professionalEmail: email, roles: [newRole], ...(newCampus ? { campusId: newCampus } : {}), ...(newTeam ? { teamId: newTeam } : {}) }) as User; if (created.id) setSelected(created.id); }, "Compte créé et relu. Émettez l’accès temporaire si nécessaire.");
    })(); }}><label>Email professionnel<input name="professionalEmail" type="email" required autoComplete="off" /></label><label>Rôle<select name="role" defaultValue="ADMISSIONS">{roles.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label><label>Campus<select name="campusId" defaultValue=""><option value="">Global</option>{campuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Équipe<input name="teamId" maxLength={64} /></label><button disabled={busy || campuses.length === 0} type="submit">{busy ? "Enregistrement…" : "Créer le compte"}</button></form></section>
      <section className="users-card"><h2>Droits et état</h2>{!current ? <p>Sélectionnez un compte.</p> : <><p><strong>{current.professionalEmail}</strong> · {current.active ? "Actif" : "Désactivé"}</p>{current.roles.length > 1 ? <p role="note">Ce compte possède plusieurs rôles. Leur modification demande une revue détaillée ; cet écran ne les remplacera pas silencieusement.</p> : null}<div className="users-fields"><label>Rôle<select value={role} onChange={(event) => setRole(event.target.value as Role)}>{roles.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label><label>Campus<select value={campusId} onChange={(event) => setCampusId(event.target.value)}><option value="">Global</option>{campuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Équipe<input value={teamId} maxLength={64} onChange={(event) => setTeamId(event.target.value)} /></label><label>Motif<select value={reason} onChange={(event) => setReason(event.target.value as keyof typeof reasons)}>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label className="users-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmer le changement et la révocation des sessions.</label><div className="users-buttons"><button type="button" disabled={busy || !confirmed || current.roles.length > 1 || (role !== "SUPER_ADMIN" && !campusId)} onClick={() => void mutate(() => api(`users/${encodeURIComponent(current.id)}/authorization`, "PATCH", { roles: [role], ...(campusId ? { campusId } : {}), ...(teamId ? { teamId } : {}), reason, confirmed: true }), "Droits enregistrés et relus ; sessions révoquées.")}>Enregistrer les droits</button><button type="button" disabled={busy} onClick={() => { if (window.confirm(current.active ? "Désactiver ce compte et révoquer ses sessions ?" : "Réactiver ce compte ?")) void mutate(() => api(`users/${encodeURIComponent(current.id)}/status`, "PATCH", { active: !current.active }), current.active ? "Compte désactivé et relu." : "Compte réactivé et relu."); }}>{current.active ? "Désactiver" : "Réactiver"}</button></div></>}</section>
      <section className="users-card"><TemporarySecretForm collaboratorId={selected} /></section>{error ? <p role="alert" className="users-feedback error">{error}</p> : null}{success ? <p role="status" className="users-feedback">{success}</p> : null}
    </div>
  </div>;
}
