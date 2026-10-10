import React from "react";
import { apiString, type ApiObject } from "../../_components/connected-resource";
import { sheetApiObject } from "./sheets-client";

export function SheetAppendMonitor({ state, busy, sourceUnavailable, connectorEnabled, action }: {
  state: ApiObject | null; busy: boolean; sourceUnavailable: boolean; connectorEnabled: boolean;
  action: (value: "status" | "boundary" | "observations" | "qualification") => Promise<void>;
}): React.JSX.Element {
  const registered = state?.boundaryRegistered === true;
  const counts = sheetApiObject(state?.counts);
  return <section className="sheets-append-monitor" aria-label="Frontière et réception des nouvelles lignes">
    <h3>Réception après la frontière N0</h3>
    <p>Observer conserve les nouvelles positions sans créer de Lead. Une observation n’est ni une qualification de bascule ni une activation. Les arrivées entre capture et activation restent éligibles ; une relance ne crée pas de nouvelle baseline.</p>
    <div className="sheets-controls">
      <button type="button" disabled={busy} onClick={() => { void action("status"); }}>Lire la frontière et les positions</button>
      <button type="button" disabled={busy || state === null || registered || connectorEnabled} onClick={() => { void action("boundary"); }}>Enregistrer la frontière privée vérifiée</button>
      <button type="button" disabled={busy || !registered || connectorEnabled || sourceUnavailable || state?.suspended === true} onClick={() => { void action("observations"); }}>Observer sans effet métier</button>
      <button type="button" disabled={busy || !registered || connectorEnabled || state?.suspended === true} onClick={() => { void action("qualification"); }}>Vérifier le dossier serveur de qualification</button>
    </div>
    {state === null ? <p>État non lu. Aucun N0 ni résultat n’est présumé.</p> : registered ? <>
      <dl className="sheets-append-positions">{[
        ["Frontière historique N0", apiString(state, "boundaryRow", "Indisponible")],
        ["Capture UTC", apiString(state, "capturedAt", "Indisponible")],
        ["Génération", apiString(state, "generation", "Indisponible")],
        ["Dernière position observée", apiString(state, "lastObservedRow", "Indisponible")],
        ["Dernière position durable", apiString(state, "lastDurableRow", "Indisponible")],
        ["Dernière position confirmée", apiString(state, "lastConfirmedRow", "Aucune")],
        ["En attente", apiString(counts, "pending", "Indisponible")],
        ["Incomplètes", apiString(counts, "incomplete", "Indisponible")],
        ["À vérifier", apiString(counts, "review", "Indisponible")],
        ["Confirmées", apiString(counts, "confirmed", "Indisponible")],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p>La dernière position confirmée ne prouve pas que toutes les positions précédentes sont traitées. Date originale de soumission : inconnue ; première observation conservée séparément.</p>
      <p>Dossier de qualification : <strong>{state.qualificationRegistered === true ? "enregistré — autorisations et validité revérifiées à chaque exécution" : "non acquis"}</strong>. Condition d’ajout en fin d’onglet : {state.producerConditionConfirmed === true ? "confirmation documentée côté serveur" : "non confirmée"}. Aucun identifiant ou horodatage original amont attesté.</p>
      {state.suspended === true ? <p role="alert" className="sheets-error">Réception suspendue. Vérification et résolution explicites requises ; aucune nouvelle baseline automatique.</p> : null}
    </> : <p>Frontière non enregistrée dans cet environnement. Le fichier serveur privé et son empreinte sont nécessaires ; aucun contenu du Sheet n’est envoyé par ce formulaire.</p>}
    <p>Le dossier de qualification lie la frontière, le mapping, le gel Excel et la réconciliation. Des dossiers non résolus restent bloquants pour l’armement global tant qu’un contrat borné distinct n’est pas qualifié. Les données personnelles ne sont pas affichées ici.</p>
  </section>;
}
