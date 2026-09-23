"use client";

import { useState } from "react";

export function TemporarySecretForm(): React.JSX.Element {
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [temporarySecret, setTemporarySecret] = useState<string | null>(null);

  async function submit(formData: FormData): Promise<void> {
    setState("submitting");
    setTemporarySecret(null);
    const rawCollaboratorId = formData.get("collaboratorId");
    const rawReason = formData.get("reason");
    const collaboratorId = typeof rawCollaboratorId === "string" ? rawCollaboratorId.trim() : "";
    const reason = typeof rawReason === "string" ? rawReason : "INITIAL_ACCESS";
    const response = await fetch(`/api/crm/users/${encodeURIComponent(collaboratorId)}/temporary-secret`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true, reason }),
    });
    if (!response.ok) { setState("error"); return; }
    const payload = await response.json() as { temporarySecret?: string };
    if (!payload.temporarySecret) { setState("error"); return; }
    setTemporarySecret(payload.temporarySecret);
    setState("success");
  }

  return <section aria-labelledby="temporary-secret-title">
    <h2 id="temporary-secret-title">Accès initial ou renouvellement</h2>
    <p>Le secret temporaire est affiché une seule fois. Il impose un changement à la première connexion et révoque les sessions existantes.</p>
    <form action={submit}>
      <label>Identifiant du collaborateur<input name="collaboratorId" required /></label>
      <label>Motif<select name="reason"><option value="INITIAL_ACCESS">Premier accès</option><option value="USER_REQUEST">Demande utilisateur</option><option value="CREDENTIAL_COMPROMISED">Accès compromis</option></select></label>
      <button disabled={state === "submitting"} type="submit">{state === "submitting" ? "Génération…" : "Générer et révoquer les sessions"}</button>
    </form>
    {state === "success" && temporarySecret ? <output aria-live="polite"><strong>Secret temporaire — à transmettre par un canal approuvé :</strong><code>{temporarySecret}</code><span>Copiez-le maintenant ; il ne sera pas réaffiché.</span></output> : null}
    {state === "error" ? <p role="alert">La génération a été refusée. Aucun secret local n’est supposé créé.</p> : null}
  </section>;
}
