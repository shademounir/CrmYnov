"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle, FileXls, ShieldCheck } from "@phosphor-icons/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../../_components/ui/page-header";
import { BootstrapMapping } from "./bootstrap-mapping";
import { BootstrapReconciliationView } from "./bootstrap-reconciliation";
import { BootstrapRowReview, persistBootstrapDecision, type BootstrapRowDecision } from "./bootstrap-row-review";
import {
  bootstrapCapabilities, bootstrapChunkBytes, bootstrapFailure, bootstrapFileLimit, bootstrapHash, bootstrapRequest, bootstrapSheets,
  bootstrapStateLabels, bytesToBase64, confirmedPackageState, mappingForSheets, packageKey, stableBootstrapAttempt,
  type BootstrapContext, type BootstrapPackage, type BootstrapReport, type BootstrapRow, type BootstrapRows, type BootstrapSheetMapping,
} from "./bootstrap-client";
import styles from "./bootstrap-styles";

export function BootstrapWizard({ initialPackageId }: Readonly<{ initialPackageId?: string }>): React.JSX.Element {
  const [context, setContext] = useState<BootstrapContext | null>(null), [source, setSource] = useState<BootstrapPackage | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const [campusId, setCampusId] = useState(""), [file, setFile] = useState<File | null>(null), [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [resumeId, setResumeId] = useState(initialPackageId ?? ""), [mappings, setMappings] = useState<BootstrapSheetMapping[]>([]);
  const [rows, setRows] = useState<BootstrapRow[]>([]), [nextAfter, setNextAfter] = useState<string | null>(null), [currentAfter, setCurrentAfter] = useState("");
  const [previousPages, setPreviousPages] = useState<string[]>([]), [report, setReport] = useState<BootstrapReport | null>(null), [confirmed, setConfirmed] = useState(false);
  const mutation = useRef(false), confirmAttempt = useRef<{ payload: string; key: string } | undefined>(undefined);
  const capabilities = bootstrapCapabilities(context, campusId);
  const refresh = useCallback(async (id: string, after = ""): Promise<BootstrapPackage> => {
    const current = await bootstrapRequest<BootstrapPackage>(`/packages/${encodeURIComponent(id)}`);
    setSource(current); setCampusId(current.campusId); setResumeId(current.id);
    if (confirmedPackageState(current.state)) {
      const query = new URLSearchParams({ limit: "25", ...(after ? { after } : {}) });
      const [page, summary] = await Promise.all([
        bootstrapRequest<BootstrapRows>(`/packages/${encodeURIComponent(id)}/rows?${query}`),
        bootstrapRequest<BootstrapReport>(`/packages/${encodeURIComponent(id)}/report`),
      ]);
      setRows(page.items); setNextAfter(page.nextAfter ?? null); setReport(summary);
    } else { setRows([]); setNextAfter(null); setReport(null); }
    if (current.state === "SEALED") setMappings(mappingForSheets(current));
    return current;
  }, []);
  useEffect(() => {
    let active = true;
    void bootstrapRequest<BootstrapContext>("/context").then(async (value) => {
      if (!active) return;
      setContext(value);
      if (initialPackageId) await refresh(initialPackageId);
    }).catch((failure: unknown) => { if (active) setError(bootstrapFailure(failure)); }).finally(() => { if (active) setLoading(false); });
    return (): void => { active = false; };
  }, [initialPackageId, refresh]);
  async function perform(operation: () => Promise<void>): Promise<void> {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(""); setFeedback("");
    try { await operation(); }
    catch (failure) { setError(bootstrapFailure(failure)); }
    finally { mutation.current = false; setBusy(false); }
  }
  function bookmark(id: string): void { const url = new URL(window.location.href); url.searchParams.set("package", id); window.history.replaceState(null, "", url); }
  async function upload(): Promise<void> {
    if (!capabilities.canUpload || !file || !sourceConfirmed || !campusId) return;
    if (file.size === 0 || file.size > bootstrapFileLimit || !/\.xlsx$/i.test(file.name)) { setError("Choisissez un classeur XLSX non vide de 5 Mio maximum. Aucun fichier n’a été transféré."); return; }
    const bytes = await file.arrayBuffer(); const sha256 = await bootstrapHash(bytes);
    let current: BootstrapPackage;
    if (source) {
      if (source.state !== "UPLOADING" || source.sha256 !== sha256 || source.sizeBytes !== file.size || source.campusId !== campusId) { setError("La reprise exige exactement le même fichier, le même campus et la même empreinte. Aucun lot n’a été remplacé."); return; }
      current = await refresh(source.id);
    } else {
      current = await bootstrapRequest<BootstrapPackage>("/packages", { method: "POST", body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, sha256, campusId, idempotencyKey: `bootstrap-upload-${sha256}-${campusId}` }) });
      setSource(current); setResumeId(current.id); bookmark(current.id);
    }
    if (current.state !== "UPLOADING") { await refresh(current.id); setFeedback("Le lot existant est relu. Aucun deuxième fichier n’a été créé."); return; }
    // Revalidate each indexed chunk: a received count does not prove a contiguous prefix.
    // Identical chunks are idempotent on the server, including after a lost response.
    for (let index = 0; index < current.expectedChunks; index += 1) {
      const chunk = bytes.slice(index * bootstrapChunkBytes, Math.min((index + 1) * bootstrapChunkBytes, bytes.byteLength));
      current = await bootstrapRequest<BootstrapPackage>(`/packages/${encodeURIComponent(current.id)}/chunks`, { method: "POST", body: JSON.stringify({ index, sha256: await bootstrapHash(chunk), contentBase64: bytesToBase64(new Uint8Array(chunk)) }) });
      setSource(current);
    }
    await bootstrapRequest<BootstrapPackage>(`/packages/${encodeURIComponent(current.id)}/seal`, { method: "POST", body: JSON.stringify({ sha256 }) });
    await refresh(current.id); setFile(null); setSourceConfirmed(false); setFeedback("Le fichier a été scellé et relu depuis le serveur. Aucun dossier n’est encore importé.");
  }
  async function saveMapping(): Promise<void> {
    if (!source || !capabilities.canMap) return;
    if (source.sheets.length !== 4 || source.sheets.some((item) => !bootstrapSheets.includes(item.name as typeof bootstrapSheets[number]))) { setError("Les quatre feuilles autorisées ne sont pas toutes présentes. Aucun mapping n’est exécuté."); return; }
    await bootstrapRequest<BootstrapPackage>(`/packages/${encodeURIComponent(source.id)}/mappings`, { method: "POST", body: JSON.stringify({ expectedVersion: source.version, mappingVersion: "R8-v1", sheets: mappings }) });
    await refresh(source.id); setFeedback("Le mapping et les lignes de revue sont persistés puis relus. Cette analyse n’est pas une importation.");
  }
  async function decide(row: BootstrapRow, decision: BootstrapRowDecision): Promise<void> {
    if (!source || !capabilities.canDecide || mutation.current) return;
    mutation.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      await persistBootstrapDecision(source.id, row.id, decision); await refresh(source.id, currentAfter);
      setFeedback("Décision enregistrée et relue. L’exécution du lot reste une action distincte.");
    } finally { mutation.current = false; setBusy(false); }
  }
  async function reopen(row: BootstrapRow, input: { expectedVersion: number; idempotencyKey: string; reason: string }): Promise<void> {
    if (!source || !capabilities.canDecide || !row.canReopen || mutation.current) return;
    mutation.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      await bootstrapRequest(`/packages/${encodeURIComponent(source.id)}/rows/${encodeURIComponent(row.id)}/reopen`, { method: "POST", body: JSON.stringify(input) });
      await refresh(source.id, currentAfter);
      setFeedback("Décision non importée remise en revue. Son contenu précédent et le motif restent dans le reçu et l’audit ; aucun dossier importé n’a été modifié.");
    } finally { mutation.current = false; setBusy(false); }
  }
  async function confirm(): Promise<void> {
    if (!source || !capabilities.canConfirm || !confirmed) return;
    const body = { expectedVersion: source.version, confirmed: true, limit: 25 };
    await bootstrapRequest<BootstrapPackage>(`/packages/${encodeURIComponent(source.id)}/confirm`, { method: "POST", body: JSON.stringify({ ...body, idempotencyKey: stableBootstrapAttempt(confirmAttempt, body) }) });
    await refresh(source.id, currentAfter); setConfirmed(false);
    setFeedback("Le résultat et les reçus sont relus depuis PostgreSQL. Seules les décisions admissibles ont été exécutées, par bloc de 25 maximum ; les autres restent explicitement en revue.");
  }
  async function page(after: string, previous: string[]): Promise<void> { if (!source) return; await refresh(source.id, after); setCurrentAfter(after); setPreviousPages(previous); }
  if (loading) return <main className={styles.page}><PageHeader eyebrow="Relation Ynov · reprise contrôlée" title="Amorçage Excel historique" /><section className={styles.card} aria-busy="true" role="status">Lecture du contexte et du lot depuis le serveur…</section></main>;
  if (!context) return <main className={styles.page}><PageHeader title="Amorçage Excel indisponible" /><section className={`${styles.card} ${styles.error}`} role="alert"><p>{error || "Le contexte autorisé n’a pas pu être relu."}</p><div className={styles.actions}><Link href="/" className="secondary-button">Se reconnecter</Link><button type="button" onClick={() => window.location.reload()} className="secondary-button">Réessayer la lecture</button></div></section></main>;
  const packageCampus = context.campuses.find((item) => item.id === source?.campusId);
  return <main className={styles.page} aria-busy={busy}>
    <PageHeader eyebrow="Relation Ynov · reprise contrôlée" title="Amorçage Excel historique" description="Un fichier immuable, des décisions explicites et des reçus persistants. Le suivi existant n’est pas réécrit." actions={<Link href="/imports/wizard" className="secondary-button"><ArrowLeft size={18} aria-hidden="true" /> Les parcours d’import</Link>} />
    <ol className={styles.steps} aria-label="Étapes de reprise"><li><b>1</b>Fichier scellé</li><li><b>2</b>Mapping et anomalies</li><li><b>3</b>Décisions contrôlées</li><li><b>4</b>Exécution et rapport</li></ol>
    <div className={styles.notice}><ShieldCheck size={19} aria-hidden="true" /> DEV/STAGING : données synthétiques ou anonymisées uniquement. L’import réel et les invitations nominatives sont réservés au pilote PROD après qualification. Aucun historique Sheets, appel ou ancien acte commercial n’est recréé par ce parcours.</div>
    {error ? <div className={`${styles.feedback} ${styles.error}`} role="alert"><p>{error}</p>{source ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => { await refresh(source.id, currentAfter); setFeedback("État durable relu ; vérifiez les compteurs avant toute reprise."); })}>Relire le lot sans réexécuter</button> : null}</div> : null}
    {feedback ? <p role="status" className={styles.feedback}>{feedback}</p> : null}
    <section className={styles.card} aria-labelledby="bootstrap-source-title"><h2 id="bootstrap-source-title"><FileXls size={21} aria-hidden="true" /> 1. Fichier et point de reprise</h2>
      {!source ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void perform(upload); }}>
        <div className={styles.fields}><label>Campus cible autorisé<select value={campusId} disabled={busy || !context.canUpload} required onChange={(event) => setCampusId(event.target.value)}><option value="">Choisir explicitement le campus</option>{context.campuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Classeur XLSX figé · 5 Mio maximum<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy || !context.canUpload} required onChange={(event) => { setFile(event.target.files?.[0] ?? null); setSourceConfirmed(false); }} /></label></div>
        <label className={styles.check}><input type="checkbox" checked={sourceConfirmed} disabled={busy || !context.canUpload} onChange={(event) => setSourceConfirmed(event.target.checked)} />Je confirme que le fichier est autorisé pour cet environnement et synthétique/anonymisé en DEV ou STAGING.</label>
        <div className={styles.actions}><button type="submit" className="primary-button" disabled={busy || !capabilities.canUpload || !file || !campusId || !sourceConfirmed}>{busy ? "Transfert et vérification…" : "Transférer par blocs et sceller"}</button></div><p>Le contenu privé est conservé sur le serveur du lot, pas dans le stockage du navigateur. Les morceaux sont bornés à 48 Kio décodés ; la somme SHA-256 est vérifiée avant analyse.</p>
      </form> : <><PackageSummary source={source} campus={packageCampus?.label ?? "Campus du lot à revalider"} />
        {source.state === "UPLOADING" ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void perform(upload); }}><label>Resélectionner le même fichier pour reprendre<input type="file" accept=".xlsx" disabled={busy || !capabilities.canUpload} required onChange={(event) => { setFile(event.target.files?.[0] ?? null); setSourceConfirmed(false); }} /></label><label className={styles.check}><input type="checkbox" disabled={busy || !capabilities.canUpload} checked={sourceConfirmed} onChange={(event) => setSourceConfirmed(event.target.checked)} />Fichier autorisé, même empreinte et même campus.</label><button className="primary-button" disabled={busy || !capabilities.canUpload || !file || !sourceConfirmed} type="submit">Reprendre les morceaux manquants</button></form> : null}
        <div className={styles.actions}><button className="secondary-button" type="button" disabled={busy} onClick={() => void perform(async () => { await refresh(source.id, currentAfter); setFeedback("État durable actualisé, sans réexécution."); })}>Actualiser le lot</button><Link href={`/imports/bootstrap?package=${encodeURIComponent(source.id)}`} className="secondary-button">Lien durable de reprise</Link></div>
      </>}
      {!source ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); const id = packageKey(resumeId.trim()); if (!id) { setError("Identifiant de lot invalide."); return; } void perform(async () => { await refresh(id); bookmark(id); setFeedback("Lot relu sans réimportation."); }); }}><label>Reprendre un lot existant<input value={resumeId} maxLength={80} disabled={busy} onChange={(event) => setResumeId(event.target.value)} autoComplete="off" /></label><div className={styles.actions}><button className="secondary-button" disabled={busy || !packageKey(resumeId.trim())} type="submit">Ouvrir le lot conservé</button></div></form> : null}
      {!context.canUpload ? <p>Lecture autorisée. La création ou le transfert d’un lot n’est pas permis par vos droits effectifs.</p> : null}
    </section>
    {source?.state === "SEALED" ? <BootstrapMapping source={source} context={context} mappings={mappings} disabled={busy || !capabilities.canMap} onChange={setMappings} onSave={() => void perform(saveMapping)} /> : null}
    {source && confirmedPackageState(source.state) ? <><section className={styles.card} aria-labelledby="bootstrap-rows-title"><h2 id="bootstrap-rows-title">3. Occurrences et décisions de reprise</h2><p>25 occurrences maximum par page. « Prête » signifie une décision enregistrée, jamais un import réussi. Les conflits et données manquantes restent en revue ; aucun contact n’est fusionné automatiquement.</p><Counts source={source} />
      <div className={styles.rows}>{rows.map((row) => <BootstrapRowReview key={`${row.id}:${row.version}`} source={source} row={row} context={context} disabled={busy || !capabilities.canDecide} onDecision={decide} {...(capabilities.canDecide ? { onReopen: reopen } : {})} />)}{!rows.length ? <p>Aucune occurrence à afficher sur cette page.</p> : null}</div>
      <div className={styles.actions}><button className="secondary-button" type="button" disabled={busy || previousPages.length === 0} onClick={() => { const previous = [...previousPages]; const after = previous.pop() ?? ""; void perform(() => page(after, previous)); }}>Page précédente</button><button className="secondary-button" type="button" disabled={busy || !nextAfter} onClick={() => { if (nextAfter) void perform(() => page(nextAfter, [...previousPages, currentAfter])); }}>Page suivante</button></div>
    </section>
      <section className={styles.card} aria-labelledby="bootstrap-confirm-title"><h2 id="bootstrap-confirm-title">4. Exécution bornée et rapport durable</h2><p>Un clic exécute au plus 25 décisions admissibles. Un arrêt ou une réponse perdue se reprend par les reçus : ne recréez pas le fichier. Les décisions de rattachement n’écrasent pas les activités du dossier choisi.</p>
        <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy || !capabilities.canConfirm} onChange={(event) => setConfirmed(event.target.checked)} />J’ai examiné le mapping, les anomalies et les décisions ; j’autorise ce bloc de 25 maximum. Les éléments non admissibles restent en revue.</label>
        <div className={styles.actions}><button className="primary-button" type="button" disabled={busy || !capabilities.canConfirm || !confirmed || source.counts.pending === 0 || source.state === "COMPLETED"} onClick={() => void perform(confirm)}>{busy ? "Résultat en cours de vérification…" : "Exécuter les décisions admissibles"}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void perform(async () => { await refresh(source.id, currentAfter); setFeedback("Rapport et reçus relus. Aucune opération d’import supplémentaire."); })}>Relire le rapport</button></div>
        {report ? <><p className={styles.notice}>{report.cutoverBlocked || report.reconciliation?.complete !== true || report.sourceCoverage?.complete !== true ? "Bascule non qualifiée : des écarts ou des preuves de rapprochement restent à traiter. Aucun succès global n’est déduit." : "Réconciliation du lot déclarée par le serveur. Les autres prérequis de bascule restent distincts."}</p><div className={styles.table}><table><caption>Résultats conservés par feuille</caption><thead><tr><th scope="col">Feuille</th><th scope="col">Total</th><th scope="col">Acceptés</th><th scope="col">Revue</th><th scope="col">Invalides</th><th scope="col">Écartés</th></tr></thead><tbody>{report.bySheet.map((sheet) => <tr key={sheet.name}><th scope="row">{sheet.name}</th><td>{sheet.total}</td><td>{sheet.accepted}</td><td>{sheet.review}</td><td>{sheet.invalid}</td><td>{sheet.ignored}</td></tr>)}</tbody></table></div></> : null}
        {report?.sourceCoverage ? <><h3>Réconciliation avec le fichier scellé</h3><p className={styles.notice}>{report.sourceCoverage.complete ? "Couverture source déclarée complète par le serveur : elle ne remplace pas la qualification de chaque occurrence." : "Couverture source incomplète : cellules ou annotations non reprises restent visibles et bloquantes. Aucun oubli n’est présenté comme une réussite."}</p>{report.sourceCoverage.bySheet.map((sheet) => <details key={sheet.name} className={styles.mapping}><summary>{sheet.name} · preuve de couverture</summary><dl className={styles.valueGrid}>{Object.entries({ "Occurrences candidates source": sheet.sourceCandidates, "Lignes source": sheet.sourceRows, "Occurrences au registre": sheet.ledgerRows, "Cellules littérales": sheet.literalCells, "Cellules de commentaires": sheet.commentCells, "Cellules calculées": sheet.formulaCells, "Annotations natives": sheet.nativeAnnotations, "Cellules sans destination": sheet.unmappedCells, "Cellules exclues explicitement": sheet.excludedCells, "Annotations en quarantaine": sheet.quarantinedAnnotations }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>)}</> : null}
        <BootstrapReconciliationView {...(report?.reconciliation ? { summary: report.reconciliation } : {})} />
        <p><CheckCircle size={16} aria-hidden="true" /> Les commentaires importés conservent leur cellule source. Leur import n’est pas un appel, une clôture ou une interaction commerciale d’aujourd’hui. Sheets reste un parcours séparé.</p>
      </section>
    </> : null}
  </main>;
}

function PackageSummary({ source, campus }: Readonly<{ source: BootstrapPackage; campus: string }>): React.JSX.Element {
  return <><dl className={styles.metadata}><div><dt>Fichier</dt><dd>{source.fileName}</dd></div><div><dt>Campus cible</dt><dd>{campus}</dd></div><div><dt>État serveur</dt><dd>{bootstrapStateLabels[source.state]}</dd></div><div><dt>Lot</dt><dd>{source.id}</dd></div><div><dt>Version</dt><dd>{source.version}</dd></div><div><dt>Transfert</dt><dd>{source.receivedChunks} / {source.expectedChunks} blocs · {source.sizeBytes} octets</dd></div></dl><code className={styles.hash}>SHA-256 : {source.sha256}</code><progress className={styles.progress} value={source.receivedChunks} max={Math.max(1, source.expectedChunks)} aria-label="Morceaux persistés du fichier" /></>;
}
function Counts({ source }: Readonly<{ source: BootstrapPackage }>): React.JSX.Element {
  const labels = { total: "Occurrences", accepted: "Reçus acquis", review: "En revue", invalid: "Invalides", ignored: "Écartées", pending: "À traiter" };
  return <dl className={styles.stats}>{Object.entries(labels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{source.counts[key as keyof typeof labels]}</dd></div>)}</dl>;
}
