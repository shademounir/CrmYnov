"use client";
import Link from "next/link";
import { CalendarBlank } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { admissionsRequest, type AdmissionsContext } from "./admissions-client";

/** Presentation follows current server grants; the API still enforces every command. */
export function AdmissionsAgendaLink({ label = "Mon agenda Admissions" }: Readonly<{ label?: string }>): React.JSX.Element | null {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => { const controller = new AbortController(); void admissionsRequest<AdmissionsContext>("/admissions/context", { signal: controller.signal }).then((context) => { if (!controller.signal.aborted) setAllowed(context.canUseAgenda === true); }).catch(() => { if (!controller.signal.aborted) setAllowed(false); }); return (): void => controller.abort(); }, []);
  return allowed ? <Link className="secondary-button" href="/appointments/admissions"><CalendarBlank size={19} aria-hidden="true" /> {label}</Link> : null;
}
