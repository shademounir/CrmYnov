"use client";

import { useState } from "react";

export interface ApiMutationFormProps {
  endpoint: string;
  method?: "POST" | "PUT" | "PATCH";
  submitLabel: string;
  children: React.ReactNode;
  arrayFields?: string[];
}

export function ApiMutationForm({ endpoint, method = "POST", submitLabel, children, arrayFields = [] }: ApiMutationFormProps): React.JSX.Element {
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  async function submit(formData: FormData): Promise<void> {
    setState("submitting");
    const body: Record<string, boolean | string | string[]> = {};
    for (const [key, value] of formData.entries()) {
      const normalized = typeof value === "string" ? value : value.name;
      body[key] = arrayFields.includes(key) ? normalized.split(",").map((item) => item.trim()).filter(Boolean) : normalized === "on" ? true : normalized;
    }
    const response = await fetch(endpoint, { method, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setState(response.ok ? "success" : "error");
  }
  return <form action={submit}>{children}<button disabled={state === "submitting"} type="submit">{state === "submitting" ? "Enregistrement…" : submitLabel}</button>{state === "success" ? <p role="status">Enregistrement confirmé par l’API.</p> : null}{state === "error" ? <p role="alert">Opération refusée. Aucune modification locale supposée.</p> : null}</form>;
}
