"use client";

import { useEffect, useRef, useState } from "react";

const GENERIC_MESSAGE = "La demande a été prise en compte. Si le compte est éligible, vous pourrez recevoir un lien personnel. La réception du message n’est pas confirmée.";
const UNCONFIRMED_MESSAGE = "La demande n’a pas pu être confirmée. Vérifiez votre messagerie avant de réessayer.";

export function RecoveryForm(): React.JSX.Element {
  const [feedback, setFeedback] = useState<{ kind: "accepted" | "error"; message: string }>();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);

  useEffect(() => { mounted.current = true; return (): void => { mounted.current = false; activeRequest.current?.abort(); }; }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFeedback(undefined);
    const data = new FormData(event.currentTarget);
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/crm/access-recovery/requests", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), returnPath: "/access-recovery/complete" }),
        signal: controller.signal,
      });
      if (!mounted.current) return;
      setFeedback(response.status === 202
        ? { kind: "accepted", message: GENERIC_MESSAGE }
        : { kind: "error", message: response.status === 429 ? "Trop de demandes. Patientez avant de réessayer." : UNCONFIRMED_MESSAGE });
    } catch {
      if (mounted.current) setFeedback({ kind: "error", message: UNCONFIRMED_MESSAGE });
    } finally {
      globalThis.clearTimeout(timeout);
      activeRequest.current = undefined;
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form method="post" onSubmit={(event) => { void submit(event); }} aria-label="Demander la récupération de mon accès" aria-describedby="recovery-guidance">
      <label htmlFor="recovery-email">Adresse professionnelle</label>
      <input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={pending} />
      <p id="recovery-guidance" className="muted">La réponse reste identique, que le compte existe ou non. Le traitement peut prendre quelques secondes.</p>
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "Demande en cours…" : "Demander la récupération"}</button>
      {feedback?.kind === "accepted" ? <p role="status">{feedback.message}</p> : null}
      {feedback?.kind === "error" ? <p className="field-error" role="alert">{feedback.message}</p> : null}
    </form>
  );
}

export { GENERIC_MESSAGE };
