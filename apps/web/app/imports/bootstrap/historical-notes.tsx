"use client";

import React, { useEffect, useState } from "react";
import { bootstrapFailure, bootstrapRequest, type HistoricalNote } from "./bootstrap-client";
import styles from "./bootstrap-styles";

interface HistoricalDateEvidence { column: string; reference: string; date1904: boolean; cell: { value: string | number | boolean | null; raw: string | null; type: string; formula?: { text: string }; style?: string } }
interface HistoricalProvenance { sheet: string; rowNumber: number; cycleLabel: string; sourceOwner: string | null; replacementOwner: string | null; originalSource: string | null; rawStatus: string | null; receivedDateEvidence?: HistoricalDateEvidence | null }
interface NotesPage { items: HistoricalNote[]; historical: true; truncated?: boolean; provenance?: HistoricalProvenance[]; provenanceTruncated?: boolean }
function importedAtLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "medium", timeStyle: "short" }).format(date) : "date technique à vérifier";
}
export function HistoricalNotesList({ notes, truncated = false, provenance = [], provenanceTruncated = false }: Readonly<{ notes: HistoricalNote[]; truncated?: boolean; provenance?: HistoricalProvenance[]; provenanceTruncated?: boolean }>): React.JSX.Element {
  return <section className={styles.notes} aria-labelledby="historical-notes-title"><h2 id="historical-notes-title">Commentaires de reprise historique</h2>
    <p>Ces textes source ne sont pas des interactions commerciales nouvelles. Leur import n’invente ni date d’échange ni auteur.</p>
    {notes.map((note) => <article key={note.id}><h3>Commentaire importé · {note.author?.trim() ? "date source inconnue" : "date et auteur source inconnus"}</h3><p className={styles.sourceText}>{note.text}</p>{note.author?.trim() ? <small>Auteur source déclaré : {note.author} · pas une identité CRM authentifiée.</small> : null}<small>Provenance : {note.sourceSheet} · cellule {note.sourceColumn}{note.sourceRow}. Conservation dans le CRM : {importedAtLabel(note.importedAt)} · heure de Casablanca, pas date de l’échange.</small></article>)}
    {!notes.length ? <p>Aucun commentaire historique importé pour ce dossier.</p> : null}
    {truncated ? <p role="status">Cette lecture est bornée à 1 000 commentaires. Elle ne prouve pas l’absence d’autres commentaires ; consultez le rapport de reprise du lot.</p> : null}
    {provenance.length ? <div><h3>Provenance du portefeuille repris</h3><p>Les responsables et statuts ci-dessous sont ceux du fichier source, pas une réaffectation ou une décision commerciale nouvelle.</p>{provenance.map((item, index) => <article key={`${item.sheet}:${item.rowNumber}:${index}`}><h3>{item.sheet} · ligne {item.rowNumber}</h3><dl className={styles.valueGrid}><div><dt>Cycle source</dt><dd>{item.cycleLabel || "Cycle à préciser"}</dd></div><div><dt>Responsable initial source</dt><dd>{item.sourceOwner ?? "Non renseigné"}</dd></div><div><dt>Nouveau responsable source prioritaire</dt><dd>{item.replacementOwner ?? "Non renseigné"}</dd></div><div><dt>Source / canal original</dt><dd>{item.originalSource ?? "Non renseigné"}</dd></div><div><dt>Statut original du fichier</dt><dd>{item.rawStatus ?? "Non renseigné"}</dd></div></dl>{item.receivedDateEvidence ? <div><h3>Date de réception · preuve source non interprétée</h3><p className={styles.sourceText}>{item.receivedDateEvidence.cell.raw ?? String(item.receivedDateEvidence.cell.value ?? "Non renseignée")}</p><small>Cellule {item.receivedDateEvidence.reference} · type {item.receivedDateEvidence.cell.type} · système de dates Excel {item.receivedDateEvidence.date1904 ? "1904" : "1900"}{item.receivedDateEvidence.cell.style ? ` · style ${item.receivedDateEvidence.cell.style}` : ""}. Cette provenance ne remplace pas la date technique de création du Lead et ne déduit aucune rentrée.</small>{item.receivedDateEvidence.cell.formula ? <p className={styles.sourceText}>Formule source non exécutée : {item.receivedDateEvidence.cell.formula.text}</p> : null}</div> : null}</article>)}{provenanceTruncated ? <p role="status">La provenance affichée est bornée. Consultez le rapport du lot pour les autres occurrences ; aucun total complet n’est déduit.</p> : null}</div> : null}
  </section>;
}
export function HistoricalNotes({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [page, setPage] = useState<NotesPage | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setPage(null); setError("");
    void bootstrapRequest<NotesPage>(`/leads/${encodeURIComponent(leadId)}/notes`, { signal: controller.signal })
      .then(setPage).catch((failure: unknown) => { if (!controller.signal.aborted) setError(bootstrapFailure(failure)); });
    return (): void => controller.abort();
  }, [leadId]);
  if (error) return <section role="alert"><h2>Commentaires historiques indisponibles</h2><p>{error}</p><p>Cette erreur ne signifie pas que le dossier n’a aucun commentaire.</p></section>;
  if (!page) return <p role="status">Lecture des commentaires historiques conservés…</p>;
  return <HistoricalNotesList notes={page.items} truncated={page.truncated ?? false} provenance={page.provenance ?? []} provenanceTruncated={page.provenanceTruncated ?? false} />;
}
export function HistoricalNotesDisclosure({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [opened, setOpened] = useState(false);
  return <details className={styles.mapping} onToggle={(event) => setOpened(event.currentTarget.open)}><summary>Commentaires de reprise historique · provenance distincte</summary>{opened ? <HistoricalNotes leadId={leadId} /> : <p>Ouvrez pour lire les commentaires source autorisés ; aucun échange commercial n’est fabriqué.</p>}</details>;
}
