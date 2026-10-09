"use client";

import React, { useRef, useState } from "react";
import { CutoverApiError, cutoverFailure, cutoverRequest, type CutoverExceptionCase, type CutoverExceptions as ExceptionsView, type CutoverManifest, type CutoverQuarantineInput, type CutoverQuarantineResult } from "./cutover-client";

const kindLabels = { SOURCE_CHANGED: "Incident de modification conservé", SOURCE_REMOVED: "Incident de disparition conservé", EFFECT_REVIEW: "Effet en revue, non ingéré" } as const;
interface PendingDecision { caseId: string; body: CutoverQuarantineInput }
interface ExceptionsProps {
  manifest: CutoverManifest; busy: boolean;
  onPerform: (operation: () => Promise<void>) => Promise<void>;
  onReadManifest: () => Promise<CutoverManifest>;
}

/** Read on request only. Neither opening this panel nor refreshing it observes or consumes a Sheet. */
export function CutoverExceptions({ manifest, busy, onPerform, onReadManifest }: Readonly<ExceptionsProps>): React.JSX.Element {
  const [view, setView] = useState<ExceptionsView | null>(null), [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const [error, setError] = useState(""), [feedback, setFeedback] = useState(""), [pending, setPending] = useState<ReadonlyMap<string, PendingDecision>>(new Map());
  const lock = useRef(false), path = `/manifests/${encodeURIComponent(manifest.id)}/exceptions`;
  async function read(): Promise<ExceptionsView> {
    const current = await onReadManifest(), result = await cutoverRequest<ExceptionsView>(path);
    if (result.id !== manifest.id || !Number.isSafeInteger(result.version) || result.version < 1) throw new Error("cutover_exception_view_unconfirmed");
    setView(result); setLoadedVersion(result.version);
    if (result.version !== current.version) throw new CutoverApiError(409, "cutover_exception_manifest_read_changed");
    return result;
  }
  async function run(operation: () => Promise<void>): Promise<void> {
    if (lock.current) return; lock.current = true; setError(""); setFeedback("");
    try { await onPerform(async () => { try { await operation(); } catch (failure) { setError(cutoverFailure(failure)); } }); }
    finally { lock.current = false; }
  }
  function clearConfirmed(result: ExceptionsView): void {
    setPending((current) => {
      const next = new Map(current);
      for (const [id, attempt] of current) {
        const entry = result.cases.find((item) => item.id === id);
        if (entry?.evidenceSha256 === attempt.body.evidenceSha256 && entry.disposition?.action === attempt.body.action && entry.disposition.reason === attempt.body.reason) next.delete(id);
      }
      return next;
    });
  }
  async function decide(entry: CutoverExceptionCase, reason: string): Promise<void> {
    // Keep the exact version, evidence, reason and key after an uncertain write. A read never silently rebases that attempt.
    const attempt = pending.get(entry.id) ?? { caseId: entry.id, body: { expectedVersion: loadedVersion!, evidenceSha256: entry.evidenceSha256, action: "QUARANTINE_PRESERVE" as const, reason, confirmed: true as const, idempotencyKey: `cutover-quarantine-${crypto.randomUUID()}` } };
    setPending((current) => new Map(current).set(entry.id, attempt));
    const result = await cutoverRequest<CutoverQuarantineResult>(`${path}/${encodeURIComponent(entry.id)}/disposition`, attempt.body);
    if (result.receipt?.caseId !== entry.id || result.receipt.evidenceSha256 !== attempt.body.evidenceSha256 || result.receipt.action !== attempt.body.action || result.receipt.reason !== attempt.body.reason) throw new Error("cutover_quarantine_receipt_unconfirmed");
    const persisted = await read(), saved = persisted.cases.find((item) => item.id === entry.id);
    if (saved?.evidenceSha256 !== attempt.body.evidenceSha256 || saved.disposition?.action !== attempt.body.action || saved.disposition.reason !== attempt.body.reason) throw new Error("cutover_quarantine_reread_unconfirmed");
    clearConfirmed(persisted);
    setFeedback("Disposition et reçu relus : preuve préservée en quarantaine, non ingérée. Le traitement est suspendu et désarmé ; une nouvelle observation puis une réconciliation restent nécessaires. Aucun effet antérieur n’a été annulé.");
  }
  const stale = loadedVersion !== manifest.version;
  return <section className="cutover-card" aria-labelledby="cutover-exceptions-title" aria-busy={busy}>
    <div className="cutover-heading"><h2 id="cutover-exceptions-title">Exceptions de source conservées</h2><span className="cutover-badge">Quarantaine ≠ ingestion</span></div>
    <p>Une disposition conserve la preuve d’un écart et son motif. Elle ne crée ni ne retire un Lead, ne résout pas un effet en revue et n’annule aucun reçu ou lot antérieur. Les données personnelles de la source ne sont pas exposées ici.</p>
    <div className="cutover-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => { const current = await read(); clearConfirmed(current); setFeedback("Exceptions et manifeste relus, sans observation ni exécution supplémentaire."); })}>{view ? "Relire les exceptions sans exécuter" : "Lire les exceptions sans exécuter"}</button></div>
    {error ? <p className="cutover-error" role="alert">{error} Une tentative non confirmée garde sa preuve, son motif et sa clé exacte ; relisez avant tout rejeu.</p> : null}
    {feedback ? <p className="cutover-notice" role="status">{feedback}</p> : null}
    {!view ? <p className="cutover-help">Exceptions non encore lues : aucun résultat vide ou complet n’est déduit de l’ouverture du manifeste.</p> : <>
      {stale ? <p className="cutover-notice">Le manifeste a évolué depuis cette lecture. Relisez les exceptions avant une nouvelle disposition ; une tentative en attente n’est pas réécrite automatiquement.</p> : null}
      {view.observation ? <details className="cutover-exception-proof"><summary>Provenance de l’observation · aucune donnée de contact</summary><dl className="cutover-metadata"><div><dt>Observation UTC · version</dt><dd>{view.observation.observedAt} · v{view.observation.observedManifestVersion}</dd></div><div><dt>Preuve source SHA-256</dt><dd>{view.observation.sourceEvidenceSha256}</dd></div><div><dt>Liaison source SHA-256</dt><dd>{view.observation.bindingSha256}</dd></div><div><dt>En-tête SHA-256</dt><dd>{view.observation.headerSha256}</dd></div></dl></details> : <p>Aucune observation source acquise. Une lecture vide n’atteste pas l’absence d’écarts.</p>}
      <dl className="cutover-counts">{Object.entries({ "Cas actuels": view.summary.currentCases, "Cas sans disposition": view.summary.unresolvedCases, "Cas en quarantaine": view.summary.quarantinedCases, "Sources distinctes en quarantaine": view.summary.uniqueQuarantinedSources }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="cutover-help">Ces catégories se recouvrent et ne s’additionnent pas. {view.summary.allDispositionsReconciled ? "Dispositions réconciliées selon le serveur ; cela ne signifie pas que les sources en quarantaine ont été ingérées ni que le rattrapage est complet." : "Dispositions non encore toutes réconciliées ; aucune reprise sûre n’est déduite."}</p>
      {!view.summary.coverageValid || view.summary.requiresReobservation ? <p className="cutover-notice">La couverture de la dernière observation n’est pas encore qualifiée pour la reprise. Observez à nouveau puis vérifiez la réconciliation ; une disposition seule ne suffit pas.</p> : null}
      <div className="cutover-submissions">{view.cases.map((entry) => <ExceptionCard key={entry.id} entry={entry} busy={busy} pending={pending.get(entry.id)} allowed={!stale && manifest.bindingValid !== false && view.bindingValid && view.capabilities.canQuarantine && entry.current && !entry.disposition} onDecision={(reason) => run(() => decide(entry, reason))} />)}</div>
      {!view.cases.length ? <p>Aucun cas conservé dans cette lecture. L’observation et la réconciliation restent des contrôles distincts.</p> : null}
      <p className="cutover-notice">Après une quarantaine, utilisez explicitement « Observer la source désactivée », puis « Vérifier la réconciliation ». La qualification et l’armement restent séparés ; rien n’est activé ici automatiquement.</p>
    </>}
  </section>;
}

function ExceptionCard({ entry, busy, pending, allowed, onDecision }: Readonly<{ entry: CutoverExceptionCase; busy: boolean; pending: PendingDecision | undefined; allowed: boolean; onDecision: (reason: string) => Promise<void> }>): React.JSX.Element {
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const valid = allowed && (pending !== undefined || confirmed && reason.trim().length >= 8 && reason.trim().length <= 500);
  const heading = `cutover-exception-${entry.id}`;
  return <article className="cutover-submission" aria-labelledby={heading}>
    <div className="cutover-heading"><h3 id={heading}>{kindLabels[entry.kind]}</h3><span className="cutover-badge">{entry.disposition ? "Quarantaine préservée · non ingérée" : entry.current ? "Décision explicite attendue" : "Cas antérieur conservé"}</span></div>
    <dl className="cutover-metadata"><div><dt>Cas durable · génération</dt><dd>{entry.id} · {entry.generation}</dd></div><div><dt>Clé source durable</dt><dd>{entry.sourceKey}</dd></div><div><dt>Preuve exacte SHA-256</dt><dd>{entry.evidenceSha256}</dd></div><div><dt>Présence dans l’observation</dt><dd>{entry.present ? "Présente" : "Absente"}</dd></div><div><dt>Empreinte originale</dt><dd>{entry.originalFingerprint}</dd></div><div><dt>Empreinte observée</dt><dd>{entry.observedFingerprint ?? "Non disponible"}</dd></div><div><dt>Arrivée originale observée · UTC</dt><dd>{entry.observedOriginalArrivedAt ?? "Inconnue ou absente"}</dd></div><div><dt>Effet antérieur conservé</dt><dd>{entry.effectId ?? "Aucun effet lié déclaré"}</dd></div><div><dt>Lot antérieur conservé</dt><dd>{entry.batchId ?? "Aucun lot lié déclaré"}</dd></div></dl>
    {entry.effectId || entry.batchId ? <p>La quarantaine ne modifie pas l’effet ou le lot antérieur. Un effet en revue reste en revue.</p> : null}
    {entry.requiresReobservation ? <p className="cutover-notice">Nouvelle observation puis réconciliation obligatoires. Aucune consommation de cette preuve n’est acquise.</p> : null}
    {entry.disposition ? <dl className="cutover-metadata"><div><dt>Motif conservé</dt><dd>{entry.disposition.reason}</dd></div><div><dt>Décision UTC · version</dt><dd>{entry.disposition.decidedAt} · v{entry.disposition.decidedManifestVersion}</dd></div><div><dt>Identifiant de l’exécutant</dt><dd>{entry.disposition.actorId}</dd></div></dl> : allowed || pending ? <form onSubmit={(event) => { event.preventDefault(); if (valid) void onDecision(pending?.body.reason ?? reason.trim()); }}>
      <label>Motif de préservation en quarantaine<textarea value={pending?.body.reason ?? reason} disabled={busy || pending !== undefined} minLength={8} maxLength={500} required onChange={(event) => { setReason(event.target.value); setConfirmed(false); }} /><small>8 à 500 caractères. Conservez une justification factuelle, sans secret ni coordonnée personnelle.</small></label>
      {pending ? <p className="cutover-notice">Résultat à relire. La tentative conserve exactement la version v{pending.body.expectedVersion}, la preuve, le motif et la clé initiale. Le rejeu ci-dessous ne constitue pas une nouvelle décision.</p> : <label className="cutover-check"><input type="checkbox" checked={confirmed} disabled={busy || !allowed} onChange={(event) => setConfirmed(event.target.checked)} />Je préserve cette preuve précise en quarantaine, sans l’ingérer ni annuler d’effet antérieur ; une nouvelle observation et une réconciliation seront nécessaires.</label>}
      <div className="cutover-actions"><button type="submit" className="secondary-button" disabled={busy || !valid}>{pending ? "Rejouer exactement la disposition en attente" : "Préserver cette preuve en quarantaine"}</button></div>
    </form> : <p className="cutover-help">Aucune disposition disponible avec les capacités actuelles ou pour ce cas historique. Aucun droit n’est déduit du rôle nominal.</p>}
  </article>;
}
