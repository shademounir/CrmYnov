import React from "react";
import { PageHeader } from "../../_components/ui/page-header";
import { TelephonyAdmin } from "./telephony-admin";

export default function TelephonyAdminPage(): React.JSX.Element {
  return <main className="telephony-admin-page">
    <PageHeader eyebrow="Administration · Téléphonie" title="Postes d’appel Liblinphone" description="Associez une identité CRM, une extension SIP et un seul poste Windows. Aucun mot de passe SIP ne transite par le CRM." />
    <TelephonyAdmin />
  </main>;
}
