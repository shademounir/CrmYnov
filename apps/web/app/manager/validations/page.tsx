"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { parseClosureRequests, type ClosureRequestRecord } from "../../leads/[leadId]/lead-workflow-forms";

export default function ValidationsPage(): React.JSX.Element {
  const [items, setItems] = useState<ClosureRequestRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [canManage, setCanManage] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(): Promise<void> {
    try {
      const response = await fetch("/api/crm/closure-requests", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("requests_unavailable");
      const data = await response.json() as { items?: ClosureRequestRecord[]; canManage?: boolean };
      if (!Array.isArray(data.items)) throw new Error("requests_invalid");
      const leadIds = [...new Set(data.items.map((item) => item.leadId))];
      setItems(leadIds.flatMap((leadId) => parseClosureRequests(data, leadId)).filter((item) => item.state === "PENDING"));
      setCanManage(data.canManage === true); setState("ready");
    } catch { setState("error"); }
  }
  useEffect(() => { void load(); }, []);
  async function reconcile(): Promise<void> {
    if (busy) return;
    setBusy(true); setFeedback("");
    try {
      const response = await fetch("/api/crm/closure-requests/reconcile-notifications", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("reconcile_unconfirmed");
      setFeedback("Les responsables autorisés disposent des notifications des demandes en attente.");
      await load();
    } catch { setFeedback("La transmission n’a pas pu être confirmée. Actualisez avant de réessayer."); }
    finally { setBusy(false); }
  }
  return <main className="lead-workflow-page"><header><p className="eyebrow">Supervision commerciale</p><h1>Demandes à valider</h1><p>Les étapes commerciales et clôtures attendent une décision d’un responsable distinct du demandeur.</p></header>
    {state === "loading" ? <p role="status">Chargement des demandes…</p> : null}
    {state === "error" ? <p role="alert">Les demandes sont indisponibles. <button onClick={() => void load()}>Réessayer</button></p> : null}
    {state === "ready" ? <section className="panel"><h2>{items.length} demande(s) en attente</h2>{items.length ? <ul>{items.map((item) => <li key={item.id}><strong>{{ PROSPECT: "Prospect", CONTACTED: "Contacté", QUALIFIED: "Qualifié", ENROLLED: "Inscrit", CLOSED_LOST: "Sans suite" }[item.target]}</strong><p>{item.comment}</p>{item.canDecide ? <Link href={`/leads/${encodeURIComponent(item.leadId)}/closure`}>Examiner la demande</Link> : <span>En attente d’un autre superviseur</span>}</li>)}</ul> : <p>Aucune demande en attente.</p>}
      {canManage ? <button className="secondary-button" disabled={busy} onClick={() => void reconcile()}>Vérifier la transmission aux responsables</button> : null}
      {feedback ? <p role="status">{feedback}</p> : null}
    </section> : null}
  </main>;
}
