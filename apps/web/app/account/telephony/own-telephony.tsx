"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ownAgentGatewayUrl, ownTelephonyError, ownTelephonyRequest, parseOwnPairingCode, parseOwnTelephonySnapshot, type OwnPairingCode, type OwnTelephonySnapshot } from "./own-telephony-contract";
import { OwnTelephonyView, type TelephonyFeedback } from "./own-telephony-view";

export function OwnTelephony(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<OwnTelephonySnapshot>();
  const [gatewayUrl, setGatewayUrl] = useState<string>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<TelephonyFeedback>();
  const [pairing, setPairing] = useState<OwnPairingCode>(), [revealCode, setRevealCode] = useState(false);
  const [confirmedPairing, setConfirmedPairing] = useState(false), [confirmRevoke, setConfirmRevoke] = useState(false);
  const busyRef = useRef(false), mounted = useRef(false), generation = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null), revokeRef = useRef<HTMLButtonElement>(null), refreshRef = useRef<HTMLButtonElement>(null);

  const clearPairing = useCallback((): void => { setPairing(undefined); setRevealCode(false); }, []);
  const load = useCallback(async (silent = false): Promise<void> => {
    if (busyRef.current) return;
    const requestGeneration = ++generation.current;
    if (!silent) { setLoading(true); setFeedback(undefined); clearPairing(); }
    try {
      const next = parseOwnTelephonySnapshot(await ownTelephonyRequest(""));
      if (!mounted.current || requestGeneration !== generation.current) return;
      setSnapshot(next);
      setFeedback((current) => current?.kind === "success" ? current : undefined);
      if (next.workstation?.active || !next.canPair) clearPairing();
    } catch (error_) {
      if (!mounted.current || requestGeneration !== generation.current) return;
      setSnapshot(undefined); clearPairing(); setFeedback(ownTelephonyError(error_));
    } finally { if (mounted.current && requestGeneration === generation.current) setLoading(false); }
  }, [clearPairing]);

  useEffect(() => {
    mounted.current = true; void load();
    setGatewayUrl(ownAgentGatewayUrl(window.location.origin));
    const poll = globalThis.setInterval(() => { void load(true); }, 15_000);
    const hide = (): void => {
      generation.current++; clearPairing(); setLoading(false);
      if (busyRef.current) {
        busyRef.current = false; setBusy(false);
        setFeedback({ kind: "unavailable", message: "La page a été quittée pendant une opération. Son résultat n’est pas confirmé ici ; actualisez l’état avant toute nouvelle action." });
      }
    };
    const show = (event: PageTransitionEvent): void => { if (event.persisted) { void load(); } };
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show);
    return (): void => { mounted.current = false; generation.current++; globalThis.clearInterval(poll); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); clearPairing(); };
  }, [clearPairing, load]);

  useEffect(() => {
    if (!pairing) return;
    const expire = (): void => { if (Date.parse(pairing.expiresAt) <= Date.now()) { clearPairing(); setFeedback({ kind: "unavailable", message: "Le code d’association a expiré. Il a été retiré de cette page ; générez-en un nouveau uniquement si nécessaire." }); } };
    expire(); const timer = globalThis.setInterval(expire, 1000);
    return (): void => { globalThis.clearInterval(timer); };
  }, [clearPairing, pairing]);

  useEffect(() => {
    if (confirmRevoke) dialogRef.current?.showModal();
  }, [confirmRevoke]);

  const closeRevoke = (): void => { setConfirmRevoke(false); globalThis.setTimeout(() => { (revokeRef.current ?? refreshRef.current)?.focus(); }, 0); };

  async function issuePairing(): Promise<void> {
    if (busyRef.current || !snapshot?.profile || !snapshot.canPair || !confirmedPairing || !gatewayUrl) return;
    busyRef.current = true; const requestGeneration = ++generation.current; setBusy(true); setFeedback(undefined); clearPairing();
    try {
      const next = parseOwnPairingCode(await ownTelephonyRequest("/pairing-codes", { method: "POST", body: JSON.stringify({ expectedVersion: snapshot.profile.version }) }));
      if (!mounted.current || requestGeneration !== generation.current) return;
      if (next.profileId !== snapshot.profile.id) throw new Error("telephony_pairing_invalid");
      setSnapshot((current) => current?.profile?.id === next.profileId ? { ...current, profile: { ...current.profile, version: next.version } } : current);
      setPairing(next); setConfirmedPairing(false);
    } catch (error_) { if (mounted.current && requestGeneration === generation.current) { const error = ownTelephonyError(error_); setFeedback(error); if (error.kind === "session" || error.kind === "forbidden") setSnapshot(undefined); } }
    finally { if (requestGeneration === generation.current) { busyRef.current = false; if (mounted.current) { setBusy(false); setLoading(false); } } }
  }

  async function revoke(): Promise<void> {
    if (busyRef.current || !snapshot?.workstation || !snapshot.canRevoke) return;
    busyRef.current = true; const requestGeneration = ++generation.current; setBusy(true); setFeedback(undefined); clearPairing();
    try {
      const next = parseOwnTelephonySnapshot(await ownTelephonyRequest(`/workstations/${encodeURIComponent(snapshot.workstation.id)}/revoke`, { method: "PATCH", body: JSON.stringify({ expectedVersion: snapshot.workstation.version }) }));
      if (!mounted.current || requestGeneration !== generation.current) return;
      setSnapshot(next); setFeedback({ kind: "success", message: "L’accès CRM de ce poste est révoqué. Cela ne confirme pas l’arrêt du client SIP : arrêtez l’ancien agent avant toute réassociation." }); closeRevoke();
    } catch (error_) { if (mounted.current && requestGeneration === generation.current) { const error = ownTelephonyError(error_); setFeedback(error); if (error.kind === "session" || error.kind === "forbidden") { setSnapshot(undefined); closeRevoke(); } } }
    finally { if (requestGeneration === generation.current) { busyRef.current = false; if (mounted.current) { setBusy(false); setLoading(false); } } }
  }

  const ready = Boolean(snapshot?.readiness.available && snapshot.global.enabled && snapshot.global.mode === "LINPHONE" && snapshot.profile?.enabled && snapshot.workstation?.active && !snapshot.workstation.revokedAt && snapshot.workstation.connectionState === "CONNECTED" && snapshot.workstation.sdkLoaded && snapshot.workstation.sipRegistered);
  const mutationBlocked = Boolean(feedback && feedback.kind !== "success");
  return <OwnTelephonyView snapshot={snapshot} loading={loading} busy={busy} ready={ready} mutationBlocked={mutationBlocked}
    feedback={feedback} pairing={pairing} gatewayUrl={gatewayUrl} revealCode={revealCode} confirmedPairing={confirmedPairing} confirmRevoke={confirmRevoke}
    refreshRef={refreshRef} revokeRef={revokeRef} dialogRef={dialogRef} onRefresh={() => { void load(); }}
    onOpenAgent={() => setFeedback({ kind: "success", message: "Demande d’ouverture transmise au navigateur. Confirmez l’ouverture de l’agent si demandé ; son lancement et sa connexion ne sont pas encore prouvés." })}
    onPairingConfirmation={setConfirmedPairing} onPair={() => { void issuePairing(); }}
    onRevealCode={() => { if (pairing && Date.parse(pairing.expiresAt) > Date.now()) setRevealCode((value) => !value); else clearPairing(); }} onClearCode={clearPairing}
    onRevokeSelection={() => setConfirmRevoke(true)} onCancelRevoke={closeRevoke} onConfirmRevoke={() => { void revoke(); }} />;
}
