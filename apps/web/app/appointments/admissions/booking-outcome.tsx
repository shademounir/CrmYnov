import { admissionsDate, type AdmissionsBooking } from "./admissions-client";

const labels: Readonly<Record<string, string>> = {
  DECISION_PENDING: "Décision du responsable attendue", UPCOMING: "Rendez-vous confirmé à venir",
  RETURN_EXPECTED: "Retour attendu", REPORT_EXPECTED: "Rendez-vous tenu · compte rendu attendu",
  REPORTED: "Rendez-vous tenu · résultat enregistré", HELD: "Rendez-vous tenu", ABSENT: "Absence déclarée", CANCELLED: "Rendez-vous annulé",
  RESCHEDULED: "Report proposé · nouvelle décision attendue", REFUSED: "Demande refusée", UNAVAILABLE: "Suivi à actualiser",
};
export function bookingOutcomeLabel(booking: AdmissionsBooking): string {
  const observation = booking.outcomeFollowUp;
  return observation && Number.isFinite(Date.parse(observation.generatedAt)) && Object.hasOwn(labels, observation.status) ? labels[observation.status]! : labels.UNAVAILABLE!;
}
export function AdmissionsBookingOutcome({ booking }: Readonly<{ booking: AdmissionsBooking }>): React.JSX.Element {
  const candidate = booking.outcomeFollowUp;
  const observation = candidate && Number.isFinite(Date.parse(candidate.generatedAt)) && Object.hasOwn(labels, candidate.status) ? candidate : undefined;
  return <section className="admissions-notice" aria-label="Suivi du rendez-vous"><h3>{bookingOutcomeLabel(booking)}</h3>
    {observation?.status === "RETURN_EXPECTED" ? <p>La fin prévue est atteinte. Le responsable habilité doit renseigner le résultat réellement observé. Sans saisie, aucune absence ni réalisation n’est déduite.</p> : null}
    {observation?.status === "REPORT_EXPECTED" ? <p>La présence a été déclarée ; le compte rendu reste à renseigner par l’évaluateur habilité.</p> : null}
    {observation?.status === "ABSENT" ? <p>L’absence a été déclarée explicitement. Elle ne clôture pas automatiquement le dossier commercial.</p> : null}
    {observation && Number.isFinite(Date.parse(observation.generatedAt)) ? <p>Observation serveur : {admissionsDate(observation.generatedAt)} · Casablanca. Actualisez pour relire le suivi ; il ne s’agit pas d’une décision automatique.</p> : <p>Actualisez la demande pour lire son suivi depuis le serveur.</p>}
  </section>;
}
