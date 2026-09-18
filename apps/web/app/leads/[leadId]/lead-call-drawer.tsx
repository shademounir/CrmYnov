"use client";

import React, { useEffect, useRef, useState } from "react";
import { PhoneCall, PhoneDisconnect, X } from "@phosphor-icons/react";

type CallState = "REQUESTED" | "DIALING" | "RINGING" | "ANSWERED" | "ENDED" | "FAILED" | "MISSED" | "CANCELLED";
type DispatchState = "PENDING" | "ACCEPTED" | "UNCERTAIN" | "REJECTED";
interface CallRecord { id: string; state: CallState; dispatchState: DispatchState; maskedPhone: string; durationSeconds?: number }
interface ConfigurationPayload { mode?: string; clickToCallEnabled?: boolean; outboundEnabled?: boolean; outboundReadiness?: { available?: boolean; reason?: string; sdkLoaded?: boolean; sipRegistered?: boolean; identityLabel?: string } }

function maskPhone(phone: string): string { const digits = phone.replace(/\D/g, ""); return digits.length >= 3 ? `••• ${digits.slice(-3)}` : "numéro masqué"; }
export function callStateLabel(state: CallState): string {
  return ({ REQUESTED: "Demande enregistrée", DIALING: "Numérotation en cours", RINGING: "Sonnerie en cours", ANSWERED: "Appel décroché", ENDED: "Appel terminé", FAILED: "Appel en échec", MISSED: "Sans réponse", CANCELLED: "Appel annulé" } as const)[state];
}
function isCall(value: unknown): value is CallRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.state === "string" && typeof candidate.dispatchState === "string" && typeof candidate.maskedPhone === "string";
}
function stateLabel(call: CallRecord): string {
  if (call.dispatchState === "UNCERTAIN") return "La numérotation a peut-être été transmise. Ne relancez pas automatiquement : vérifiez le poste Windows.";
  if (call.dispatchState === "REJECTED" || call.state === "FAILED") return "L’appel a été refusé ou a échoué. Aucun basculement vers un autre mode n’a été effectué.";
  if (call.dispatchState === "PENDING") return "Demande enregistrée. L’agent Windows ne l’a pas encore réclamée.";
  return ({ REQUESTED: "Commande acceptée par l’agent. En attente d’un événement SDK.", DIALING: "L’agent Windows a demandé la numérotation au SDK.", RINGING: "Le SDK indique que le poste distant sonne.", ANSWERED: "Appel décroché. La durée est calculée depuis cet événement SDK.", ENDED: "Appel terminé et historique enregistré.", MISSED: "Aucune réponse observée par le SDK.", CANCELLED: "Appel annulé." } as const)[call.state];
}
function readinessLabel(configuration: ConfigurationPayload | undefined, hasPhone: boolean): string {
  if (configuration?.mode !== "LINPHONE") return "Le mode Linphone réel n’est pas sélectionné.";
  if (!hasPhone) return "Ce Lead ne possède pas de téléphone utilisable.";
  if (["NOT_CONFIGURED", "WORKSTATION_NOT_PAIRED", "USER_PROFILE_DISABLED"].includes(configuration.outboundReadiness?.reason ?? "")) return "Ce compte CRM n’a pas de poste Windows Liblinphone prêt.";
  if (configuration.outboundReadiness?.reason === "WORKSTATION_OFFLINE") return "L’agent Windows associé est hors ligne.";
  if (configuration.outboundReadiness?.reason === "SDK_NOT_LOADED") return "L’agent répond, mais le SDK Liblinphone n’est pas chargé.";
  if (configuration.outboundReadiness?.reason === "SIP_NOT_REGISTERED") return "Le SDK est chargé, mais le compte SIP n’est pas enregistré.";
  return "L’agent Windows est injoignable ou indisponible.";
}

export function LeadCallDrawer({ leadId, leadCode, phone, onCompleted }: Readonly<{ leadId: string; leadCode: string; phone?: string; onCompleted?: () => void }>): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const idempotency = useRef<string | undefined>(undefined); const submitting = useRef(false); const [configuration, setConfiguration] = useState<ConfigurationPayload>();
  const [call, setCall] = useState<CallRecord>(); const [loading, setLoading] = useState(false); const [error, setError] = useState<string>();
  const callable = Boolean(phone && configuration?.mode === "LINPHONE" && configuration.clickToCallEnabled && configuration.outboundEnabled && configuration.outboundReadiness?.available);

  async function loadConfiguration(): Promise<void> {
    setLoading(true); setError(undefined);
    try {
      const response = await fetch("/api/crm/telephony/configuration", { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`configuration_${response.status}`);
      setConfiguration(await response.json() as ConfigurationPayload);
    } catch { setError("La disponibilité de l’agent Windows n’a pas pu être vérifiée. Aucun appel ne sera lancé."); }
    finally { setLoading(false); }
  }
  function open(): void { setCall(undefined); setError(undefined); idempotency.current = undefined; dialog.current?.showModal(); void loadConfiguration(); }
  function close(): void { dialog.current?.close(); queueMicrotask(() => trigger.current?.focus()); }
  async function initiate(): Promise<void> {
    if (!callable || loading || submitting.current) return;
    submitting.current = true; setLoading(true); setError(undefined); idempotency.current ??= `outbound-${crypto.randomUUID()}`;
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/calls`, { method: "POST", credentials: "same-origin", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: idempotency.current }) });
      const payload = await response.json() as unknown;
      if (!response.ok || !isCall(payload)) throw new Error(`call_${response.status}`);
      setCall(payload); onCompleted?.();
    } catch { setError("La commande n’a pas été confirmée. Vérifiez l’état de l’agent avant toute nouvelle tentative."); }
    finally { submitting.current = false; setLoading(false); }
  }
  async function end(): Promise<void> {
    if (!call || loading || submitting.current) return; submitting.current = true; setLoading(true); setError(undefined);
    try {
      const response = await fetch(`/api/crm/calls/${encodeURIComponent(call.id)}/end`, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
      const payload = await response.json() as { accepted?: boolean; uncertain?: boolean };
      if (!response.ok) throw new Error(`end_${response.status}`);
      if (payload.uncertain) setError("La demande de fin est incertaine. Vérifiez le poste Windows ; aucune relance automatique n’est effectuée.");
    } catch { setError("La fin d’appel n’a pas été confirmée par l’agent Windows."); }
    finally { submitting.current = false; setLoading(false); }
  }

  useEffect(() => {
    if (!call || ["ENDED", "FAILED", "MISSED", "CANCELLED"].includes(call.state)) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/crm/calls/${encodeURIComponent(call.id)}`, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } })
        .then(async (response) => response.ok ? response.json() as Promise<unknown> : undefined)
        .then((payload) => { if (isCall(payload)) setCall(payload); }).catch(() => undefined);
    }, 1_500);
    return (): void => window.clearInterval(timer);
  }, [call]);

  const unavailable = !loading && !callable;
  return <><button ref={trigger} className="secondary-button" type="button" onClick={open}><PhoneCall size={18} aria-hidden="true" /> Appeler</button>
    <dialog ref={dialog} className="lead-assignment-dialog lead-call-dialog" aria-labelledby="lead-call-title">
      <header className="lead-assignment-dialog__header"><div><p className="eyebrow">Téléphonie sortante</p><h2 id="lead-call-title">Appeler depuis le CRM</h2><p>{leadCode} · agent Windows et SDK Liblinphone requis.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le panneau d’appel"><X size={20} aria-hidden="true" /></button></header>
      <div className="lead-assignment-dialog__form">
        <section className="lead-call-dialog__recipient" aria-labelledby="lead-call-recipient"><p className="eyebrow" id="lead-call-recipient">Destinataire confirmé</p><strong>{phone ? maskPhone(phone) : "Aucun téléphone autorisé"}</strong><p>Le numéro complet est relu par l’API et transmis uniquement à l’agent au moment de composer.</p></section>
        {loading && !call ? <p aria-busy="true">Vérification de l’agent Windows…</p> : null}
        {unavailable ? <div className="lead-assignment-dialog__feedback lead-assignment-dialog__feedback--error" role="status">
          {readinessLabel(configuration, Boolean(phone))}
          <br />Aucun repli vers l’appel manuel ou Coovox n’est appliqué.
        </div> : null}
        {!call && callable ? <><p className="lead-assignment-dialog__notice">Confirmez une seule fois. Une commande acceptée ne signifie ni sonnerie ni décroché ; ces états viendront du SDK.</p>{configuration?.outboundReadiness?.identityLabel ? <p className="lead-call-dialog__identity">Identité téléphonique du poste : <strong>{configuration.outboundReadiness.identityLabel}</strong></p> : null}</> : null}
        {call ? <section className={`lead-call-dialog__state lead-call-dialog__state--${call.dispatchState.toLowerCase()}`} aria-live="polite"><p className="eyebrow">État observé</p><h3>{callStateLabel(call.state)}</h3><p>{stateLabel(call)}</p>{typeof call.durationSeconds === "number" ? <p>Durée observée : {call.durationSeconds} s</p> : null}</section> : null}
        {error ? <p className="lead-assignment-dialog__feedback lead-assignment-dialog__feedback--error" role="alert">{error}</p> : null}
        <footer className="lead-assignment-dialog__footer">
          <button className="text-button" type="button" onClick={close}>Fermer</button>
          {!call ? <button className="primary-button" type="button" disabled={!callable || loading} onClick={() => void initiate()}>{loading ? "Vérification…" : "Confirmer l’appel"}</button> : null}
          {call && ["REQUESTED", "DIALING", "RINGING", "ANSWERED"].includes(call.state) ? <button className="secondary-button" type="button" disabled={loading} onClick={() => void end()}><PhoneDisconnect size={18} aria-hidden="true" /> Terminer</button> : null}
        </footer>
      </div>
    </dialog></>;
}
