export default function UsersPage(): React.JSX.Element {
  return <main><h1>Administration des collaborateurs</h1><p>Création, filtrage, activation et désactivation réservés au Super Admin.</p><form><input aria-label="Email professionnel" type="email" placeholder="collaborateur@example.invalid" /><input aria-label="Campus" placeholder="campus-synthetique" /><button type="button">Créer le collaborateur</button></form></main>;
}
