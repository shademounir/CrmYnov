"use client";

import { useState } from "react";

export function AssignmentForm(): React.JSX.Element {
  const [state, setState] = useState("idle");
  async function submit(formData: FormData): Promise<void> {
    setState("submitting");
    const leadIdValue = formData.get("leadId");
    const targetValue = formData.get("targetUserId");
    const actionValue = formData.get("action");
    const leadId = typeof leadIdValue === "string" ? leadIdValue : "";
    const targetUserId = typeof targetValue === "string" ? targetValue : "";
    const action = typeof actionValue === "string" ? actionValue : "preview";
    const idempotencyKey = `ui-assignment:${crypto.randomUUID()}`;
    const preview = action === "preview";
    const response = await fetch(preview ? "/api/crm/lead-assignments/preview" : `/api/crm/leads/${encodeURIComponent(leadId)}/assignment`, {
      method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" },
      body: JSON.stringify(preview ? { idempotencyKey, strategy: "FIXED", targetUserId, items: [{ leadId, source: "UI_LOCAL", campaign: "UI_LOCAL" }] } : { targetUserId, confirmed: true, idempotencyKey }),
    });
    setState(response.ok ? (preview ? "previewed" : "confirmed") : "error");
  }
  return <form action={submit} aria-label="Prévisualiser ou confirmer une affectation"><label>Lead<input name="leadId" required /></label><label>Conseiller cible<input name="targetUserId" required /></label><button name="action" value="preview" type="submit">Prévisualiser sans modifier</button><button name="action" value="confirm" type="submit">Confirmer via l’API</button>{state === "previewed" ? <p role="status">Prévisualisation validée sans mutation.</p> : null}{state === "confirmed" ? <p role="status">Affectation confirmée par l’API.</p> : null}{state === "error" ? <p role="alert">Opération refusée par l’API.</p> : null}</form>;
}
