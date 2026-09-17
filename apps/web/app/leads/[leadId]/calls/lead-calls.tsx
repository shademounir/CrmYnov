"use client";

import { ArrowClockwise, PhoneCall, PhoneIncoming, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

type Event = Readonly<{ id: string; eventType: string; state: string; reasonCode?: string; occurredAt: string }>;
type Call = Readonly<{ id: string; direction: string; state: string; maskedPhone: string; matchState: string; requestedAt: string; durationSeconds?: number; recording: { state: string }; events: Event[] }>;
type Configuration = Readonly<{ mode: string; clickToCallEnabled: boolean; outboundEnabled: boolean }>;
type State = { kind: "loading" } | { kind: "ready"; calls: Call[]; configuration: Configuration } | { kind: "error"; message: string };

const stateLabels: Record<string, string> = { REQUESTED: "Demandé", RINGING: "Sonnerie", ANSWERED: "Décroché", MISSED: "Manqué", FAILED: "Échec", CANCELLED: "Annulé", ENDED: "Terminé" };
function formatDate(value: string): string { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(value)); }

export function LeadCalls({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const [callsResponse, configurationResponse] = await Promise.all([
        fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/calls`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } }),
        fetch("/api/crm/telephony/configuration", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } }),
      ]);
      if (!callsResponse.ok || !configurationResponse.ok) throw new Error("unavailable");
      const calls = await callsResponse.json() as { items?: Call[] };
      const configuration = await configurationResponse.json() as Configuration;
      if (!Array.isArray(calls.items)) throw new Error("invalid");
      setState({ kind: "ready", calls: calls.items, configuration });
    } catch { setState({ kind: "error", message: "L’historique téléphonique est indisponible. Aucun appel n’a été créé ou modifié." }); }
  }, [leadId]);
  useEffect(() => { void load(); }, [load]);

  if (state.kind === "loading") return <section className="panel calls-queue calls-queue--loading" aria-busy="true" aria-live="polite"><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="sr-only">Chargement de l’historique des appels…</span></section>;
  if (state.kind === "error") return <section className="ui-state ui-state--error calls-queue__state" role="alert"><WarningCircle size={28} /><h2>Historique indisponible</h2><p>{state.message}</p><button className="secondary-button" type="button" onClick={() => void load()}><ArrowClockwise size={18} /> Réessayer</button></section>;
  const manualReady = state.configuration.mode === "MANUAL_EXTERNAL" && state.configuration.clickToCallEnabled && state.configuration.outboundEnabled;
  return <div className="lead-calls">
    <aside className="ui-note lead-calls__mode" role="note"><strong>{manualReady ? "Journalisation manuelle disponible" : "Déclenchement désactivé"}</strong><span>{manualReady ? "L’appel est réalisé hors CRM ; seul son suivi structuré est enregistré ici." : "Aucun fournisseur téléphonique réel n’est configuré. Coovox, Linphone, audio et webhook restent désactivés."}</span></aside>
    <section className="panel lead-calls__history" aria-labelledby="lead-calls-title"><header><div><p className="eyebrow">Historique protégé</p><h2 id="lead-calls-title">Appels associés à ce Lead</h2></div><button className="text-button" type="button" onClick={() => void load()}><ArrowClockwise size={17} /> Actualiser</button></header>
      {state.calls.length === 0 ? <div className="calls-queue__empty" role="status"><PhoneCall size={30} /><div><h3>Aucun appel enregistré</h3><p>La page ne fabrique aucun événement de démonstration.</p></div></div> : <ol className="lead-calls__list">{state.calls.map((call) => <li key={call.id}><header><span className="calls-queue__call-icon"><PhoneIncoming size={20} /></span><div><p className="eyebrow">{call.direction === "INBOUND" ? "Appel entrant" : "Appel sortant"}</p><h3>{call.maskedPhone} · {stateLabels[call.state] ?? call.state}</h3><time dateTime={call.requestedAt}>{formatDate(call.requestedAt)} · heure de Casablanca</time></div></header><dl><div><dt>Durée</dt><dd>{call.durationSeconds === undefined ? "Non disponible" : `${call.durationSeconds} s`}</dd></div><div><dt>Enregistrement</dt><dd>{call.recording.state === "UNAVAILABLE" ? "Aucun audio" : call.recording.state}</dd></div></dl><details><summary>Chronologie immuable ({call.events.length})</summary><ol>{call.events.map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time><strong>{stateLabels[event.state] ?? event.state}</strong>{event.reasonCode ? <span>Correction : {event.reasonCode}</span> : null}</li>)}</ol></details></li>)}</ol>}
    </section>
  </div>;
}
