"use client";

import React, { useState } from "react";
import { bootstrapFields, type BootstrapContext, type BootstrapPackage, type BootstrapSheetMapping } from "./bootstrap-client";
import styles from "./bootstrap-styles";

export function BootstrapMapping({ source, context, mappings, disabled, onChange, onSave }: Readonly<{
  source: BootstrapPackage; context: BootstrapContext; mappings: BootstrapSheetMapping[]; disabled: boolean;
  onChange: (value: BootstrapSheetMapping[]) => void; onSave: () => void;
}>): React.JSX.Element {
  const campaigns = context.campaigns.filter((item) => item.campusId === null || item.campusId === source.campusId);
  const owners = context.owners.filter((item) => item.campusId === source.campusId);
  function change(index: number, next: BootstrapSheetMapping): void { onChange(mappings.map((item, position) => position === index ? next : item)); }
  return <section className={styles.card} aria-labelledby="bootstrap-mapping-title">
    <h2 id="bootstrap-mapping-title">2. Mapping et rapprochement des responsables</h2>
    <p>Quatre feuilles uniquement, en-tête ligne 6. Choisissez les colonnes réelles ; aucune formation, campagne ou affectation n’est inventée. Le niveau et la formation réellement absents pourront rester explicitement à préciser dans la reprise historique, selon la vérification du serveur. Une valeur présente, ambiguë ou calculée ne doit pas être vidée pour éviter sa revue. Les colonnes contenant des données sans intitulé en ligne 6 restent à qualifier explicitement, sans interprétation automatique. Le nouveau responsable renseigné prime sur l’ancien, sans repli silencieux.</p>
    {mappings.map((mapping, index) => {
      const sheet = source.sheets.find((item) => item.name === mapping.name);
      if (!sheet) return null;
      return <details className={styles.mapping} key={mapping.name} open={index === 0}>
        <summary>{mapping.name} · {sheet.rowCount} occurrence(s) source</summary>
        <label>Regroupement de campagne existant<select disabled={disabled} value={mapping.campaign} onChange={(event) => change(index, { ...mapping, campaign: event.target.value })}>
          <option value="">À préciser · aucune campagne par défaut</option>{campaigns.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select></label>
        <div className={styles.columns}>{bootstrapFields.map(([field, label]) => <label key={field}>{label}<select disabled={disabled} value={mapping.fields[field] ?? ""} onChange={(event) => {
          const fields = { ...mapping.fields }; if (event.target.value) fields[field] = event.target.value; else delete fields[field]; change(index, { ...mapping, fields, excludedColumns: (mapping.excludedColumns ?? []).filter((item) => item.column !== event.target.value) });
        }}><option value="">Non fourni / à vérifier</option>{sheet.columns.map((column) => <option key={column.letter} value={column.letter}>{column.letter} · {column.name || "Sans intitulé en ligne 6"}</option>)}</select></label>)}</div>
        <fieldset><legend>Colonnes de commentaires historiques · dix maximum</legend><div className={styles.checkboxes}>{sheet.columns.map((column) => <label className={styles.check} key={column.letter}><input type="checkbox" disabled={disabled || (!mapping.commentColumns.includes(column.letter) && mapping.commentColumns.length >= 10)} checked={mapping.commentColumns.includes(column.letter)} onChange={(event) => change(index, { ...mapping, commentColumns: event.target.checked ? [...mapping.commentColumns, column.letter] : mapping.commentColumns.filter((item) => item !== column.letter), excludedColumns: event.target.checked ? (mapping.excludedColumns ?? []).filter((item) => item.column !== column.letter) : mapping.excludedColumns ?? [] })} />{column.letter} · {column.name || "Sans intitulé en ligne 6"}</label>)}</div></fieldset>
        <p>Un commentaire reste du texte source exact. Sa date et son auteur historiques ne sont pas déduits de la date de reprise.</p>
        <SourceExclusions mapping={mapping} columns={sheet.columns} disabled={disabled} onChange={(excludedColumns) => change(index, { ...mapping, excludedColumns })} />
        <OwnerAliases aliases={mapping.ownerAliases} owners={owners} disabled={disabled} onChange={(ownerAliases) => change(index, { ...mapping, ownerAliases })} />
      </details>;
    })}
    <div className={styles.actions}><button className="primary-button" type="button" disabled={disabled || mappings.length !== 4 || mappings.some((item) => !item.campaign || !item.fields.firstName || !item.fields.lastName || (!item.fields.email && !item.fields.phone) || (item.excludedColumns ?? []).some((entry) => entry.reason.trim().length < 8))} onClick={onSave}>Enregistrer le mapping R8 et analyser</button></div>
    <p>Cette étape persiste le plan et ses anomalies ; elle ne crée aucun dossier. Les cellules calculées ne sont jamais exécutées ni automatiquement traitées comme des faits.</p>
  </section>;
}

function SourceExclusions({ mapping, columns, disabled, onChange }: Readonly<{ mapping: BootstrapSheetMapping; columns: BootstrapPackage["sheets"][number]["columns"]; disabled: boolean; onChange: (value: NonNullable<BootstrapSheetMapping["excludedColumns"]>) => void }>): React.JSX.Element {
  const exclusions = mapping.excludedColumns ?? [];
  const unmapped = columns.filter((column) => !Object.values(mapping.fields).includes(column.letter) && !mapping.commentColumns.includes(column.letter));
  return <details className={styles.mapping}><summary>{unmapped.length} colonne(s) sans destination · aucun oubli silencieux</summary><p>Une cellule non vide hors des champs et commentaires reste bloquante, sauf exclusion explicitement justifiée. Le texte source demeure dans le fichier scellé ; ne retirez pas un commentaire utile pour accélérer le lot.</p>
    {unmapped.map((column) => {
      const excluded = exclusions.find((item) => item.column === column.letter);
      return <div className={styles.form} key={column.letter}><label className={styles.check}><input type="checkbox" checked={!!excluded} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...exclusions, { column: column.letter, reason: "" }] : exclusions.filter((item) => item.column !== column.letter))} />Exclure explicitement {column.letter} · {column.name || "Sans intitulé en ligne 6"}</label>
        {excluded ? <label>Motif conservé pour la colonne {column.letter} · huit caractères minimum<textarea value={excluded.reason} disabled={disabled} minLength={8} maxLength={500} required onChange={(event) => onChange(exclusions.map((item) => item.column === column.letter ? { ...item, reason: event.target.value } : item))} /></label> : null}
      </div>;
    })}
    {!unmapped.length ? <p>Toutes les colonnes ont une destination explicite. La couverture des cellules est vérifiée ensuite par le serveur.</p> : null}
  </details>;
}

function OwnerAliases({ aliases, owners, disabled, onChange }: Readonly<{ aliases: Record<string, string>; owners: BootstrapContext["owners"]; disabled: boolean; onChange: (aliases: Record<string, string>) => void }>): React.JSX.Element {
  const [alias, setAlias] = useState(""), [ownerId, setOwnerId] = useState("");
  return <div><h3>Alias source → compte actif autorisé</h3><p>Laissez les alias ambigus sans correspondance. Le serveur vérifie le campus et les droits du compte au moment de l’exécution.</p>
    {Object.entries(aliases).map(([literal, id]) => <div className={styles.alias} key={literal}><span className={styles.sourceText}>{literal}</span><span>{owners.find((item) => item.id === id)?.label ?? "Compte à revalider"}</span><button className="secondary-button" type="button" disabled={disabled} onClick={() => { const next = { ...aliases }; delete next[literal]; onChange(next); }}>Retirer</button></div>)}
    <div className={styles.alias}><label>Alias exact du fichier<input value={alias} maxLength={120} disabled={disabled} onChange={(event) => setAlias(event.target.value)} /></label>
      <label>Compte CRM<select value={ownerId} disabled={disabled} onChange={(event) => setOwnerId(event.target.value)}><option value="">Aucun rapprochement</option>{owners.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <button className="secondary-button" type="button" disabled={disabled || !alias.trim() || !ownerId || Object.keys(aliases).length >= 100} onClick={() => { onChange({ ...aliases, [alias.trim()]: ownerId }); setAlias(""); setOwnerId(""); }}>Ajouter l’alias</button>
    </div>
  </div>;
}
