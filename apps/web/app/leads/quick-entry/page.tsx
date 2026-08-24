"use client";
import { useState } from "react";

export default function QuickLeadPage(): React.JSX.Element {
  const [channel, setChannel] = useState<"PHONE_CALL" | "PHYSICAL_VISIT">("PHONE_CALL");
  return <main><h1>Nouveau lead après {channel === "PHONE_CALL" ? "appel" : "visite"}</h1>
    <p>Commencez par rechercher l’email et le téléphone. Un nom seul ne déclenche jamais de rapprochement.</p>
    <nav><button type="button" onClick={() => setChannel("PHONE_CALL")}>Après appel</button>
      <button type="button" onClick={() => setChannel("PHYSICAL_VISIT")}>Après visite</button></nav>
    <form><input type="hidden" name="channel" value={channel}/><label>Email<input name="email" type="email"/></label>
      <label>Téléphone<input name="phone" type="tel"/></label><button type="button">Rechercher les correspondances</button>
      <label>Prénom<input name="firstName" required/></label><label>Nom<input name="lastName" required/></label>
      <label>Campus<input name="campus"/></label><label>Niveau<input name="educationLevel"/></label>
      <label>Formation<input name="program"/></label><label>Prochaine relance<input name="nextActionAt" type="datetime-local"/></label>
      <label>Affectation<select name="assignment"><option value="UNASSIGNED">Non affecté</option><option value="FIXED">Manuelle</option>
        <option value="ROUND_ROBIN">Round-robin</option><option value="CONTROLLED_RANDOM">Aléatoire contrôlé</option></select></label>
      <button type="submit">Confirmer la création ou l’activité</button></form>
    <p>Une correspondance fiable conserve le statut, l’affectataire et la source originale du lead.</p></main>;
}
