import { RecoveryForm } from "./recovery-form";

export default function AccessRecoveryPage(): React.JSX.Element {
  return (
    <main>
      <h1>Récupérer mon accès</h1>
      <p>Utilisez uniquement votre adresse professionnelle.</p>
      <RecoveryForm />
    </main>
  );
}
