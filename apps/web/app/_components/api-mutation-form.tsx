"use client";

import { useState } from "react";

export interface ApiMutationFormProps {
  endpoint: string;
  method?: "POST" | "PUT" | "PATCH";
  submitLabel: string;
  children: React.ReactNode;
  arrayFields?: string[];
}

export function mutationBody(formData: FormData, arrayFields: readonly string[]): Record<string, boolean | string | string[]> {
  const body: Record<string, boolean | string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    const normalized = typeof value === "string" ? value : value.name;
    if (arrayFields.includes(key)) body[key] = normalized.split(",").map((item) => item.trim()).filter(Boolean);
    else body[key] = normalized === "on" ? true : normalized;
  }
  return body;
}

export function ApiMutationForm({ endpoint, method = "POST", submitLabel, children, arrayFields = [] }: Readonly<ApiMutationFormProps>): React.JSX.Element {
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  async function submit(formData: FormData): Promise<void> {
    setState("submitting");
    const body = mutationBody(formData, arrayFields);
    const response = await fetch(endpoint, { method, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setState(response.ok ? "success" : "error");
  }
  return <form action={submit}>{children}<button disabled={state === "submitting"} type="submit">{state === "submitting" ? "Enregistrement…" : submitLabel}</button>{state === "success" ? <output>Enregistrement confirmé par l’API.</output> : null}{state === "error" ? <p role="alert">Opération refusée. Aucune modification locale supposée.</p> : null}</form>;
}
