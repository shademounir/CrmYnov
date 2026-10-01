"use client";

import { ArrowClockwise, ArrowRight, Bell, Check, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

type NotificationItem = Readonly<{ id: string; type: string; priority: "LOW" | "NORMAL" | "HIGH"; resourceType: string; resourceId: string; href: string; createdAt: string; readAt?: string }>;
type NotificationPage = Readonly<{ items: NotificationItem[]; page: number; pageSize: number; total: number; unread: number }>;
type CenterState = { kind: "loading" } | { kind: "session" | "forbidden" | "error"; message: string } | { kind: "ready"; data: NotificationPage };

const labels: Readonly<Record<string, { title: string; detail: string }>> = {
  ASSIGNMENT: { title: "Nouveau Lead affecté", detail: "Un dossier vient de rejoindre votre portefeuille." },
  REASSIGNMENT_DECISION: { title: "Décision de réaffectation", detail: "Une demande de réaffectation a été traitée." },
  CLOSURE_REQUEST: { title: "Clôture à examiner", detail: "Une décision humaine est attendue sur un dossier." },
  COLLABORATOR_REQUEST: { title: "Collaboration à examiner", detail: "Une demande d’accès à un dossier a évolué." },
  FOLLOW_UP_DUE: { title: "Relance arrivée à échéance", detail: "Une prochaine action doit être traitée." },
  IMPORT_REVIEW: { title: "Import à vérifier", detail: "Une ligne importée demande une revue." },
  CHAT_MENTION: { title: "Mention dans le chat", detail: "Un collègue vous a mentionné dans une conversation." },
  BROADCAST: { title: "Annonce interne", detail: "Une nouvelle communication interne est disponible." },
  BROADCAST_CORRECTION: { title: "Correction d’annonce", detail: "Une communication interne a été rectifiée." },
  DOCUMENT_RECEIVED: { title: "Document reçu", detail: "Une nouvelle pièce est prête à être examinée." },
  DOCUMENT_VALIDATED: { title: "Document validé", detail: "La vérification d’une pièce est terminée." },
  DOCUMENT_REFUSED: { title: "Document refusé", detail: "Une pièce nécessite une nouvelle action." },
  APPOINTMENT: { title: "Rendez-vous mis à jour", detail: "Un rendez-vous lié à votre activité a évolué." },
};

export async function loadNotifications(page: number, request: typeof fetch = fetch): Promise<CenterState> {
  const response = await request(`/api/crm/notifications?page=${page}&pageSize=25`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  if (response.status === 401) return { kind: "session", message: "Votre session a expiré. Reconnectez-vous pour consulter vos notifications." };
  if (response.status === 403) return { kind: "forbidden", message: "Votre rôle ne permet pas de consulter ce centre." };
  if (!response.ok) return { kind: "error", message: "Le centre est momentanément indisponible. Vos notifications ne sont pas marquées comme lues." };
  return { kind: "ready", data: await response.json() as NotificationPage };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(value));
}

function dispatchCount(unread: number): void {
  globalThis.dispatchEvent(new CustomEvent<number>("crm:notifications-changed", { detail: unread }));
}

export function NotificationCenter(): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<CenterState>({ kind: "loading" });
  const [pending, setPending] = useState<string>();
  const refresh = useCallback(async (target = page): Promise<void> => { setState({ kind: "loading" }); const next = await loadNotifications(target).catch((): CenterState => ({ kind: "error", message: "Le centre est momentanément indisponible. Vos notifications ne sont pas marquées comme lues." })); setState(next); if (next.kind === "ready") dispatchCount(next.data.unread); }, [page]);

  useEffect(() => { void refresh(page); }, [page, refresh]);

  const mutate = async (path: string, id: string): Promise<boolean> => {
    setPending(id);
    try {
      const response = await fetch(`/api/crm/notifications/${path}`, { method: "PATCH", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) { setState({ kind: response.status === 401 ? "session" : response.status === 403 ? "forbidden" : "error", message: response.status === 401 ? "Votre session a expiré. Reconnectez-vous pour continuer." : response.status === 403 ? "Cette action n’est pas autorisée pour votre rôle." : "La lecture n’a pas pu être confirmée. La notification reste non lue." }); return false; }
      await refresh(page); return true;
    } finally { setPending(undefined); }
  };

  if (state.kind === "loading") return <section className="panel notifications-center" aria-busy="true" aria-live="polite"><div className="notifications-center__toolbar"><span className="ui-skeleton notifications-center__title" /></div><div className="notifications-center__skeleton"><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" /></div><span className="sr-only">Chargement des notifications…</span></section>;
  if (state.kind !== "ready") return <section className="ui-state ui-state--error notifications-center__state" role="alert"><WarningCircle size={28} /><h2>Centre indisponible</h2><p>{state.message}</p><button type="button" className="secondary-button" onClick={() => void refresh(page)}><ArrowClockwise size={18} /> Réessayer</button></section>;

  const { data } = state;
  if (data.items.length === 0) return <section className="panel notifications-center notifications-center--empty" aria-live="polite"><span className="notifications-center__empty-icon"><CheckCircle size={28} /></span><div><p className="eyebrow">À jour</p><h2>Aucune notification à traiter</h2><p>Les nouvelles alertes internes apparaîtront ici. Aucun canal externe n’est activé par cet écran.</p></div></section>;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <section className="panel notifications-center" aria-label="Notifications internes" aria-live="polite">
    <header className="notifications-center__toolbar">
      <div><p className="eyebrow">Boîte de réception</p><h2>{data.unread ? `${data.unread} non lue${data.unread > 1 ? "s" : ""}` : "Tout est lu"}</h2><p>{data.total} notification{data.total > 1 ? "s" : ""} conservée{data.total > 1 ? "s" : ""}.</p></div>
      <button type="button" className="secondary-button" disabled={data.unread === 0 || pending === "all"} onClick={() => void mutate("read-all", "all")}><Check size={18} /> Tout marquer comme lu</button>
    </header>
    <ol className="notifications-list">
      {data.items.map((item) => {
        const copy = labels[item.type] ?? { title: "Notification interne", detail: "Un événement métier demande votre attention." };
        const unread = !item.readAt;
        return <li key={item.id} className={unread ? "is-unread" : ""}>
          <span className={`notifications-list__priority notifications-list__priority--${item.priority.toLowerCase()}`} aria-label={`Priorité ${item.priority === "HIGH" ? "haute" : item.priority === "LOW" ? "basse" : "normale"}`}><Bell size={18} weight={unread ? "fill" : "regular"} /></span>
          <div className="notifications-list__copy"><div><h3>{copy.title}</h3>{unread ? <span className="status-badge">Non lue</span> : null}</div><p>{copy.detail}</p><time dateTime={item.createdAt}>{formatDate(item.createdAt)} · heure de Casablanca</time></div>
          <div className="notifications-list__actions">
            {unread ? <button type="button" className="text-button" disabled={pending === item.id} onClick={() => void mutate(`${encodeURIComponent(item.id)}/read`, item.id)}>Marquer comme lue</button> : <span className="notifications-list__read"><Check size={15} /> Lue</span>}
            <a className="secondary-button" href={item.href} onClick={(event) => { if (!unread) return; event.preventDefault(); void mutate(`${encodeURIComponent(item.id)}/read`, item.id).then((ok) => { if (ok) globalThis.location.assign(item.href); }); }}>Ouvrir <ArrowRight size={16} /></a>
          </div>
        </li>;
      })}
    </ol>
    {pages > 1 ? <footer className="notifications-center__pagination"><button type="button" className="text-button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Page précédente</button><span>Page {page} sur {pages}</span><button type="button" className="text-button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Page suivante</button></footer> : null}
  </section>;
}
