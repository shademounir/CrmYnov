"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface ReassignmentRecord {
  id: string; leadId: string; currentOwnerId: string; targetUserId: string; requestedBy: string;
  status: "PENDING" | "APPROVED" | "REJECTED"; reason: string; requestedAt: string; moveOpenTasks: boolean;
  version?: number; canDecide: boolean; currentOwnerLabel?: string; targetUserLabel?: string;
  requesterLabel?: string; leadCode?: string; decisionReason?: string; decidedAt?: string; transferredFollowUpCount?: number;
}

export function parseReassignmentRecords(value: unknown): ReassignmentRecord[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("requests" in value) || !Array.isArray(value.requests)) throw new Error("reassignment_payload_invalid");
  return value.requests.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("reassignment_payload_invalid");
    const row = item as Record<string, unknown>;
    for (const key of ["id", "leadId", "currentOwnerId", "targetUserId", "requestedBy", "reason", "requestedAt"]) {
      if (typeof row[key] !== "string" || !row[key]) throw new Error("reassignment_payload_invalid");
    }
    if (!["PENDING", "APPROVED", "REJECTED"].includes(String(row.status)) || typeof row.moveOpenTasks !== "boolean" || !Number.isFinite(Date.parse(String(row.requestedAt)))) throw new Error("reassignment_payload_invalid");
    const result: ReassignmentRecord = {
      id: String(row.id), leadId: String(row.leadId), currentOwnerId: String(row.currentOwnerId), targetUserId: String(row.targetUserId),
      requestedBy: String(row.requestedBy), reason: String(row.reason), requestedAt: String(row.requestedAt),
      status: row.status as ReassignmentRecord["status"], moveOpenTasks: row.moveOpenTasks,
      canDecide: row.canDecide === true && typeof row.version === "number" && Number.isSafeInteger(row.version) && row.version > 0,
    };
    if (typeof row.version === "number" && Number.isSafeInteger(row.version) && row.version > 0) result.version = row.version;
    for (const key of ["currentOwnerLabel", "targetUserLabel", "requesterLabel", "leadCode", "decisionReason", "decidedAt"] as const) {
      if (typeof row[key] === "string" && row[key]) result[key] = row[key];
    }
    if (typeof row.transferredFollowUpCount === "number" && Number.isSafeInteger(row.transferredFollowUpCount) && row.transferredFollowUpCount >= 0) result.transferredFollowUpCount = row.transferredFollowUpCount;
    return result;
  });
}

export function reassignmentError(status?: number, code?: string): string {
  if (status === 401) return "Votre session a expiré. Reconnectez-vous ; aucune décision n’est renvoyée automatiquement.";
  if (status === 403) return "Accès refusé. Un Manager ou Administrateur distinct, autorisé dans ce campus, doit prendre la décision.";
  if (code === "reassignment_separation_of_duties") return "Le demandeur ne peut pas décider sa propre demande.";
  if (status === 409) return "La demande, son propriétaire ou ses permissions ont changé. Actualisez avant toute autre décision.";
  if (status === 400 || status === 422) return "Indiquez une décision et un motif conforme. La saisie est conservée.";
  return "Le résultat n’a pas pu être confirmé. Votre saisie et la clé de décision sont conservées ; actualisez ou réessayez la même décision.";
}

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const value = await response.json() as { code?: unknown; message?: { code?: unknown } };
    const code = value.code ?? value.message?.code;
    return typeof code === "string" ? code : undefined;
  } catch { return undefined; }
}

function requestDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

export function ReassignmentHistory({ leadId, onCompleted }: Readonly<{ leadId?: string; onCompleted?: () => void }>): React.JSX.Element {
  const [items, setItems] = useState<ReassignmentRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string }>();
  const [busyId, setBusyId] = useState<string>();
  const locks = useRef(new Set<string>());
  const attempts = useRef(new Map<string, { payload: string; key: string }>());
  const revision = useRef(0);
  const endpoint = leadId ? `/api/crm/leads/${encodeURIComponent(leadId)}/reassignment-requests` : "/api/crm/reassignment-requests";

  async function load(): Promise<boolean> {
    const current = ++revision.current;
    setState("loading");
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
      if (!response.ok) {
        if (current === revision.current) { setMessage(reassignmentError(response.status)); setState("error"); }
        return false;
      }
      const records = parseReassignmentRecords(await response.json());
      if (leadId && records.some((row) => row.leadId !== leadId)) throw new Error("reassignment_lead_mismatch");
      if (current === revision.current) { setItems(records); setState("ready"); }
      return true;
    } catch {
      if (current === revision.current) { setMessage("Les demandes sont indisponibles. Aucune décision n’est affichée comme confirmée."); setState("error"); }
      return false;
    }
  }

  useEffect(() => { void load(); return (): void => { revision.current++; }; }, [endpoint]);

  async function decide(event: React.FormEvent<HTMLFormElement>, item: ReassignmentRecord): Promise<void> {
    event.preventDefault();
    if (locks.current.has(item.id) || !item.canDecide || !item.version || item.status !== "PENDING") return;
    const data = new FormData(event.currentTarget);
    const reason = data.get("reason");
    const body = { approved: data.get("decision") === "APPROVE", reason: typeof reason === "string" ? reason.trim() : "", expectedVersion: item.version };
    if (body.reason.length < 4 || body.reason.length > 500) { setFeedback({ kind: "error", message: "Précisez un motif de 4 à 500 caractères." }); return; }
    const payload = JSON.stringify(body);
    const previous = attempts.current.get(item.id);
    if (previous && previous.payload !== payload) { setFeedback({ kind: "error", message: "Une décision reste incertaine. Actualisez son état ou réessayez avec le même choix et le même motif avant de changer d’intention." }); return; }
    const attempt = previous ?? { payload, key: `ui-reassignment-decision:${crypto.randomUUID()}` };
    attempts.current.set(item.id, attempt); locks.current.add(item.id); setBusyId(item.id); setFeedback(undefined);
    try {
      const response = await fetch(`/api/crm/reassignment-requests/${encodeURIComponent(item.id)}/decision`, {
        method: "PATCH", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, idempotencyKey: attempt.key }),
      });
      if (!response.ok) {
        if (response.status < 500) attempts.current.delete(item.id);
        setFeedback({ kind: "error", message: reassignmentError(response.status, await errorCode(response)) }); return;
      }
      const value = await response.json() as { request?: unknown };
      const confirmed = parseReassignmentRecords({ requests: [value.request] })[0];
      if (!confirmed || confirmed.id !== item.id || confirmed.status !== (body.approved ? "APPROVED" : "REJECTED")) throw new Error("reassignment_decision_unconfirmed");
      attempts.current.delete(item.id);
      const refreshed = await load();
      setFeedback({ kind: "success", message: body.approved
        ? `Réaffectation approuvée par le serveur.${typeof confirmed.transferredFollowUpCount === "number" ? ` ${confirmed.transferredFollowUpCount} relance(s) planifiée(s) transférée(s).` : ""}${refreshed ? " État relu." : " Actualisation de la demande à refaire."}`
        : `Demande refusée. Le propriétaire reste inchangé.${refreshed ? " État relu." : " Actualisation de la demande à refaire."}` });
      onCompleted?.();
    } catch { setFeedback({ kind: "error", message: reassignmentError() }); }
    finally { locks.current.delete(item.id); setBusyId(undefined); }
  }

  return <section className="reassignment-history" aria-label="Demandes de réaffectation" aria-busy={state === "loading"}>
    <header><h3>{leadId ? "Demandes de ce Lead" : "Demandes à examiner"}</h3><button className="secondary-button" type="button" disabled={state === "loading" || Boolean(busyId)} onClick={() => { void load(); }}>Actualiser les demandes</button></header>
    {feedback ? <p className={`reassignment-feedback reassignment-feedback--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p> : null}
    {state === "loading" ? <p role="status">Chargement des demandes autorisées…</p> : null}
    {state === "error" ? <p role="alert">{message}</p> : null}
    {state === "ready" && !items.length ? <p>Aucune demande de réaffectation dans votre périmètre.</p> : null}
    {state === "ready" ? <ol>{items.map((item) => <li key={item.id} className="reassignment-card">
      <div className="reassignment-card__heading"><span className={`reassignment-state reassignment-state--${item.status.toLowerCase()}`}>{item.status === "PENDING" ? "En attente" : item.status === "APPROVED" ? "Approuvée" : "Refusée"}</span><Link href={`/leads/${encodeURIComponent(item.leadId)}/collaborators`}>{item.leadCode ?? "Ouvrir la fiche et son affectation"}</Link></div>
      <dl><div><dt>Propriétaire à la demande</dt><dd>{item.currentOwnerLabel ?? "Conseiller attribué au dossier"}</dd></div><div><dt>Conseiller proposé</dt><dd>{item.targetUserLabel ?? "Conseiller autorisé proposé"}</dd></div><div><dt>Demandeur</dt><dd>{item.requesterLabel ?? "Demandeur enregistré"}</dd></div></dl>
      <p><strong>Motif :</strong> {item.reason}</p><time dateTime={item.requestedAt}>Demandée le {requestDate(item.requestedAt)} UTC</time>
      <p>{item.moveOpenTasks ? "Transfert demandé des relances planifiées du propriétaire uniquement." : "Aucun transfert de relance demandé."} Les relances échues, rendez-vous, réservations Admissions et appels ne sont pas déplacés.</p>
      {item.decisionReason ? <p><strong>Décision motivée :</strong> {item.decisionReason}</p> : null}
      {item.status === "PENDING" ? <p className="lead-assignment-dialog__notice">Le propriétaire reste inchangé jusqu’à l’approbation distincte.</p> : null}
      {item.status === "PENDING" && item.canDecide ? <form className="reassignment-decision" onSubmit={(event) => { void decide(event, item); }}>
        <label>Décision<select name="decision" defaultValue="APPROVE" disabled={busyId === item.id}><option value="APPROVE">Approuver la réaffectation</option><option value="REJECT">Refuser la demande</option></select></label>
        <label>Motif de la décision<textarea name="reason" required minLength={4} maxLength={500} rows={3} disabled={busyId === item.id} placeholder="Justifiez la décision sans données superflues." /></label>
        <button className="primary-button" type="submit" disabled={busyId === item.id}>{busyId === item.id ? "Décision en cours…" : "Confirmer la décision"}</button>
      </form> : item.status === "PENDING" ? <p>La décision nécessite un Manager ou Administrateur distinct disposant des permissions dans ce campus.</p> : null}
    </li>)}</ol> : null}
  </section>;
}
