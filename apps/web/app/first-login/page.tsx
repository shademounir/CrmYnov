"use client";

import { useState } from "react";

type Feedback = "idle" | "saving" | "invalid" | "policy" | "session" | "unavailable";

function acceptable(secret: string): boolean {
  return secret.length >= 14 && /[a-z]/.test(secret) && /[A-Z]/.test(secret) && /[0-9]/.test(secret) && /[^a-zA-Z0-9]/.test(secret) && !/\s/.test(secret);
}

export default function FirstLoginPage(): React.JSX.Element {
  const [feedback, setFeedback] = useState<Feedback>("idle");

  async function submit(formData: FormData): Promise<void> {
    const currentSecret = formData.get("currentSecret");
    const nextSecret = formData.get("nextSecret");
    const confirmation = formData.get("confirmation");
    if (typeof currentSecret !== "string" || typeof nextSecret !== "string" || typeof confirmation !== "string") { setFeedback("policy"); return; }
    if (nextSecret !== confirmation || nextSecret === currentSecret || !acceptable(nextSecret)) { setFeedback("policy"); return; }
    setFeedback("saving");
    try {
      const response = await fetch("/api/crm/first-login/change-secret", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentSecret, nextSecret }),
      });
      if (response.ok) { globalThis.location.assign("/"); return; }
      if (response.status === 401) { setFeedback("session"); return; }
      const body = await response.json().catch(() => ({})) as { code?: string };
      setFeedback(body.code === "secret_policy_refused" ? "policy" : body.code === "temporary_credential_invalid" ? "invalid" : "unavailable");
    } catch { setFeedback("unavailable"); }
  }

  return <main className="login-page"><section className="login-panel"><div className="login-card">
    <p className="eyebrow">Accès initial protégé</p>
    <h1>Première connexion</h1>
    <p>Remplacez le secret temporaire avant d’accéder au CRM. Vous devrez ensuite vous reconnecter.</p>
    <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} aria-label="Remplacer le secret temporaire">
      <label>Secret temporaire<input name="currentSecret" type="password" autoComplete="current-password" required /></label>
      <label>Nouveau secret<input name="nextSecret" type="password" autoComplete="new-password" required /></label>
      <label>Confirmer le nouveau secret<input name="confirmation" type="password" autoComplete="new-password" required /></label>
      <p>14 caractères minimum, avec majuscule, minuscule, chiffre et symbole, sans espace.</p>
      <button className="primary-button" type="submit" disabled={feedback === "saving"}>{feedback === "saving" ? "Enregistrement…" : "Remplacer et se reconnecter"}</button>
      {feedback === "policy" ? <p role="alert">Le nouveau secret ne respecte pas les règles ou les deux saisies diffèrent.</p> : null}
      {feedback === "invalid" ? <p role="alert">Le secret temporaire n’a pas été reconnu. Aucun changement n’a été effectué.</p> : null}
      {feedback === "session" ? <p role="alert">La session temporaire a expiré. Reconnectez-vous avec le secret temporaire.</p> : null}
      {feedback === "unavailable" ? <p role="alert">Le changement n’a pas pu être confirmé. Réessayez après vérification du service.</p> : null}
    </form>
    <form action="/api/logout" method="post"><button type="submit" className="secondary-button">Se déconnecter</button></form>
  </div></section></main>;
}
