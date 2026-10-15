"use client";

import { Eye, EyeSlash, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

const authenticationPaths = new Set(["/", "/access-recovery", "/access-recovery/complete", "/first-login", "/invitation"]);

export function loginRedirectPath(search = ""): string {
  const candidate = new URLSearchParams(search).get("returnTo");
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\u0000-\u001f]/u.test(candidate)) return "/leads";
  try {
    const target = new URL(candidate, "https://crm.invalid");
    if (target.origin !== "https://crm.invalid" || authenticationPaths.has(target.pathname) || target.pathname.startsWith("/api/")) return "/leads";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/leads";
  }
}

export function LoginForm(): React.JSX.Element {
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const submitting = useRef(false);
  const localEmail = process.env.NODE_ENV !== "production" ? process.env.NEXT_PUBLIC_LOCAL_SEED_EMAIL ?? "" : "";
  useEffect(() => { setSessionExpired(new URLSearchParams(globalThis.location.search).get("reason") === "session-expired"); }, []);
  async function submit(formData: FormData): Promise<void> {
    if (submitting.current) return;
    submitting.current = true;
    setState("submitting");
    try {
      const response = await fetch("/api/crm/sessions", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }) });
      if (!response.ok) { setState("error"); return; }
      const session = await response.json() as { mustChangeSecret?: boolean };
      globalThis.location.assign(session.mustChangeSecret === true ? "/first-login" : loginRedirectPath(globalThis.location.search));
    } catch {
      setState("error");
    } finally {
      submitting.current = false;
    }
  }
  return <form method="post" onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} aria-label="Connexion locale">
    {sessionExpired ? <p className="session-expired-note" role="status"><WarningCircle size={18} weight="fill" /> Votre session a expiré. Reconnectez-vous pour reprendre exactement où vous étiez.</p> : null}
    <label>Email professionnel<input name="email" type="email" autoComplete="username" defaultValue={localEmail} required /></label>
    <label>Mot de passe<span className="password-field"><input name="password" type={passwordVisible ? "text" : "password"} autoComplete="current-password" onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))} onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))} required /><button type="button" className="password-toggle" onClick={() => setPasswordVisible((value) => !value)} aria-label={passwordVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}>{passwordVisible ? <EyeSlash size={20} /> : <Eye size={20} />}</button></span></label>
    {capsLock ? <p className="caps-lock-note" role="status"><WarningCircle size={17} weight="fill" /> Verr. Maj. est activé</p> : null}
    <button className="primary-button" disabled={state === "submitting"} type="submit">{state === "submitting" ? "Connexion…" : "Se connecter"}</button>
    {state === "error" ? <p className="field-error" role="alert"><WarningCircle size={18} weight="fill" /> Identifiants refusés ou service indisponible.</p> : null}
    <p><a href="/access-recovery">Mot de passe oublié ?</a></p>
  </form>;
}
