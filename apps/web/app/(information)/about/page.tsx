import type { Metadata } from "next";

export const metadata: Metadata = { title: "Présentation — CRM Ynov" };
export default function AboutPage(): React.JSX.Element {
  return <article><h1>CRM Ynov — Admissions et suivi commercial</h1>
    <p>Le CRM est un outil interne destiné aux collaborateurs autorisés pour le suivi des prospects, des admissions, des rendez-vous et du travail d’équipe, dans leur périmètre de campus et de responsabilités.</p>
    <h2>Un accès réservé</h2><p>Les dossiers et fonctions métier nécessitent une authentification. Leur accès reste contrôlé par les permissions serveur. La publication de ces pages d’information ne rend aucun dossier public.</p>
    <h2>Services Google</h2><p>Le connecteur Gmail est conçu pour envoyer les invitations et messages de récupération d’accès depuis la boîte autorisée. Il ne consulte pas la boîte de réception. Un connecteur Sheets distinct permet la lecture d’une source explicitement partagée ; son activation exige une qualification séparée de l’import.</p>
    <h2>Déploiement progressif</h2><p>La disponibilité d’une fonction dépend de l’environnement et de sa configuration. Cette présentation ne vaut ni activation du transport e-mail, ni validation des autorisations Google, ni ouverture générale du service.</p>
  </article>;
}
