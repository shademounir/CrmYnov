import type { BusinessMailType, PreparedBusinessMail } from "./business-mail-policy.js";

const wording: Record<BusinessMailType, { subject: string; action: string }> = {
  FOLLOW_UP_DUE: { subject: "Relance arrivée à échéance", action: "Consultez le dossier et réalisez la prochaine action prévue, puis renseignez son résultat dans le CRM." },
  FOLLOW_UP_OVERDUE: { subject: "Relance en retard", action: "Une relance reste non réalisée. Vérifiez la situation et renseignez l’action réellement effectuée, sans clôture automatique du dossier." },
  FIRST_TREATMENT_OVERDUE: { subject: "Premier traitement attendu depuis plus de 24 heures", action: "Prenez en charge cette nouvelle demande et enregistrez son premier traitement dans le CRM." },
  CONFIRMATION_EXPECTED: { subject: "Confirmation de rendez-vous attendue", action: "Une échéance de confirmation enregistrée est dépassée. Consultez la demande et prenez la décision autorisée dans le CRM." },
  RETURN_EXPECTED: { subject: "Retour de rendez-vous attendu", action: "Renseignez l’issue réelle du rendez-vous. L’absence de retour ne signifie ni absence du candidat ni entretien réalisé." },
};
const escapeHtml = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** Minimized fixture-renderable content only: no MIME, OAuth, provider call or automatic sending. */
export function renderBusinessMail(message: PreparedBusinessMail, configuredOrigin: string): { subject: string; text: string; html: string } {
  const origin = new URL(configuredOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
    || origin.origin !== configuredOrigin.replace(/\/$/, "")) throw new Error("business_mail_origin_invalid");
  if (!Object.hasOwn(wording, message.type) || !/^LD-[A-Z0-9-]{1,40}$/.test(message.leadReference)) throw new Error("business_mail_template_invalid");
  const deadline = new Date(message.deadline); const at = new Date(message.generatedAt);
  if (!Number.isFinite(deadline.valueOf()) || !Number.isFinite(at.valueOf()) || at < deadline) throw new Error("business_mail_date_invalid");
  const content = wording[message.type];
  const formatted = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", timeStyle: "short" }).format(deadline);
  const delayMinutes = Math.floor((at.valueOf() - deadline.valueOf()) / 60_000);
  // Link opens the authenticated CRM entry point. No token, prospect contact or interview prose.
  const link = origin.origin + "/leads";
  const subject = `[CRM Ynov] ${content.subject} — ${message.leadReference}`;
  const lines = ["Bonjour,", "", `${content.subject} : ${message.leadReference}.`, `Échéance : ${formatted} (Africa/Casablanca).`,
    `Retard observé : ${delayMinutes} minute(s).`, "", content.action, "", `Ouvrir le CRM (connexion requise) : ${link}`,
    "Recherchez la référence du dossier dans votre périmètre autorisé.", "", "Ce message interne ne vaut ni réalisation de l’action ni décision commerciale.", "CRM Ynov"];
  return { subject, text: lines.join("\n"), html: lines.map(line => line ? `<p>${escapeHtml(line)}</p>` : "").join("\n") };
}
