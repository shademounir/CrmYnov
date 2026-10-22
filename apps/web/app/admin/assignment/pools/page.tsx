import Link from "next/link";
import { PoolEditor } from "./pool-editor";
import "./pools.css";

export default function PoolAdministrationPage(): React.JSX.Element {
  return <main className="pool-admin-page"><p>ADMINISTRATION · NOUVEAUX ENTRANTS</p><h1>Pools et routage d’acquisition</h1>
    <p>Choisissez explicitement les conseillers et les campagnes du campus. Les noms proviennent des profils CRM actuellement autorisés ; aucun annuaire administratif général n’est ouvert.</p>
    <nav aria-label="Administration des affectations"><Link href="/admin/assignment">Automatisation par campus</Link> · <Link href="/manager/assignment">File et suivi des affectations</Link> · <Link href="/admin/references">Campus et campagnes</Link></nav>
    <PoolEditor /></main>;
}
