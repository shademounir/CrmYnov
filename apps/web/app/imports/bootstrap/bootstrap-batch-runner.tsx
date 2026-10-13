"use client";

import React, { useRef, useState } from "react";
import { bootstrapFailure, bootstrapRequest, type BootstrapContext, type BootstrapPackage } from "./bootstrap-client";
import { batchSize, parseBatchPlan, readBatchRows, runBatchPlan, type BatchPlan, type BatchProgress } from "./bootstrap-batch";
import styles from "./bootstrap-styles";

export function BootstrapBatchRunner({ source, context, disabled, perform, refresh }: Readonly<{
  source: BootstrapPackage; context: BootstrapContext; disabled: boolean;
  perform: (operation: () => Promise<void>) => Promise<void>; refresh: () => Promise<unknown>;
}>): React.JSX.Element {
  const [text, setText] = useState(""), [plan, setPlan] = useState<BatchPlan | null>(null), [confirmed, setConfirmed] = useState(false);
  const [exported, setExported] = useState(""), [progress, setProgress] = useState<BatchProgress | null>(null), [error, setError] = useState(""), [running, setRunning] = useState(false);
  const stop = useRef(false);
  function inspect(): void { setError(""); setConfirmed(false); setProgress(null); try { setPlan(parseBatchPlan(text, source)); } catch { setPlan(null); setError("Plan invalide : vérifiez le paquet, son empreinte, les versions et les décisions motivées. Aucun effet appliqué."); } }
  async function execute(): Promise<void> {
    if (!plan || !confirmed || disabled || running) return;
    stop.current = false; setError(""); setRunning(true);
    try { await runBatchPlan(plan, bootstrapRequest, setProgress, () => stop.current); }
    catch (failure) { setError(`${bootstrapFailure(failure)} Le plan est conservé ; les lignes déjà validées seront reconnues par leur clé durable à la reprise.`); }
    finally { setRunning(false); setConfirmed(false); await refresh(); }
  }
  return <section className={styles.card} aria-labelledby="bootstrap-batch-title">
    <h2 id="bootstrap-batch-title">Traitement continu du portefeuille</h2>
    <p>Un plan préparé conserve une décision motivée par occurrence. Chaque bloc de 5 par défaut, 25 maximum, enregistre, confirme, importe et réconcilie dans une seule transaction. Le traitement poursuit ensuite le bloc suivant ; les refus explicites restent à résoudre, sans différé automatique.</p>
    <details><summary>Préparer le plan depuis les données conservées</summary>
      <p>Lecture privée du paquet et de ses références autorisées, sans retransférer le classeur. Ne diffusez pas cet export de travail.</p>
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => void perform(async () => {
        const current = await bootstrapRequest<BootstrapPackage>(`/packages/${source.id}`);
        const rows = await readBatchRows(source.id, bootstrapRequest);
        setExported(JSON.stringify({ schemaVersion: 1, package: current, context, rows }));
      })}>Lire les occurrences et références pour préparer le plan</button>
      {exported ? <label>Export privé des occurrences<textarea readOnly value={exported} rows={4} spellCheck={false} /></label> : null}
    </details>
    <label>Plan de décisions JSON · paquet existant<textarea value={text} rows={5} maxLength={8 * 1024 * 1024} disabled={disabled || running} spellCheck={false} onChange={event => { setText(event.target.value); setPlan(null); setConfirmed(false); }} /></label>
    <button type="button" className="secondary-button" disabled={disabled || running || !text} onClick={inspect}>Vérifier le plan préparé</button>
    {plan ? <><p>{plan.items.length} occurrences dans le plan : {plan.items.filter(item => item.decision.action === "CREATE_DOSSIER").length} créations proposées, {plan.items.filter(item => item.decision.action === "LINK_EXISTING").length} rapprochements explicites, {plan.items.filter(item => item.decision.action === "IGNORE").length} exclusions motivées, {plan.items.filter(item => item.decision.action === "DEFER").length} différés explicites. Ces propositions ne sont pas des résultats d’import.</p>
      <p>Exécution par blocs de {batchSize(plan)} maximum ; reprise par clés durables, sans modifier la limite transactionnelle du serveur.</p>
      <label className={styles.check}><input type="checkbox" disabled={disabled || running} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />J’autorise les décisions explicites de ce plan et leur exécution par blocs successifs, dans mes droits actuels. Aucun rapprochement ni propriétaire n’est inventé.</label>
      <div className={styles.actions}><button type="button" className="primary-button" disabled={disabled || running || !confirmed} onClick={() => void perform(execute)}>Importer le plan par blocs successifs</button>
        {running ? <button type="button" className="secondary-button" onClick={() => { stop.current = true; }}>Arrêter après le bloc en cours</button> : null}</div>
    </> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {progress ? <div role="status"><p>{progress.checked} / {plan?.items.length ?? 0} occurrences examinées · {progress.committed} dispositions importées dans cette exécution · {progress.deferred} différés persistés · {progress.alreadyPersisted} décisions du même plan déjà persistées · {progress.failures.length} refus conservés pour résolution.</p>
      {progress.report?.reconciliation ? <p>Rapport serveur : {progress.report.reconciliation.effects.createdOccurrences ?? 0} créations, {progress.report.reconciliation.effects.linkedOccurrences ?? 0} rapprochements, {progress.report.reconciliation.effects.exactNotes ?? 0} interactions historiques vérifiées. {progress.report.reconciliation.unresolvedOccurrences} occurrences demeurent non importées.</p> : null}
      {progress.failures.length ? <label>Refus du plan · aucune exclusion automatique<textarea readOnly value={JSON.stringify(progress.failures)} rows={4} /></label> : null}
    </div> : null}
  </section>;
}
