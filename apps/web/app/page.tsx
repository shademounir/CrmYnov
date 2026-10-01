import { LoginForm } from "./_components/login-form";
import Image from "next/image";

export default function Home(): React.JSX.Element {
  return <main className="login-page">
    <section className="login-brand" aria-label="Présentation du CRM Admissions">
      <Image src="/brand/ynov-campus-maroc.png" alt="Maroc Ynov Campus" width={244} height={137} priority />
      <span className="angle-mark" aria-hidden="true" />
      <p>CRM Admissions & Prospection</p>
      <h1>Chaque opportunité mérite un suivi clair.</h1>
      <p>Centralisez les admissions, organisez les priorités et accompagnez chaque lead avec précision.</p>
    </section>
    <section className="login-panel">
      <div className="login-card">
        <p className="eyebrow">Espace sécurisé</p>
        <h2>Bienvenue</h2>
        <p className="muted">Connectez-vous à votre CRM local persistant.</p>
        <LoginForm />
        <p className="security-note">Vos identifiants sont transmis uniquement à l’API locale sécurisée.</p>
      </div>
    </section>
  </main>;
}
