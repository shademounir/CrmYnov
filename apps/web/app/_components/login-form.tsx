"use client";

import { useState } from "react";

export function LoginForm(): React.JSX.Element {
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  async function submit(formData: FormData): Promise<void> {
    setState("submitting");
    const response = await fetch("/api/crm/sessions", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }) });
    if (!response.ok) { setState("error"); return; }
    globalThis.location.assign("/leads");
  }
  return <form action={submit} aria-label="Connexion locale"><label>Email professionnel<input name="email" type="email" autoComplete="username" required /></label><label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label><button disabled={state === "submitting"} type="submit">{state === "submitting" ? "Connexion…" : "Se connecter"}</button>{state === "error" ? <p role="alert">Identifiants refusés ou API locale indisponible.</p> : null}</form>;
}
