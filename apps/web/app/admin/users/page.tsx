import { UsersConsole } from "./users-console";

export default function UsersPage(): React.JSX.Element { return <main className="users-page"><header><p>ADMINISTRATION · ACCÈS</p><h1>Utilisateurs et autorisations</h1><span>Créez un compte, définissez son périmètre puis remettez son accès temporaire.</span></header><UsersConsole /></main>; }
