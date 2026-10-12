import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./information.module.css";

export default function InformationLayout({ children }: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return <div className={styles.page}>
    <header className={styles.header}><Link href="/about" className={styles.brand}>CRM Ynov <span>Usage interne</span></Link><Link href="/">Connexion sécurisée</Link></header>
    <nav aria-label="Informations publiques"><Link href="/about">Présentation</Link><Link href="/privacy">Confidentialité</Link><Link href="/terms">Conditions d’utilisation</Link></nav>
    <main id="information-content">{children}</main>
    <footer><p>Support CRM : <a href="mailto:casablancaynovcampus@gmail.com">casablancaynovcampus@gmail.com</a></p><p>Ces pages ne donnent aucun accès aux dossiers, comptes ou données métier.</p></footer>
  </div>;
}
