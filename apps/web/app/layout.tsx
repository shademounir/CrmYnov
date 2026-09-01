import type { ReactNode } from "react";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import { AppShell } from "./_components/app-shell";
import "./styles.css";
import "./ynov-v2.css";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return <html lang="fr"><body><AppShell>{children}</AppShell></body></html>;
}
