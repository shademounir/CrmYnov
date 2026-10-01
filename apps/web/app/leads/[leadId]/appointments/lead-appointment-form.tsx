"use client";

import Link from "next/link";
import { ArrowLeft, CalendarBlank, CheckCircle, Clock, ShieldCheck } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { LeadProfileRecord } from "../lead-profile";

type LoadState = { kind: "loading" } | { kind: "ready"; lead: LeadProfileRecord } | { kind: "error" };
type SubmitState = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string } | { kind: "success"; appointmentId: string };

const errorMessages: Readonly<Record<string, string>> = {
  appointment_invalid: "Vérifiez la date future, la durée et les champs obligatoires.",
  appointment_campus_required: "Le rendez-vous sur site doit utiliser le campus du Lead.",
  appointment_idempotency_conflict: "Cette tentative existe avec des informations différentes. Vérifiez les champs avant de réessayer.",
  permission_denied: "Vous n’avez pas le droit de planifier ce rendez-vous dans ce périmètre.",
  lead_not_found: "Le Lead n’est plus disponible dans votre périmètre.",
};

export const appointmentTypeOptions = ["APPEL_INFORMATION", "VISITE_CAMPUS", "ENTRETIEN_ADMISSION", "ENTRETIEN_MOTIVATION", "TEST_ADMISSION", "RENDEZ_VOUS_DIRECTION", "RENDEZ_VOUS_LIBRE"] as const;
export const appointmentDurationOptions = [15, 30, 45, 60, 90, 120] as const;

function casablancaParts(date: Date): Readonly<Record<string, string>> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
}

export function casablancaDateTimeToIso(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let utc = target;
  for (let index = 0; index < 3; index += 1) {
    const parts = casablancaParts(new Date(utc));
    const projected = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    utc += target - projected;
  }
  const resolved = new Date(utc);
  const verification = casablancaParts(resolved);
  if (`${verification.year}-${verification.month}-${verification.day}T${verification.hour}:${verification.minute}` !== value) return undefined;
  return resolved.toISOString();
}

function defaultStart(): string {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setUTCMinutes(Math.ceil(date.getUTCMinutes() / 15) * 15, 0, 0);
  const parts = casablancaParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function responseCode(response: Response): Promise<string> {
  try { const payload = await response.json() as { code?: string; message?: string }; return payload.code ?? payload.message ?? "appointment_unavailable"; }
  catch { return "appointment_unavailable"; }
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function LeadAppointmentForm({ leadId }: Readonly<{ leadId: string }>): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [mode, setMode] = useState("TELEPHONE");
  const attempt = useRef<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/crm/leads/${encodeURIComponent(leadId)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("lead_unavailable"); setLoad({ kind: "ready", lead: await response.json() as LeadProfileRecord }); })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setLoad({ kind: "error" }); });
    return (): void => controller.abort();
  }, [leadId]);

  function changed(): void { if (submit.kind !== "saving") { attempt.current = undefined; if (submit.kind !== "idle") setSubmit({ kind: "idle" }); } }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (load.kind !== "ready" || submit.kind === "saving" || submit.kind === "success") return;
    const form = new FormData(event.currentTarget);
    attempt.current ??= crypto.randomUUID();
    const startsAt = casablancaDateTimeToIso(formText(form, "startsAt"));
    if (!startsAt || new Date(startsAt).valueOf() <= Date.now()) { setSubmit({ kind: "error", message: errorMessages.appointment_invalid! }); return; }
    const body = {
      type: formText(form, "type"), mode, startsAt,
      durationMinutes: Number(formText(form, "durationMinutes")), state: "PLANIFIE",
      ...(mode === "SUR_SITE" ? { campus: load.lead.campus } : {}), idempotencyKey: attempt.current,
    };
    setSubmit({ kind: "saving" });
    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/appointments`, { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const code = await responseCode(response); setSubmit({ kind: "error", message: errorMessages[code] ?? "Le rendez-vous n’a pas pu être confirmé. Votre saisie est conservée." }); return; }
      const created = await response.json() as { id?: string };
      if (!created.id) throw new Error("appointment_missing_id");
      setSubmit({ kind: "success", appointmentId: created.id });
    } catch { setSubmit({ kind: "error", message: "La réponse du serveur n’a pas pu être confirmée. Vérifiez l’agenda avant de soumettre à nouveau." }); }
  }

  if (load.kind === "loading") return <main className="lead-appointment-page"><section className="connected-state" aria-live="polite" aria-busy="true"><span className="ui-skeleton connected-state__skeleton" /><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Chargement du Lead…</span></section></main>;
  if (load.kind === "error") return <main className="lead-appointment-page"><Link className="lead-profile__back" href={`/leads/${encodeURIComponent(leadId)}`}><ArrowLeft size={17} /> Retour à la fiche</Link><section className="ui-state ui-state--error" role="alert"><h1>Planification indisponible</h1><p>Le Lead ou votre session n’a pas pu être relu depuis l’API locale.</p><button type="button" onClick={() => globalThis.location.reload()}>Réessayer</button></section></main>;

  const name = `${load.lead.firstName} ${load.lead.lastName}`.trim() || load.lead.leadCode;
  return <main className="lead-appointment-page">
    <Link className="lead-profile__back" href={`/leads/${encodeURIComponent(leadId)}`}><ArrowLeft size={17} aria-hidden="true" /> Retour à la fiche</Link>
    <header className="lead-appointment-page__header"><div><p className="eyebrow">Relation Ynov · rendez-vous</p><h1>Planifier avec {name}</h1><p>Créez un rendez-vous CRM durable, visible dans l’agenda du campus.</p></div><span><CalendarBlank size={20} aria-hidden="true" /> {load.lead.leadCode}</span></header>
    <div className="lead-appointment-layout">
      <form className="panel lead-appointment-form" onSubmit={(event) => { void save(event); }} onChange={changed}>
        <fieldset disabled={submit.kind === "saving" || submit.kind === "success"}><legend>Informations du rendez-vous</legend>
          <div className="lead-appointment-form__grid">
            <label>Type de rendez-vous<select name="type" defaultValue="RENDEZ_VOUS_LIBRE" required><option value="APPEL_INFORMATION">Appel d’information</option><option value="VISITE_CAMPUS">Visite du campus</option><option value="ENTRETIEN_ADMISSION">Entretien d’admission</option><option value="ENTRETIEN_MOTIVATION">Entretien de motivation</option><option value="TEST_ADMISSION">Test d’admission</option><option value="RENDEZ_VOUS_DIRECTION">Rendez-vous direction</option><option value="RENDEZ_VOUS_LIBRE">Rendez-vous libre</option></select></label>
            <label>Mode<select name="mode" value={mode} onChange={(event) => setMode(event.target.value)} required><option value="TELEPHONE">Téléphone</option><option value="DISTANCIEL_NON_CONNECTE">À distance</option><option value="SUR_SITE">Sur site</option></select></label>
            <label>Date et heure<input type="datetime-local" name="startsAt" defaultValue={defaultStart()} required /></label>
            <label>Durée<select name="durationMinutes" defaultValue="30" required><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 heure</option><option value="90">1 h 30</option><option value="120">2 heures</option></select></label>
          </div>
          {mode === "SUR_SITE" ? <p className="lead-appointment-form__campus"><ShieldCheck size={18} aria-hidden="true" /><span><strong>Campus autorisé</strong>{load.lead.campus}</span></p> : null}
        </fieldset>
        {submit.kind === "error" ? <p className="lead-appointment-form__message lead-appointment-form__message--error" role="alert">{submit.message}</p> : null}
        {submit.kind === "success" ? <section className="lead-appointment-form__success" role="status"><CheckCircle size={22} weight="fill" aria-hidden="true" /><div><strong>Rendez-vous enregistré dans le CRM.</strong><p>Il est maintenant visible dans l’agenda persistant.</p><div><Link href={`/appointments/${encodeURIComponent(submit.appointmentId)}`}>Ouvrir le rendez-vous</Link><Link href="/appointments?view=table">Voir tous les rendez-vous</Link></div></div></section> : null}
        <footer><Link className="text-button" href={`/leads/${encodeURIComponent(leadId)}`}>Annuler</Link><button className="primary-button" type="submit" disabled={submit.kind === "saving" || submit.kind === "success"}>{submit.kind === "saving" ? "Enregistrement…" : "Planifier le rendez-vous"}</button></footer>
      </form>
      <aside className="panel lead-appointment-aside"><Clock size={22} aria-hidden="true" /><h2>Repères</h2><dl><div><dt>Heure affichée</dt><dd>Casablanca</dd></div><div><dt>Affectation</dt><dd>{load.lead.assignedToId ? "Conseiller du Lead" : "Organisateur autorisé"}</dd></div><div><dt>Agenda externe</dt><dd>Désactivé</dd></div></dl><p>Aucun email, SMS, WhatsApp, calendrier externe, visioconférence ou appel automatique n’est déclenché.</p></aside>
    </div>
  </main>;
}
