import React from "react";

export interface LegacyQuality { rowCount: number; emptyCellCount: number; duplicateEmailRows: number; duplicatePhoneRows: number; unknownStatusRows: number;
  invalidDateRows: number; populatedOwnerRows: number; distinctOwnerCount: number; commentedRows: number; cutoverBlocked: boolean; blockerReasons: string[] }

export function LegacyQualityPanel({ quality }: Readonly<{ quality: LegacyQuality }>): React.JSX.Element {
  return <article><h3>Qualité historique agrégée</h3><p>Cutover : {quality.cutoverBlocked ? "bloqué" : "éligible à une répétition séparée"}</p>
    <ul><li>Cellules vides : {quality.emptyCellCount}</li><li>Doublons email : {quality.duplicateEmailRows}</li>
      <li>Doublons téléphone : {quality.duplicatePhoneRows}</li><li>Statuts inconnus : {quality.unknownStatusRows}</li>
      <li>Dates invalides : {quality.invalidDateRows}</li><li>Responsables renseignés / distincts : {quality.populatedOwnerRows} / {quality.distinctOwnerCount}</li>
      <li>Lignes commentées : {quality.commentedRows}</li></ul>
    {quality.blockerReasons.length ? <p>Motifs : {quality.blockerReasons.join(", ")}</p> : null}</article>;
}
