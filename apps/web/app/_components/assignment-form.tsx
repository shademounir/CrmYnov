"use client";

import { useState } from "react";

export function assignmentRequest(leadId: string, targetUserId: string, action: string, idempotencyKey: string): { endpoint: string; body: Record<string, unknown>; preview: boolean } {
  const preview = action === "preview";
  if (preview) return { endpoint: "/api/crm/lead-assignments/preview", preview, body: { idempotencyKey, strategy: "FIXED", targetUserId, items: [{ leadId, source: "UI_LOCAL", campaign: "UI_LOCAL" }] } };
  return { endpoint: `/api/crm/leads/${encodeURIComponent(leadId)}/assignment`, preview, body: { targetUserId, confirmed: true, idempotencyKey } };
}

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
    const request = assignmentRequest(leadId, targetUserId, action, idempotencyKey);
    const response = await fetch(request.endpoint, {
      method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
    });
    let nextState = "error";
    if (response.ok) nextState = request.preview ? "previewed" : "confirmed";
    setState(nextState);
  }
  return <form action={submit} aria-label="Prévisualiser ou confirmer une affectation"><label>Lead<input name="leadId" required /></label><label>Conseiller cible<input name="targetUserId" required /></label><button name="action" value="preview" type="submit">Prévisualiser sans modifier</button><button name="action" value="confirm" type="submit">Confirmer via l’API</button>{state === "previewed" ? <output>Prévisualisation validée sans mutation.</output> : null}{state === "confirmed" ? <output>Affectation confirmée par l’API.</output> : null}{state === "error" ? <p role="alert">Opération refusée par l’API.</p> : null}</form>;
}
