import type { Metadata } from "next";

export const metadata: Metadata = { title: "Conditions d’utilisation — CRM Ynov" };
export default function TermsPage(): React.JSX.Element {
  return <article><h1>Conditions d’utilisation interne</h1><p>Le CRM Ynov est réservé aux utilisateurs autorisés, pour les missions de suivi commercial et d’admissions correspondant à leurs droits.</p>
    <h2>Compte personnel</h2><p>Chaque utilisateur doit conserver ses identifiants et liens d’activation ou de récupération confidentiels. Un lien personnel ne doit pas être partagé. Tout accès inattendu doit être signalé au support.</p>
    <h2>Respect des périmètres</h2><p>Les données ne doivent être consultées ou modifiées que pour les besoins autorisés. Les permissions de l’interface ne remplacent pas les contrôles serveur. Les invitations, imports et décisions restent soumis à leurs confirmations et règles métier.</p>
    <h2>Pilote et disponibilité</h2><p>Le pilote est limité aux fonctions effectivement activées et vérifiées dans l’environnement utilisé. La présence de ces pages ne garantit ni un service continu ni l’activation de toutes les intégrations. Les fonctionnalités indisponibles ne doivent pas être contournées.</p>
    <h2>Assistance</h2><p>Contact : <a href="mailto:casablancaynovcampus@gmail.com">casablancaynovcampus@gmail.com</a>. Les présentes règles d’usage interne ne remplacent pas les dispositions institutionnelles applicables.</p>
  </article>;
}
