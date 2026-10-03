"use client";
import { useEffect, useId, useState } from "react";
import { admissionsError, admissionsPeriod, admissionsRequest, admissionsTime, admissionsToday, type AdmissionsSlot } from "./admissions-client";

export function AdmissionsSlotPicker({ leadId, responsibilityId, durationMinutes, value, onChange, disabled = false, bookingId }: Readonly<{ leadId: string; responsibilityId: string; durationMinutes: number; value: string; onChange: (value: string) => void; disabled?: boolean; bookingId?: string }>): React.JSX.Element {
  const [day, setDay] = useState(admissionsToday); const [refresh, setRefresh] = useState(0);
  const titleId = useId();
  const [state, setState] = useState<{ kind: "idle" | "loading" | "ready" | "error"; items: AdmissionsSlot[]; message?: string }>({ kind: "idle", items: [] });
  useEffect(() => {
    const period = admissionsPeriod(day); if (!responsibilityId || !period) { setState({ kind: "idle", items: [] }); return; }
    const controller = new AbortController(); setState({ kind: "loading", items: [] });
    const query = new URLSearchParams({ leadId, responsibilityId, durationMinutes: String(durationMinutes), ...period, ...(bookingId ? { bookingId } : {}) });
    void admissionsRequest<{ items: AdmissionsSlot[] }>(`/admissions/slots?${query}`, { signal: controller.signal }).then((payload) => { if (!controller.signal.aborted) setState({ kind: "ready", items: payload.items }); }).catch((error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", items: [], message: admissionsError(error) }); });
    return (): void => controller.abort();
  }, [day, responsibilityId, durationMinutes, leadId, refresh, bookingId]);
  return <section className="admissions-slots" aria-labelledby={titleId} aria-busy={state.kind === "loading"}>
    <div className="admissions-section-heading"><div><h2 id={titleId}>Choisir un créneau libre</h2><p>Heure de Casablanca · seules les disponibilités déclarées sont proposées.</p></div><button className="text-button" type="button" onClick={() => { onChange(""); setRefresh((count) => count + 1); }} disabled={disabled || !responsibilityId || state.kind === "loading"}>Actualiser les créneaux</button></div>
    <label>Jour recherché<input name="bookingDay" type="date" min={admissionsToday()} value={day} onChange={(event) => { setDay(event.target.value); onChange(""); }} disabled={disabled} required /></label>
    {!responsibilityId ? <p className="admissions-notice">Choisissez d’abord un responsable d’admission.</p> : null}
    {state.kind === "loading" ? <p role="status">Lecture des disponibilités…</p> : null}
    {state.kind === "error" ? <p role="alert" className="admissions-error">{state.message}</p> : null}
    {state.kind === "ready" && !state.items.length ? <p role="status" className="admissions-notice">Aucun créneau déclaré libre pour ce jour et cette durée. Choisissez un autre jour ou une autre durée.</p> : null}
    {state.kind === "ready" && state.items.length ? <fieldset className="admissions-slot-list"><legend>Créneaux proposés</legend>{state.items.map((slot) => <label key={slot.startsAt} className={value === slot.startsAt ? "is-selected" : ""}><input type="radio" name="startsAt" value={slot.startsAt} checked={value === slot.startsAt} onChange={() => onChange(slot.startsAt)} disabled={disabled} required /><span>{admissionsTime(slot.startsAt)} – {admissionsTime(slot.endsAt)}</span></label>)}</fieldset> : null}
    {value && state.kind === "ready" && !state.items.some((slot) => slot.startsAt === value) ? <p role="alert" className="admissions-error">Le créneau précédemment choisi n’est plus proposé. Sélectionnez un créneau disponible.</p> : null}
  </section>;
}
