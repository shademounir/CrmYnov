import { Suspense, type ReactNode } from "react";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import { AppShell } from "./_components/app-shell";
import "./styles.css";
import "./ynov-v2.css";
import "./references.css";
import "./leads/shared-views.css";
import "./leads/lead-creation-pilot.css";
import "./leads/lead-profile.css";
import "./manager/reports/commercial-funnel/pipeline-pilot.css";
import "./notifications/notifications.css";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return <html lang="fr"><body><Suspense fallback={children}><AppShell>{children}</AppShell></Suspense></body></html>;
}
