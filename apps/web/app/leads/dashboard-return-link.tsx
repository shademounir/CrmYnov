"use client";

import { useEffect, useState } from "react";

export default function DashboardReturnLink(): React.JSX.Element | null {
  const [href, setHref] = useState<string>();
  useEffect(() => {
    const candidate = new URLSearchParams(window.location.search).get("returnTo");
    const hasControl = candidate ? [...candidate].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    }) : false;
    if (candidate?.startsWith("/manager/reports/dashboard?") && !candidate.includes("//") && !hasControl) setHref(candidate);
  }, []);
  return href ? <p><a href={href}>Retour au dashboard avec les filtres conservés</a></p> : null;
}
