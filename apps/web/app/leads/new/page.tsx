export default function NewLeadPage(): React.JSX.Element {
  return <main><h1>Créer un lead</h1><p>Les données sont normalisées et les doublons probables sont signalés sans interrompre la saisie.</p>
    <form><label>Prénom<input name="firstName" required/></label><label>Nom<input name="lastName" required/></label>
      <label>Email<input name="email" type="email"/></label><label>Téléphone<input name="phone" type="tel"/></label>
      <label>Campus<input name="campus" required/></label><label>Campagne<input name="campaign" required/></label>
      <label>Niveau<input name="educationLevel" required/></label><label>Formation<input name="program" required/></label>
      <label>Source<input name="source" required/></label><button type="submit">Créer le prospect</button></form>
    <p>Le lead reçoit un identifiant immuable et le statut initial Prospect.</p>
  </main>;
}
