"use client";
import React, { useRef, useState } from "react";
import { sheetRequest, SheetRequestError } from "./sheets-client";
import { historicalReviewState, historicalCommand, historicalPendingDisposition, type HistoricalReviewState, type HistoricalCommand } from "./historical-review-client";
export function SheetHistoricalReview({ connectorId, disabled }: Readonly<{
    connectorId: string;
    disabled: boolean;
}>): React.JSX.Element {
    const [state, setState] = useState<HistoricalReviewState | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [reasons, setReasons] = useState<Record<number, string>>({ 2585: "", 2586: "" });
    const pending = useRef<HistoricalCommand | null>(null), inFlight = useRef(false), rejected = useRef(false);
    async function read(): Promise<void> {
        if (disabled || inFlight.current) { return; }
        inFlight.current = true;
        setBusy(true);
        setMessage("");
        try {
        const next = historicalReviewState(await sheetRequest(`/${encodeURIComponent(connectorId)}/historical-review`));
        setState(next);
        if (pending.current) {
            const disposition = historicalPendingDisposition(next, pending.current, rejected.current);
            if (disposition === "recorded") {
                pending.current = null;
                rejected.current = false;
                setMessage("Reçu durable retrouvé. Aucun nouvel acquittement envoyé.");
            }
            else if (disposition === "obsolete") {
                pending.current = null;
                rejected.current = false;
                setMessage("Demande refusée ou obsolète, inventaire réconcilié. Vous pouvez confirmer une nouvelle demande pour la ligne encore libre ; aucune demande n’a été rejouée.");
            }
            else
                setMessage("Demande non retrouvée dans cet inventaire relu. Seule la même demande peut être réessayée ; ne changez pas le connecteur.");
        }
    }
    catch (e) {
        setState(null);
        setMessage(e instanceof Error ? e.message : "Lecture refusée.");
    }
    finally {
        inFlight.current = false;
        setBusy(false);
        }
    }
    async function acknowledge(row: 2585 | 2586): Promise<void> {
        if (disabled || inFlight.current || !state)
            return;
        inFlight.current = true;
        setBusy(true);
        setMessage("");
        try {
            const body = pending.current ?? historicalCommand(state, row, reasons[row] ?? "", `historical-${crypto.randomUUID()}`);
            if (!pending.current)
                rejected.current = false;
            pending.current = body;
            try {
                await sheetRequest(`/${encodeURIComponent(connectorId)}/historical-acknowledgements`, "POST", body);
            }
            catch (e) {
                if (e instanceof SheetRequestError && [400, 401, 403, 404, 409, 422].includes(e.status))
                    rejected.current = true;
                throw e;
            }
            const next = historicalReviewState(await sheetRequest(`/${encodeURIComponent(connectorId)}/historical-review`));
            if (!next.decisions.some(d => d.idempotencyKey === body.idempotencyKey))
                throw new Error("Reçu non retrouvé. Relisez sans envoyer une nouvelle clé.");
            pending.current = null;
            setState(next);
            setMessage(`Reçu H${body.row} relu. Aucun Lead créé, aucune activation.`);
        }
        catch (e) {
            setState(null);
            setMessage(`${e instanceof Error ? e.message : "Résultat non confirmé."} Relisez avant toute reprise. La même demande est conservée dans cette page.`);
        }
        finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    return <section aria-label="Revue historique H2585 H2586" className="sheets-append-monitor" aria-busy={busy}><h3>H2585 / H2586 · décision source uniquement</h3>
  <p>Deux changements de la colonne H, sans correction d’identité ni modification du suivi CRM. Les valeurs privées antérieures et les deux reçus restent distincts. Cette étape ne réarme pas un flux suspendu et n’active pas Sheets.</p>
  <button type="button" disabled={disabled || busy} onClick={() => { void read(); }}>Relire la source et les reçus historiques</button>
  {state ? <><p>{state.revision} / 2 décisions persistées · version du connecteur {state.connectorVersion}. La qualification schéma3 et la bascule restent des contrôles distincts.</p>
   {state.transitions.map(t => {
                const acquired = state.decisions.find(d => d.row === t.row);
                return <fieldset key={t.row} disabled={disabled || busy || Boolean(acquired) || Boolean(pending.current)}><legend>H{t.row}</legend><p>Ancienne empreinte : <code>{t.originalFingerprint}</code><br />Empreinte proposée : <code>{t.acceptedFingerprint}</code></p>
    {acquired ? <p>Reçu persisté, révision {acquired.revision} · {acquired.reason}</p> : <><label>Motif individuel H{t.row}<textarea maxLength={1000} value={reasons[t.row] ?? ""} onChange={e => setReasons({ ...reasons, [t.row]: e.target.value })}/></label><button type="button" disabled={(reasons[t.row]?.trim().length ?? 0) < 8} onClick={() => { void acknowledge(t.row as 2585 | 2586); }}>Acquitter uniquement H{t.row}</button></>}</fieldset>;
            })}
   {pending.current ? <button type="button" disabled={disabled || busy} onClick={() => { if (pending.current)
            void acknowledge(pending.current.row); }}>Réessayer la même demande conservée</button> : null}</> : <p>État non acquis. Aucune décision ni qualification n’est présumée.</p>}
  {message ? <output>{message}</output> : null}</section>;
}
