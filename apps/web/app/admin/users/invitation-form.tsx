"use client";

import { useState } from "react";

export function InvitationForm({ collaboratorId, email, eligible }: Readonly<{ collaboratorId: string; email: string; eligible: boolean }>): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "accepted" | "unconfirmed" | "limited" | "ineligible" | "unconfigured">("idle");

  async function send(): Promise<void> {
    if (!confirmed || !collaboratorId || !eligible || state === "sending") return;
    setState("sending");
    try {
      const response = await fetch(`/api/crm/users/${encodeURIComponent(collaboratorId)}/invitations`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      const result = response.ok ? {} : await response.json().catch(() => ({})) as { code?: string };
      setState(response.ok ? "accepted" : result.code === "invitation_rate_limited" ? "limited" : result.code === "invitation_subject_ineligible" ? "ineligible" : result.code === "invitation_transport_unconfigured" ? "unconfigured" : "unconfirmed");
    } catch { setState("unconfirmed"); }
    setConfirmed(false);
  }

  return <section className="users-card" aria-labelledby="invitation-title">
    <h2 id="invitation-title">Invitation par e-mail</h2>
    <p>Le lien est personnel, à usage unique et expire après 20 minutes. Ouvrir le message ne l’utilise pas.</p>
    <p>Destinataire : <strong>{email || "Sélectionnez un compte"}</strong></p>
    {collaboratorId && !eligible ? <p role="note">Ce compte est désactivé ou son premier accès est déjà terminé. Aucune invitation n’est envoyée.</p> : null}
    <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmer l’envoi ou la réémission à cette adresse.</label>
    <button type="button" disabled={!collaboratorId || !eligible || !confirmed || state === "sending"} onClick={() => void send()}>{state === "sending" ? "Envoi…" : "Envoyer l’invitation"}</button>
    {state === "accepted" ? <p role="status">Message accepté par Gmail. Sa réception et l’activation restent à vérifier.</p> : null}
    {state === "unconfirmed" ? <p role="alert">Envoi non confirmé. Vérifiez l’état avant de réémettre ; l’ancien lien peut avoir été révoqué.</p> : null}
    {state === "limited" ? <p role="alert">Trop de réémissions pour ce compte. Réessayez plus tard, sans recréer de compte.</p> : null}
    {state === "ineligible" ? <p role="alert">Ce compte n’est plus éligible à l’invitation. Rechargez sa fiche.</p> : null}
    {state === "unconfigured" ? <p role="alert">L’envoi Gmail n’est pas encore configuré sur cet environnement. Aucun message n’a été envoyé.</p> : null}
  </section>;
}
