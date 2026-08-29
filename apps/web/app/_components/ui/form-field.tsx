import type { ReactElement } from "react";
import { cloneElement } from "react";

type FieldElement = ReactElement<{
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" | undefined;
}>;

export function FormField({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: FieldElement }): React.JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const fieldProps = { id, "aria-invalid": Boolean(error), ...(describedBy ? { "aria-describedby": describedBy } : {}) };
  return <label className="ui-field" htmlFor={id}><span>{label}</span>{cloneElement(children, fieldProps)}{hint ? <span className="ui-field__hint" id={hintId}>{hint}</span> : null}{error ? <span className="ui-field__error" id={errorId}>{error}</span> : null}</label>;
}
