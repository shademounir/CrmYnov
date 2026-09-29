"use client";

import { useEffect, useState } from "react";

type State = "loading" | "ready" | "saving" | "used" | "expired" | "revoked" | "invalid" | "unavailable" | "complete";

export default function InvitationPage(): React.JSX.Element {
  const [code, setCode] = useState("");
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    const fragment = new URLSearchParams(globalThis.location.hash.slice(1));
    const candidate = fragment.get("code") ?? "";
    globalThis.history.replaceState(null, "", "/invitation");
    setCode(candidate);
    setState(/^[A-Za-z0-9_-]{40,128}$/.test(candidate) ? "ready" : "invalid");
  }, []);

  async function submit(formData: FormData): Promise<void> {
    const nextSecret = formData.get("nextSecret");
    const confirm = formData.get("confirmation");
    if (typeof nextSecret !== "string" || typeof confirm !== "string") { setState("invalid"); return; }
    if (nextSecret !== confirm || nextSecret.length < 14) { setState("invalid"); return; }
    setState("saving");
    try {
      const response = await fetch("/api/crm/invitations/completions", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, nextSecret }) });
      if (response.ok) { setCode(""); setState("complete"); return; }
      const result = await response.json().catch(() => ({})) as { code?: string };
      setState(result.code === "invitation_expired" ? "expired" : result.code === "invitation_already_used" ? "used" : result.code === "invitation_revoked" ? "revoked" : response.status === 403 ? "invalid" : "unavailable");
    } catch { setState("unavailable"); }
  }

  return <main className="login-page"><section className="login-panel"><div className="login-card">
    <p className="eyebrow">Invitation personnelle</p><h1>Définir mon mot de passe</h1>
    {state === "loading" ? <p role="status">Vérification du lien…</p> : null}
    {state === "complete" ? <p role="status">Mot de passe enregistré. <a href="/">Se connecter</a></p> : null}
    {["ready", "saving", "invalid", "unavailable"].includes(state) && code ? <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} aria-label="Définir le mot de passe du compte invité">
      <label>Nouveau mot de passe<input name="nextSecret" type="password" autoComplete="new-password" minLength={14} required /></label>
      <label>Confirmer le mot de passe<input name="confirmation" type="password" autoComplete="new-password" minLength={14} required /></label>
      <p>14 caractères minimum, avec majuscule, minuscule, chiffre et symbole, sans espace.</p>
      <button className="primary-button" type="submit" disabled={state === "saving"}>{state === "saving" ? "Enregistrement…" : "Activer mon accès"}</button>
    </form> : null}
    {state === "invalid" ? <p role="alert">Lien invalide ou mot de passe non conforme. Vérifiez le lien et les deux saisies.</p> : null}
    {state === "expired" ? <p role="alert">Cette invitation a expiré. Demandez une nouvelle invitation à l’administration.</p> : null}
    {state === "used" ? <p role="alert">Cette invitation a déjà été utilisée. Connectez-vous ou demandez de l’aide.</p> : null}
    {state === "revoked" ? <p role="alert">Cette invitation a été révoquée. Demandez une nouvelle invitation.</p> : null}
    {state === "unavailable" ? <p role="alert">L’activation n’a pas pu être confirmée. Vérifiez avec l’administration avant un nouvel essai.</p> : null}
  </div></section></main>;
}
