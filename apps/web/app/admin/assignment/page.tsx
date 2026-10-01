import { AutomationControl } from "./automation-control";

export default function AssignmentConfigurationPage(): React.JSX.Element {
  return <main>
    <h1>Configuration des affectations</h1>
    <p>Réservé aux Managers et Administrateurs. Toute modification est historisée.</p>
    <AutomationControl />
    <p>Stratégies gouvernées : ROUND_ROBIN et CONTROLLED_RANDOM. Simuler sans modifier via le parcours d’import ; une décision seule ne modifie aucun Lead.</p>
    <section><h2>Garanties</h2><p>Les comptes inactifs, suspendus, exclus ou à capacité atteinte sont écartés. Une ambiguïté de règles bloque l’affectation.</p></section>
  </main>;
}
