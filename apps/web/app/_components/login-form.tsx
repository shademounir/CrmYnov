"use client";

import { Eye, EyeSlash, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { withSessionDeadline } from "./session-deadline";

const authenticationPaths = new Set(["/", "/access-recovery", "/access-recovery/complete", "/first-login", "/invitation"]);

export function loginRedirectPath(search = ""): string {
  const candidate = new URLSearchParams(search).get("returnTo");
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || Array.from(candidate).some((character) => (character.codePointAt(0) ?? 0) < 32)) return "/leads";
  try {
    const target = new URL(candidate, "https://crm.invalid");
    if (target.origin !== "https://crm.invalid" || authenticationPaths.has(target.pathname) || target.pathname.startsWith("/api/")) return "/leads";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/leads";
  }
}

export function LoginForm(): React.JSX.Element {
  const [state, setState] = useState<"idle" | "submitting" | "error" | "uncertain" | "checking" | "authenticated">("idle");
  const [resumePath, setResumePath] = useState("/leads");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const submitting = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const localEmail = process.env.NODE_ENV !== "production" ? process.env.NEXT_PUBLIC_LOCAL_SEED_EMAIL ?? "" : "";
  useEffect(() => { setSessionExpired(new URLSearchParams(globalThis.location.search).get("reason") === "session-expired"); }, []);
  useEffect(() => (): void => { pending.current?.abort(); pending.current = null; }, []);
  function resume(mustChangeSecret: boolean): void {
    const path = mustChangeSecret ? "/first-login" : loginRedirectPath(globalThis.location.search);
    setResumePath(path);
    setState("authenticated");
    globalThis.location.assign(path);
  }
  async function checkSession(): Promise<void> {
    if (submitting.current) return;
    submitting.current = true;
    const controller = new AbortController();
    pending.current = controller;
    setState("checking");
    try {
      const result = await withSessionDeadline(async (signal) => {
        const response = await fetch("/api/crm/sessions/current", { credentials: "same-origin", cache: "no-store", signal });
        return { status: response.status, ok: response.ok, session: response.ok ? await response.json() as { mustChangeSecret?: boolean } : null };
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok && result.session && typeof result.session.mustChangeSecret === "boolean") resume(result.session.mustChangeSecret);
      else setState(result.status === 401 ? "error" : "uncertain");
    } catch { if (!controller.signal.aborted) setState("uncertain"); }
    finally { if (pending.current === controller) { pending.current = null; submitting.current = false; } }
  }
  async function submit(formData: FormData): Promise<void> {
    if (submitting.current || state === "uncertain" || state === "checking" || state === "authenticated") return;
    submitting.current = true;
    const controller = new AbortController();
    pending.current = controller;
    setState("submitting");
    try {
      const result = await withSessionDeadline(async (signal) => {
        const response = await fetch("/api/crm/sessions", { method: "POST", credentials: "same-origin", cache: "no-store", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }) });
        return { ok: response.ok, session: response.ok ? await response.json() as { mustChangeSecret?: boolean } : null };
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) { setState("error"); return; }
      if (!result.session || typeof result.session.mustChangeSecret !== "boolean") { setState("uncertain"); return; }
      resume(result.session.mustChangeSecret);
    } catch {
      if (!controller.signal.aborted) setState("uncertain");
    } finally {
      if (pending.current === controller) { pending.current = null; submitting.current = false; }
    }
  }
  return <form method="post" onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} aria-label="Connexion locale">
    {sessionExpired ? <p className="session-expired-note" role="status"><WarningCircle size={18} weight="fill" /> Votre session a expiré. Reconnectez-vous pour reprendre exactement où vous étiez.</p> : null}
    <label>Email professionnel<input name="email" type="email" autoComplete="username" defaultValue={localEmail} required /></label>
    <label>Mot de passe<span className="password-field"><input name="password" type={passwordVisible ? "text" : "password"} autoComplete="current-password" onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))} onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))} required /><button type="button" className="password-toggle" onClick={() => setPasswordVisible((value) => !value)} aria-label={passwordVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}>{passwordVisible ? <EyeSlash size={20} /> : <Eye size={20} />}</button></span></label>
    {capsLock ? <p className="caps-lock-note" role="status"><WarningCircle size={17} weight="fill" /> Verr. Maj. est activé</p> : null}
    <button className="primary-button" disabled={["submitting", "uncertain", "checking", "authenticated"].includes(state)} type="submit">{state === "submitting" ? "Connexion…" : "Se connecter"}</button>
    {state === "uncertain" || state === "checking" ? <section role="status"><p>La réponse de connexion n’est pas confirmée. Vérifiez votre session avant de renvoyer vos identifiants.</p><button type="button" disabled={state === "checking"} onClick={() => { void checkSession(); }}>{state === "checking" ? "Vérification de la session…" : "Vérifier ma session"}</button></section> : null}
    {state === "authenticated" ? <p role="status">Connexion confirmée. <a href={resumePath}>Ouvrir mon espace CRM</a> si la navigation tarde.</p> : null}
    {state === "error" ? <p className="field-error" role="alert"><WarningCircle size={18} weight="fill" /> Identifiants refusés ou service indisponible.</p> : null}
    <p><a href="/access-recovery">Mot de passe oublié ?</a></p>
  </form>;
}
