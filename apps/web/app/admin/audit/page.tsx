"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "../../_components/ui/page-header";
import { auditAction, auditActor, auditDate, auditFields, auditLead, auditQuery, auditRequest, AuditRequestError, auditResult, type AuditItem, type AuditPage } from "./audit-client";

function Actor({ item }: { item: AuditItem }): React.JSX.Element {
  const actor = auditActor(item);
  return <><strong>{actor.label}</strong><small>{actor.note}</small>{item.actorRoles.length ? <small>{item.actorRoles.join(", ")}</small> : null}</>;
}
function Lead({ item }: { item: AuditItem }): React.JSX.Element {
  const lead = auditLead(item);
  return <>{lead.href ? <Link href={lead.href} prefetch={false}>{lead.label}</Link> : <span>{lead.label}</span>}{lead.reference ? <><small>{lead.reference}</small><small>Fiche actuelle</small></> : null}</>;
}

export default function AuditPageView(): React.JSX.Element {
  const [query, setQuery] = useState(""); const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0); const [campuses, setCampuses] = useState<Array<{ id: string }>>([]);
  const [data, setData] = useState<AuditPage | null>(null); const [busy, setBusy] = useState(true); const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<AuditItem | null>(null);
  const [detailError, setDetailError] = useState(""); const [detailBusy, setDetailBusy] = useState(false);
  const snapshot = useRef(""); const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(""); setData(null);
    // A new scope/page/read invalidates both the visible list and its open detail.
    // Closing selection aborts the detail effect; no hidden stale identities remain.
    dialog.current?.close(); setSelected(null); setDetail(null); setDetailError(""); setDetailBusy(false);
    const params = new URLSearchParams(query); params.set("page", String(page)); params.set("pageSize", "25");
    if (snapshot.current) params.set("snapshot", snapshot.current);
    void auditRequest<AuditPage>(`?${params}`, controller.signal).then((result) => {
      if (!controller.signal.aborted) { snapshot.current = result.snapshot; setCampuses(result.campuses); setData(result); setBusy(false); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) { setCampuses([]); setError(cause instanceof Error ? cause.message : "Journal indisponible."); setBusy(false); } });
    return (): void => controller.abort();
  }, [query, page, revision]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController(); setDetail(null); setDetailError(""); setDetailBusy(true); dialog.current?.showModal();
    void auditRequest<AuditItem>(`/${encodeURIComponent(selected)}`, controller.signal).then((result) => { if (!controller.signal.aborted) { setDetail(result); setDetailBusy(false); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) {
        const message = cause instanceof Error ? cause.message : "Événement indisponible.";
        setDetailError(message); setDetailBusy(false);
        if (cause instanceof AuditRequestError && [401, 403].includes(cause.status)) { setData(null); setCampuses([]); setError(message); }
      } });
    return (): void => controller.abort();
  }, [selected]);
  function close(): void { dialog.current?.close(); setSelected(null); setDetail(null); setDetailBusy(false); setDetailError(""); }
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
      <p>Les noms affichés proviennent des profils et fiches actuellement accessibles, pas d’un instantané historique. L’événement d’origine reste immuable.</p>
      {busy ? <p role="status">Chargement du journal…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {data ? <><p role="status">{data.total} événement(s) · Page {data.page}</p>{data.items.length ? <table className="audit-table">
        <caption>Événements autorisés, du plus récent au plus ancien</caption>
        <thead><tr>{["Date", "Acteur", "Action", "Lead", "Résultat", "Détail"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{data.items.map((item) => <tr key={item.id}>
          <td data-label="Date"><time dateTime={item.occurredAt}>{auditDate(item.occurredAt)}</time></td>
          <td data-label="Acteur"><Actor item={item} /></td>
          <td data-label="Action"><strong>{auditAction(item)}</strong><small>{item.eventType}</small></td>
          <td data-label="Lead"><Lead item={item} /></td>
          <td data-label="Résultat"><span className="audit-result">{auditResult(item)}</span></td>
          <td data-label="Détail"><button onClick={() => setSelected(item.id)} aria-label={`Détail de l’événement ${item.id}`}>Consulter le détail</button></td>
        </tr>)}</tbody>
      </table> : <p>Aucun événement ne correspond aux filtres dans votre périmètre.</p>}
        <nav className="audit-actions" aria-label="Pagination du journal"><button disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)}>Précédent</button><button disabled={busy || page * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>Suivant</button></nav>
      </> : null}
    </section>
    <dialog ref={dialog} aria-labelledby="audit-detail-title" onCancel={close} onClose={() => setSelected(null)}>
      <header className="audit-actions"><h2 id="audit-detail-title">Détail de l’événement</h2><button onClick={close}>Fermer</button></header>
      {selected && detailBusy ? <p role="status">Chargement du détail…</p> : null}{selected && detailError ? <p role="alert">{detailError}</p> : null}
      {selected && detail ? <><p>{auditAction(detail)} · {auditDate(detail.occurredAt)} · {auditResult(detail)}</p><div className="audit-identity"><h3>Acteur</h3><Actor item={detail} /><h3>Lead</h3><Lead item={detail} /></div><details><summary>Références techniques de l’événement</summary><dl><dt>Événement</dt><dd>{detail.id}</dd><dt>Code action</dt><dd>{detail.eventType}</dd><dt>Acteur</dt><dd>{detail.actorId ?? "Masqué"}</dd><dt>Ressource</dt><dd>{detail.resourceType ?? "Non renseignée"} · {detail.resourceId ?? "Historique sans identifiant structuré"}</dd><dt>Campus de l’événement</dt><dd>{detail.campusId ?? "Global ou historique non attribué"}</dd></dl></details><h3>Avant — champs autorisés</h3><pre>{JSON.stringify(detail.before, null, 2)}</pre><h3>Après — champs autorisés</h3><pre>{JSON.stringify(detail.after, null, 2)}</pre><p>Aucune modification ou suppression possible.</p></> : null}
    </dialog>
  </div>;
}
