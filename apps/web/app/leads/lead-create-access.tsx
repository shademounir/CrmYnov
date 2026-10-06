"use client";

import React, { useEffect, useState } from "react";
import { LeadCreationDrawer } from "./lead-creation";

/** A role name is not a creation permission. Only the current server decision enables the action. */
export function LeadCreateAccess(): React.JSX.Element | null {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setAllowed(false);
    void fetch("/api/crm/reports/dashboard/capabilities", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return undefined;
        return await response.json() as { canCreateLead?: unknown };
      }).then((value) => { if (!controller.signal.aborted) setAllowed(value?.canCreateLead === true); })
      .catch(() => { if (!controller.signal.aborted) setAllowed(false); });
    return (): void => controller.abort();
  }, []);
  return allowed ? <LeadCreationDrawer /> : null;
}
