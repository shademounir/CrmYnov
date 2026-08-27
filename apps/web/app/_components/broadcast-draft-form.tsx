"use client";

import { useState } from "react";

export function broadcastPayload(formData: FormData, requestId: string): Record<string, unknown> {
  const campusValue = formData.get("campusId");
  const campusId = typeof campusValue === "string" ? campusValue : "";
  return { title: formData.get("title"), content: formData.get("content"), audience: { campusIds: [campusId] }, clientRequestId: requestId };
}

export function BroadcastDraftForm(): React.JSX.Element {
  const [state, setState] = useState("idle");
  async function submit(formData: FormData): Promise<void> {
    setState("submitting");
    const response = await fetch("/api/crm/broadcasts", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(broadcastPayload(formData, `ui-broadcast:${crypto.randomUUID()}`)) });
    setState(response.ok ? "success" : "error");
  }
  return <form action={submit} aria-label="Créer un broadcast interne"><label>Titre<input name="title" minLength={3} maxLength={120} required /></label><label>Contenu<textarea name="content" minLength={3} maxLength={4000} required /></label><label>Campus<input name="campusId" required /></label><button type="submit">Créer le brouillon via l’API</button>{state === "success" ? <output>Brouillon créé. La prévisualisation et la confirmation restent des actions distinctes.</output> : null}{state === "error" ? <p role="alert">Création refusée par l’API.</p> : null}</form>;
}
