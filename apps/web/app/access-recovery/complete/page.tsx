import { RecoveryCompletionForm } from "./recovery-completion-form";

export const dynamic = "force-dynamic";

export default function RecoveryCompletionPage(): React.JSX.Element {
  return <main className="login-page"><section className="login-panel"><div className="login-card">
    <p className="eyebrow">Récupération personnelle</p><h1>Définir un nouveau mot de passe</h1>
    <RecoveryCompletionForm />
  </div></section></main>;
}
