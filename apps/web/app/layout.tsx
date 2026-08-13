import type { ReactNode } from "react";
import "./styles.css";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return <html lang="fr"><body>{children}</body></html>;
}
