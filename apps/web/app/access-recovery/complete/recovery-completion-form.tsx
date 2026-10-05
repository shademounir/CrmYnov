"use client";

import { useEffect, useRef, useState } from "react";

type State = "loading" | "ready" | "saving" | "invalid" | "unavailable" | "complete";
const LINK_MESSAGE = "Ce lien n’est pas valide ou n’est plus utilisable. Demandez un nouveau lien de récupération.";

export function RecoveryCompletionForm(): React.JSX.Element {
  const [state, setState] = useState<State>("loading");
  const [inputError, setInputError] = useState(false);
  const token = useRef("");
  const initialized = useRef(false);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const activeRequest = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    if (!initialized.current) {
      initialized.current = true;
      const fragment = globalThis.location.hash;
      // Remove both fragment and any untrusted query before parsing the secret.
      globalThis.history.replaceState(null, "", "/access-recovery/complete");
      const values = new URLSearchParams(fragment.slice(1)).getAll("token");
      const candidate = values.length === 1 ? values[0] ?? "" : "";
      token.current = /^[A-Za-z0-9_-]{43}$/u.test(candidate) ? candidate : "";
      setState(token.current ? "ready" : "invalid");
    }
    return (): void => { mounted.current = false; activeRequest.current?.abort(); };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current || !token.current || state === "complete") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const secret = data.get("nextSecret");
    if (typeof secret !== "string" || secret !== data.get("confirmation") || secret.length < 14 || secret.length > 128 || /\s/u.test(secret) || !/[A-Z]/u.test(secret) || !/[a-z]/u.test(secret) || !/\d/u.test(secret) || !/[^A-Za-z0-9]/u.test(secret)) {
      setInputError(true); return;
    }
    submitting.current = true;
    setInputError(false);
    setState("saving");
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/crm/access-recovery/completions", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.current, returnPath: "/access-recovery/complete", nextSecret: secret }),
      });
      if (!mounted.current) return;
      if (response.status === 204) {
        token.current = ""; form.reset(); setState("complete"); return;
      }
      const body = await response.json().catch(() => ({})) as { code?: string };
      if (!mounted.current) return;
      if (body.code === "recovery_challenge_invalid") {
        token.current = ""; form.reset(); setState("invalid"); return;
      }
      if (body.code === "recovery_completion_invalid") { setInputError(true); setState("ready"); return; }
      setState("unavailable");
    } catch {
      if (mounted.current) setState("unavailable");
    } finally {
      globalThis.clearTimeout(timeout);
      activeRequest.current = undefined;
      submitting.current = false;
    }
  }

  return <>
    {state === "loading" ? <p role="status">Vérification du lien…</p> : null}
    {state === "complete" ? <p role="status">Mot de passe enregistré. Les anciennes sessions ont été révoquées. <a href="/">Se connecter</a></p> : null}
    {state === "invalid" ? <><p className="field-error" role="alert">{LINK_MESSAGE}</p><a href="/access-recovery">Demander un nouveau lien</a></> : null}
    {["ready", "saving", "unavailable"].includes(state) ? <form method="post" aria-label="Définir mon nouveau mot de passe" aria-describedby="recovery-secret-policy" onSubmit={(event) => { void submit(event); }}>
      <label htmlFor="recovery-secret">Nouveau mot de passe<input id="recovery-secret" name="nextSecret" type="password" autoComplete="new-password" minLength={14} maxLength={128} required disabled={state === "saving"} /></label>
      <label htmlFor="recovery-confirmation">Confirmer le mot de passe<input id="recovery-confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={14} maxLength={128} required disabled={state === "saving"} /></label>
      <p id="recovery-secret-policy" className="muted">14 à 128 caractères, avec majuscule, minuscule, chiffre et symbole, sans espace.</p>
      {inputError ? <p className="field-error" role="alert">Vérifiez la conformité du mot de passe et l’égalité des deux saisies.</p> : null}
      {state === "unavailable" ? <p className="field-error" role="alert">L’enregistrement n’a pas pu être confirmé. Essayez de vous connecter avant de réutiliser ce lien ; aucun nouvel envoi n’a été déclenché.</p> : null}
      <button className="primary-button" type="submit" disabled={state === "saving"}>{state === "saving" ? "Enregistrement…" : "Enregistrer le mot de passe"}</button>
    </form> : null}
    {state !== "complete" ? <p><a href="/">Revenir à la connexion</a></p> : null}
  </>;
}
