"use client";

import { useEffect, useState } from "react";

export type ApiValue = null | boolean | number | string | ApiValue[] | { [key: string]: ApiValue };
export type ApiObject = { [key: string]: ApiValue };

export interface ResourceField { key: string; label: string }
export interface ConnectedResourceProps {
  endpoint: string;
  fields: ResourceField[];
  itemPathPrefix?: string;
  itemPathKey?: string;
  emptyMessage: string;
  ariaLabel: string;
}

export function resourceObjects(payload: ApiValue): ApiObject[] {
  if (Array.isArray(payload)) return payload.filter((item): item is ApiObject => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  for (const key of ["items", "events", "users", "conversations"]) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) return candidate.filter((item): item is ApiObject => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  return [payload];
}

export function displayApiValue(value: ApiValue | undefined): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "Donnée structurée";
}

export function apiString(item: ApiObject, key: string, fallback = ""): string {
  const value = item[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

export function ConnectedResource({ endpoint, fields, itemPathPrefix, itemPathKey = "id", emptyMessage, ariaLabel }: Readonly<ConnectedResourceProps>): React.JSX.Element {
  const [state, setState] = useState<{ kind: "loading" | "ready" | "empty" | "error"; items: ApiObject[] }>({ kind: "loading", items: [] });
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading", items: [] });
    void fetch(endpoint, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`api_${response.status}`);
        const items = resourceObjects(await response.json() as ApiValue);
        setState({ kind: items.length === 0 ? "empty" : "ready", items });
      })
      .catch((error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setState({ kind: "error", items: [] }); });
    return (): void => controller.abort();
  }, [endpoint]);

  if (state.kind === "loading") return <output aria-live="polite">Chargement depuis l’API locale…</output>;
  if (state.kind === "error") return <section role="alert"><h2>Connexion impossible</h2><p>La ressource n’est pas affichée. Vérifiez la session et la disponibilité de l’API locale.</p><button type="button" onClick={() => globalThis.location.reload()}>Réessayer</button></section>;
  if (state.kind === "empty") return <output>{emptyMessage}</output>;
  return <div className="table-scroll"><table aria-label={ariaLabel}><thead><tr>{fields.map((field) => <th key={field.key}>{field.label}</th>)}{itemPathPrefix ? <th>Action</th> : null}</tr></thead><tbody>{state.items.map((item, index) => {
    const key = displayApiValue(item.id ?? item.leadCode ?? index);
    const itemIdentifier = apiString(item, itemPathKey);
    let action: React.JSX.Element | null = null;
    if (itemPathPrefix) action = itemIdentifier ? <td><a href={`${itemPathPrefix}/${encodeURIComponent(itemIdentifier)}`}>Ouvrir</a></td> : <td>—</td>;
    return <tr key={key}>{fields.map((field) => <td key={field.key}>{displayApiValue(item[field.key])}</td>)}{action}</tr>;
  })}</tbody></table></div>;
}
