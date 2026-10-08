import React from "react";
import type { BootstrapReconciliation } from "./bootstrap-client";
import styles from "./bootstrap-styles";

const effects: Readonly<Record<string, string>> = {
  createdOccurrences: "Occurrences créées", linkedOccurrences: "Occurrences rattachées", ignoredOccurrences: "Occurrences écartées avec motif",
  distinctTargetDossiers: "Dossiers cibles distincts", expectedNotes: "Notes attendues pour les occurrences acceptées", persistedNotes: "Notes persistées", exactNotes: "Notes vérifiées exactement",
  expectedRowReceipts: "Reçus de ligne attendus", persistedRowReceipts: "Reçus de ligne persistés", exactRowReceipts: "Reçus de ligne vérifiés",
  expectedProvenance: "Provenances attendues", persistedProvenance: "Provenances persistées", exactProvenance: "Provenances vérifiées",
};
const axes: Readonly<Record<string, string>> = {
  sourceStatus: "Statut brut déclaré dans le fichier", mappedStatus: "Statut prévisualisé après mapping", resolvedStatus: "Statut résolu de la décision historique",
  resolvedOwner: "Responsable résolu de la décision historique", cycle: "Nature des indications de cycle", cyclePeriod: "Période et nature du cycle explicitement retenues",
  mappedTemperature: "Température historique prévisualisée", resolvedTemperature: "Température historique résolue",
  currentDossierStatus: "Statut actuel des dossiers visibles", currentDossierOwner: "Responsable actuel des dossiers visibles",
};

export function BootstrapReconciliationView({ summary }: Readonly<{ summary?: BootstrapReconciliation }>): React.JSX.Element {
  if (!summary) return <p className={styles.notice}>La réconciliation détaillée n’a pas été fournie par l’API. Aucun résultat complet n’est déduit des seuls compteurs.</p>;
  return <section aria-label="Rapprochement des décisions et effets persistés">
    <h3>Décisions, effets et écarts relus</h3>
    <p className={styles.notice}>{summary.complete ? "Effets historiques rapprochés exactement dans ce lot ; ce résultat ne valide pas les autres prérequis de production." : "Le rapprochement conserve des décisions ouvertes ou des écarts. La bascule reste bloquée."}</p>
    {summary.truncated ? <p role="alert">Lecture bornée tronquée : aucune exhaustivité ne peut être déclarée.</p> : null}
    <dl className={styles.valueGrid}><div><dt>Occurrences relues</dt><dd>{summary.totalOccurrences}</dd></div><div><dt>Occurrences non terminées</dt><dd>{summary.unresolvedOccurrences}</dd></div>{Object.entries(effects).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{summary.effects[key] ?? "Non prouvé"}</dd></div>)}</dl>
    <p>Les groupes de contacts se recouvrent : {summary.contacts.email.groups} groupe(s) par e-mail ({summary.contacts.email.occurrences} occurrences) et {summary.contacts.phone.groups} par téléphone ({summary.contacts.phone.occurrences} occurrences). Ce ne sont ni un total de personnes uniques ni une autorisation de fusion.</p>
    <p>Les statuts, responsables et températures historiques ne sont pas les valeurs commerciales actuelles. Un rattachement conserve le suivi du dossier existant.</p>
    {summary.currentDossierAxes.withheld ? <p>{summary.currentDossierAxes.withheld} dossier(s) exclu(s) des axes actuels faute de permission de consultation. Les droits d’import n’élargissent pas les droits sur les dossiers.</p> : null}
    {summary.discrepancies.length ? <div className={styles.table}><table><caption>Écarts persistants à résoudre, jamais masqués</caption><thead><tr><th scope="col">Motif de contrôle</th><th scope="col">Nombre</th></tr></thead><tbody>{summary.discrepancies.map(item => <tr key={item.code}><th scope="row">{item.code}</th><td>{item.count}</td></tr>)}</tbody></table></div> : null}
    {Object.entries(axes).map(([key, label]) => <details className={styles.mapping} key={key}><summary>{label}</summary>{Object.keys(summary.axes[key] ?? {}).length ? <dl className={styles.valueGrid}>{Object.entries(summary.axes[key]!).sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => <div key={value}><dt>{value === "UNSPECIFIED" ? "Non renseigné / cycle à préciser" : value === "UNASSIGNED" ? "Non affecté explicitement" : value}</dt><dd>{count}</dd></div>)}</dl> : <p>Aucune valeur visible dans cet axe ; aucun zéro global n’est inventé.</p>}</details>)}
  </section>;
}
