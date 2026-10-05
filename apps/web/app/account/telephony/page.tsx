import React from "react";
import { PageHeader } from "../../_components/ui/page-header";
import { OwnTelephony } from "./own-telephony";

export default function OwnTelephonyPage(): React.JSX.Element {
  return <main className="own-telephony-page">
    <PageHeader eyebrow="Mon compte · Téléphonie" title="Mon poste d’appel" description="Retrouvez votre extension et l’état observé de votre agent Windows. Votre configuration audio et votre secret SIP restent sur votre poste." />
    <OwnTelephony />
  </main>;
}
