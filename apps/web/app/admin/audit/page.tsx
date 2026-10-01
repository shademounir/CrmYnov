"use client";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../../_components/ui/page-header";
import { auditDate, auditFields, auditQuery, auditRequest, type AuditItem, type AuditPage } from "./audit-client";

export default function AuditPageView(): React.JSX.Element {
  const [query, setQuery] = useState(""); const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0); const [campuses, setCampuses] = useState<Array<{ id: string }>>([]);
  const [data, setData] = useState<AuditPage | null>(null); const [busy, setBusy] = useState(true); const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<AuditItem | null>(null);
  const [detailError, setDetailError] = useState(""); const [detailBusy, setDetailBusy] = useState(false);
  const snapshot = useRef(""); const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(""); setData(null);
    const params = new URLSearchParams(query); params.set("page", String(page)); params.set("pageSize", "25");
    if (snapshot.current) params.set("snapshot", snapshot.current);
    void auditRequest<AuditPage>(`?${params}`, controller.signal).then((result) => {
      if (!controller.signal.aborted) { snapshot.current = result.snapshot; setCampuses(result.campuses); setData(result); setBusy(false); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Journal indisponible."); setBusy(false); } });
    return (): void => controller.abort();
  }, [query, page, revision]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController(); setDetail(null); setDetailError(""); setDetailBusy(true); dialog.current?.showModal();
    void auditRequest<AuditItem>(`/${encodeURIComponent(selected)}`, controller.signal).then((result) => { if (!controller.signal.aborted) { setDetail(result); setDetailBusy(false); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setDetailError(cause instanceof Error ? cause.message : "Événement indisponible."); setDetailBusy(false); } });
    return (): void => controller.abort();
  }, [selected]);
  function close(): void { dialog.current?.close(); setSelected(null); setDetail(null); }
  function apply(form: FormData): void { snapshot.current = ""; setPage(1); setQuery(auditQuery(form)); setRevision((value) => value + 1); }
  return <div className="audit-view">
    <PageHeader eyebrow="TRAÇABILITÉ" title="Journal d’audit" description="Consultez les événements persistants de votre périmètre. Historique non modifiable ; chaque consultation réussie est tracée." />
    <section className="audit-panel" aria-label="Recherche dans le journal">
      <form onSubmit={(event) => { event.preventDefault(); apply(new FormData(event.currentTarget)); }}>
        <div className="audit-filters">{auditFields.map(([name, label, type]) => <label key={name}>{label}<input name={name} type={type} maxLength={80} /></label>)}
          <label>Résultat<select name="result"><option value="">Tous</option><option value="SUCCESS">Succès</option><option value="DENIED">Refusé</option><option value="FAILED">Échec</option></select></label>
          <label>Campus autorisé<select name="campus"><option value="">Tout mon périmètre</option>{campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.id}</option>)}</select></label>
        </div><div className="audit-actions"><button type="submit" disabled={busy}>Appliquer les filtres</button><button type="reset" disabled={busy} onClick={() => { snapshot.current = ""; setPage(1); setQuery(""); setRevision((value) => value + 1); }}>Réinitialiser</button></div>
      </form>
    </section>
    <section className="audit-panel" aria-label="Événements d’audit" aria-busy={busy}>
      <p>Horodatages : Africa/Casablanca · Métadonnées expurgées · Aucun export</p>
      {busy ? <p role="status">Chargement du journal…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {data ? <><p role="status">{data.total} événement(s) · Page {data.page}</p>{data.items.length ? <div className="audit-items">{data.items.map((item) => <article className="audit-item" key={item.id}>
        <header><strong>{item.eventType}</strong><span className="audit-result">{item.result}</span></header>
        <dl><dt>Date</dt><dd><time dateTime={item.occurredAt}>{auditDate(item.occurredAt)}</time></dd><dt>Acteur</dt><dd>{item.actorId ?? "Identité technique masquée"} · {item.actorRoles.join(", ")}</dd><dt>Ressource</dt><dd>{item.resourceType ?? "Non renseignée"} · {item.resourceId ?? "Historique sans identifiant structuré"}</dd><dt>Campus</dt><dd>{item.campusId ?? "Global ou historique non attribué"}</dd></dl>
        <button onClick={() => setSelected(item.id)} aria-label={`Détail de l’événement ${item.id}`}>Consulter le détail</button>
      </article>)}</div> : <p>Aucun événement ne correspond aux filtres dans votre périmètre.</p>}
        <nav className="audit-actions" aria-label="Pagination du journal"><button disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)}>Précédent</button><button disabled={busy || page * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>Suivant</button></nav>
      </> : null}
    </section>
    <dialog ref={dialog} aria-labelledby="audit-detail-title" onCancel={close} onClose={() => setSelected(null)}>
      <header className="audit-actions"><h2 id="audit-detail-title">Détail de l’événement</h2><button onClick={close}>Fermer</button></header>
      {detailBusy ? <p role="status">Chargement du détail…</p> : null}{detailError ? <p role="alert">{detailError}</p> : null}
      {detail ? <><p>{detail.eventType} · {auditDate(detail.occurredAt)} · {detail.result}</p><p>Acteur : {detail.actorId ?? "Masqué"}</p><h3>Avant — champs autorisés</h3><pre>{JSON.stringify(detail.before, null, 2)}</pre><h3>Après — champs autorisés</h3><pre>{JSON.stringify(detail.after, null, 2)}</pre><p>Aucune modification ou suppression possible.</p></> : null}
    </dialog>
  </div>;
}
