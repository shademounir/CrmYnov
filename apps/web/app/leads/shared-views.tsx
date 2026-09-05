"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { sharedViewLink, sharingRequest, sharingSnapshot, versionedCommand, type SharedView, type SharingSnapshot, type ViewShare } from "./shared-view-client";

const empty: SharingSnapshot = { owned: [], received: [], audiences: [], history: [] };
type Pending = { label: string; path: string; method: string; body: object };
type Feedback = { kind: "idle" } | { kind: "success" | "error"; text: string };

function SharingFeedback({ loading, feedback }: Readonly<{ loading: boolean; feedback: Feedback }>): React.JSX.Element {
  return <>
    {loading ? <p role="status">Chargement des vues et des audiences autorisées…</p> : null}
    {feedback.kind === "error" ? <p role="alert" className="shared-view-error">{feedback.text}</p> : null}
    {feedback.kind === "success" ? <p role="status">{feedback.text}</p> : null}
  </>;
}

function AudienceBadges({ view }: Readonly<{ view: SharedView }>): React.JSX.Element {
  return <ul className="shared-view-badges" aria-label={`Portées autorisées de ${view.name}`}>
    {view.visibleAudiences.map((audience, index) => <li key={`${audience.type}:${index}`}><span className="shared-view-badge">{audience.type === "TEAM" ? "Équipe" : "Campus"}</span> <span>{audience.label}</span></li>)}
  </ul>;
}

export function SharedViewControls({ current, readPrivateViews }: Readonly<{ current: Record<string, string>; readPrivateViews?: () => Promise<{ id: string }[]> }>): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(empty), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" }), [pending, setPending] = useState<Pending | null>(null);
  const [selected, setSelected] = useState(""), [audienceId, setAudienceId] = useState(""), [name, setName] = useState("");
  const [refresh, setRefresh] = useState({ generation: 0, confirmed: false }), [historyPage, setHistoryPage] = useState(1);
  const generation = useRef(0), mounted = useRef(false);
  const requestRefresh = useCallback((confirmed = false): void => {
    const next = ++generation.current;
    setFeedback({ kind: "idle" }); setPending(null); setLoading(true); setBusy(false);
    setRefresh({ generation: next, confirmed });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const current = (): boolean => !controller.signal.aborted && generation.current === refresh.generation;
    void sharingSnapshot(controller.signal, readPrivateViews).then((value) => {
      if (!current()) return;
      setSnapshot(value);
      setFeedback(refresh.confirmed ? { kind: "success", text: "Action enregistrée. Les droits restent recalculés par le serveur." } : { kind: "idle" });
    }).catch((reason: unknown) => {
      if (current()) { setSnapshot(empty); setFeedback({ kind: "error", text: reason instanceof Error ? reason.message : "Chargement impossible." }); }
    }).finally(() => { if (current()) setLoading(false); });
    return (): void => controller.abort();
  }, [refresh, readPrivateViews]);
  useEffect(() => {
    mounted.current = true;
    const changed = (): void => requestRefresh();
    window.addEventListener("saved-views-changed", changed);
    return (): void => { mounted.current = false; window.removeEventListener("saved-views-changed", changed); };
  }, [requestRefresh]);
  const owned = snapshot.owned.find((view) => view.id === selected);
  const audience = snapshot.audiences.find((value) => value.id === audienceId);
  function prepare(label: string, path: string, body: object, method = "POST"): void { setFeedback({ kind: "idle" }); setPending({ label, path, body, method }); }
  async function confirm(): Promise<void> {
    if (!pending) return;
    const current = ++generation.current;
    setBusy(true); setFeedback({ kind: "idle" });
    try {
      await sharingRequest<SharedView>(pending.path, pending.method, pending.body);
      if (!mounted.current || generation.current !== current) return;
      window.dispatchEvent(new window.Event("saved-views-changed"));
      // Only this server-confirmed mutation may attach success to its reread.
      requestRefresh(true);
    } catch (reason) {
      if (mounted.current && generation.current === current) {
        setFeedback({ kind: "error", text: reason instanceof Error ? reason.message : "Action indisponible." }); setPending(null); setSnapshot(empty);
      }
    } finally { if (mounted.current && generation.current === current) setBusy(false); }
  }
  function share(): void {
    if (owned && audience) prepare(`Partager « ${owned.name} » avec ${audience.kind === "TEAM" ? "l’équipe" : "le campus"} ${audience.label} ?`,
      `view-sharing/views/${encodeURIComponent(owned.id)}/shares`, { ...versionedCommand(owned.version), kind: audience.kind, audienceId: audience.id });
  }
  function duplicate(view: SharedView): void {
    if (view.canDuplicate && name.trim()) prepare(`Créer une copie privée indépendante de « ${view.name} » ?`, `view-sharing/views/${encodeURIComponent(view.id)}/duplicate`, { ...versionedCommand(view.version), name: name.trim() });
  }
  function revoke(share: ViewShare): void {
    prepare("Révoquer immédiatement ce partage ? La vue originale et son historique seront conservés.", `view-sharing/shares/${encodeURIComponent(share.id)}/revoke`, versionedCommand(share.viewVersion));
  }
  const unavailable = loading || busy || pending !== null;
  return <section className="shared-view-controls" aria-labelledby="view-sharing-title" aria-busy={loading || busy}>
    <header className="shared-view-row"><h2 id="view-sharing-title">Partage des vues</h2><button type="button" className="secondary-button" disabled={busy} onClick={() => requestRefresh()}>Actualiser les partages</button></header>
    <p>Vous partagez des filtres, jamais des droits sur les leads. Chaque lecteur conserve son propre périmètre.</p>
    <SharingFeedback loading={loading} feedback={feedback} />
    <div className="shared-view-grid">
      <label>Ma vue originale<select value={selected} disabled={unavailable} onChange={(event) => setSelected(event.target.value)}><option value="">Choisir une vue privée</option>{snapshot.owned.map((view) => <option key={view.id} value={view.id}>{view.name} — v{view.version}</option>)}</select></label>
      <label>Destinataire autorisé<select value={audienceId} disabled={unavailable} onChange={(event) => setAudienceId(event.target.value)}><option value="">Choisir une équipe ou un campus</option>{snapshot.audiences.map((value) => <option key={value.id} value={value.id}>{value.kind === "TEAM" ? "Équipe" : "Campus"} — {value.label}</option>)}</select></label>
      <label>Nom de la vue ou de la copie<input value={name} maxLength={80} disabled={unavailable} onChange={(event) => setName(event.target.value)} /></label>
    </div>
    <div className="shared-view-row">
      <button type="button" disabled={unavailable || !owned || !audience} onClick={share}>Partager la vue</button>
      {owned?.canEdit === true ? <><button type="button" className="secondary-button" disabled={unavailable || !name.trim()} onClick={() => prepare("Remplacer la définition originale par le nom et les filtres courants ? Les destinataires verront cette nouvelle version.", `lead-views/${encodeURIComponent(owned.id)}`, { name: name.trim(), filters: current, expectedVersion: owned.version }, "PATCH")}>Mettre à jour ma définition</button>
      <button type="button" className="secondary-button" disabled={unavailable} onClick={() => prepare("Archiver cette vue ? Tous ses partages deviendront immédiatement inaccessibles ; l’historique sera conservé.", `view-sharing/views/${encodeURIComponent(owned.id)}/archive`, versionedCommand(owned.version))}>Archiver ma vue</button></> : null}
    </div>
    {owned ? <div><p>Propriétaire : {owned.isOwner ? "Vous" : owned.ownerDisplayName}</p><AudienceBadges view={owned} /></div> : null}
    {!loading && feedback.kind !== "error" && !snapshot.audiences.length ? <p>Aucune audience de partage autorisée par vos permissions actuelles.</p> : null}
    {pending ? <section className="shared-view-confirm" aria-label="Confirmation de l’action">
      <h3>Confirmation requise</h3><p>{pending.label}</p>
      <div className="shared-view-row"><button type="button" disabled={busy} onClick={() => void confirm()}>{busy ? "Enregistrement…" : "Confirmer l’action"}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setPending(null)}>Annuler l’action</button></div>
    </section> : null}
    <h3>Partagées avec moi</h3>
    {!loading && feedback.kind !== "error" && !snapshot.received.length ? <p>Aucune vue partagée accessible.</p> : null}
    <div className="shared-view-grid">{snapshot.received.map((view) => <article className="shared-view-card" aria-label={view.name} key={view.id}>
      <h4>{view.name}</h4><p>Partagée par {view.isOwner ? "Vous" : view.ownerDisplayName}</p><AudienceBadges view={view} />
      <p>Version {view.version} · {view.canEdit ? "Modification autorisée" : "Définition en lecture seule"}</p>
      <div className="shared-view-row"><Link className="secondary-button" prefetch={false} href={sharedViewLink(view.id)}>Ouvrir la vue {view.name}</Link>
      {view.canDuplicate === true ? <button type="button" className="secondary-button" disabled={unavailable || !name.trim()} aria-label={`Dupliquer la vue ${view.name}`} onClick={() => duplicate(view)}>Dupliquer en privé</button> : null}
      {view.canRevoke === true ? <a className="secondary-button" href="#shared-view-history" aria-label={`Gérer la révocation de ${view.name}`}>Gérer la révocation</a> : null}</div>
    </article>)}</div>
    <h3 id="shared-view-history">Historique des partages administrables</h3>
    {!loading && feedback.kind !== "error" && !snapshot.history.length ? <p>Aucun partage à administrer.</p> : null}
    <div className="shared-view-grid">{snapshot.history.slice((historyPage - 1) * 10, historyPage * 10).map((item) => <article className="shared-view-card" key={item.id}>
      <h4>{item.kind === "TEAM" ? "Équipe" : "Campus"} · {item.active ? "Actif" : "Révoqué ou archivé"}</h4><p>Vue {item.viewId} · Version {item.viewVersion}</p><p>Destinataire {item.audienceId}</p>
      {item.canRevoke === true && item.active ? <button type="button" className="secondary-button" disabled={unavailable} aria-label={`Révoquer le partage ${item.id}`} onClick={() => revoke(item)}>Révoquer le partage</button> : null}
    </article>)}</div>
    <nav className="shared-view-row" aria-label="Pagination des partages"><button type="button" disabled={historyPage === 1 || unavailable} onClick={() => setHistoryPage((value) => value - 1)}>Partages précédents</button><span>Page {historyPage}</span><button type="button" disabled={historyPage * 10 >= snapshot.history.length || unavailable} onClick={() => setHistoryPage((value) => value + 1)}>Partages suivants</button></nav>
  </section>;
}
