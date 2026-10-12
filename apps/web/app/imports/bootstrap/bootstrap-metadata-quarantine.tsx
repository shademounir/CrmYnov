import type { BootstrapMetadataQuarantine } from "./bootstrap-client";
import styles from "./bootstrap-styles";

export function BootstrapMetadataQuarantineView({ items }: Readonly<{ items: BootstrapMetadataQuarantine[] }>): React.JSX.Element | null {
  if (!items.length) return null;
  return <section aria-label="Quarantaine documentaire des en-têtes" className={styles.mapping}>
    <h3>Annotations d’en-tête conservées · {items.length}</h3>
    <p>Hors population Lead : aucune création de dossier ni interaction. La source reste intacte et la quarantaine documentaire reste ouverte ; ce résultat n’est pas une réconciliation globale complète.</p>
    {items.map((item) => <details key={item.key} className={styles.mapping}>
      <summary>{item.sheet} · cellule {item.annotation.reference} · métadonnée en quarantaine</summary>
      <p>{item.reason}</p>
      <small>Annotation {item.annotation.annotationId} · relation {item.annotation.relationshipId} · {item.annotation.author ? `auteur source déclaré : ${item.annotation.author}` : "auteur source inconnu"} · {item.annotation.sourceDate ? `date source déclarée : ${item.annotation.sourceDate}, pas une action CRM` : "date source inconnue"}</small>
      <p className={styles.sourceText}>{item.annotation.text}</p>
      <small className={styles.hash}>Clé de preuve : {item.key} · SHA-256 source : {item.sourceSha256}</small>
    </details>)}
  </section>;
}
