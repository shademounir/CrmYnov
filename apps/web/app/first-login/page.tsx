export default function FirstLoginPage(): React.JSX.Element {
  return <main><h1>Première connexion</h1><p>Remplacez le secret temporaire avant d’accéder au CRM.</p><form><input aria-label="Secret temporaire" type="password" autoComplete="current-password" /><input aria-label="Nouveau secret" type="password" autoComplete="new-password" /><button type="button">Remplacer et se reconnecter</button></form></main>;
}
