"use client";

import { useEffect, useState } from "react";

export function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

export default function DashboardReturnLink(): React.JSX.Element | null {
  const [href, setHref] = useState<string>();
  useEffect(() => {
    const candidate = new URLSearchParams(window.location.search).get("returnTo");
    const hasControl = candidate ? containsControlCharacter(candidate) : false;
    if (candidate?.startsWith("/manager/reports/dashboard?") && !candidate.includes("//") && !hasControl) setHref(candidate);
  }, []);
  return href ? <p><a href={href}>Retour au dashboard avec les filtres conservés</a></p> : null;
}
