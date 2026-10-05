import { RecoveryForm } from "./recovery-form";

export const dynamic = "force-dynamic";

export default function AccessRecoveryPage(): React.JSX.Element {
  return <main className="login-page"><section className="login-panel"><div className="login-card">
      <p className="eyebrow">Espace sécurisé</p><h1>Récupérer mon accès</h1>
      <p className="muted">Utilisez uniquement votre adresse professionnelle. Le lien reçu sera personnel et temporaire.</p>
      <RecoveryForm />
      <p><a href="/">Revenir à la connexion</a></p>
    </div></section></main>;
}
