import React from "react";

const providers = [
  { mode: "MANUAL_EXTERNAL", state: "Disponible localement", detail: "L’appel est réalisé hors CRM puis journalisé manuellement." },
  { mode: "COOVOX", state: "Non configuré", detail: "Connexion PBX gelée — provider_not_configured." },
  { mode: "LINPHONE", state: "Non configuré", detail: "SDK/SIP gelé — provider_not_configured." },
  { mode: "DISABLED", state: "Désactivé", detail: "Aucun déclenchement possible." },
];
export default function TelephonyAdminPage(): React.JSX.Element {
  return <main><h1>Configuration de la téléphonie</h1><p>Réservée au Super Admin. Cette vue ne contient ni identifiant SIP, ni token PBX, ni adresse d’infrastructure.</p><fieldset><legend>Mécanisme fonctionnel</legend>{providers.map((provider) => <label key={provider.mode}><input type="radio" name="mode" value={provider.mode} defaultChecked={provider.mode === "DISABLED"} /> <strong>{provider.mode}</strong> — {provider.state}<small>{provider.detail}</small></label>)}</fieldset><section aria-labelledby="capabilities"><h2 id="capabilities">Capacités code-only</h2><label><input type="checkbox" /> Click-to-call</label><label><input type="checkbox" /> Appels entrants</label><label><input type="checkbox" /> Appels sortants</label><label>Politique d’enregistrement <select defaultValue="DISABLED"><option>DISABLED</option><option>METADATA_ONLY</option></select></label><button type="button">Enregistrer la configuration fonctionnelle</button></section><aside role="note"><strong>Activation réelle gelée.</strong> Coovox, Linphone, webhook public, audio et secrets nécessitent des autorisations séparées.</aside></main>;
}
