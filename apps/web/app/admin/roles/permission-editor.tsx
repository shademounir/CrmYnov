"use client";
import { useState } from "react";
import { isLocked, offeredScopes, scopeLabels, type Configuration, type Definition, type Scope } from "./permission-types";
export function PermissionEditor({ items, configuration, grants, editable, busy, onChange }: { items: Definition[]; configuration: Configuration; grants: Record<string, Scope>; editable: boolean; busy: boolean; onChange: (key: string, value: Scope) => void }): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [module, setModule] = useState("");
  const filtered = items.filter((item) => (!module || item.module === module) && item.key.toLowerCase().includes(search.toLowerCase()));
  return <section className="panel permission-editor" aria-label="Catalogue des permissions" aria-busy={busy}>
    <div className="permission-toolbar"><label>Rechercher une permission<input value={search} onChange={(event) => setSearch(event.target.value)} type="search" /></label><label>Module<select value={module} onChange={(event) => setModule(event.target.value)}><option value="">Tous les modules</option>{[...new Set(items.map((item) => item.module))].map((key) => <option key={key}>{key}</option>)}</select></label></div>
    <p>{filtered.length} permissions · {configuration.inherited ? "Configuration héritée du registre v1" : `Configuration explicite v${configuration.version}`}. Les protections métier restent obligatoires.</p>
    {configuration.role === "AUDITOR" ? <p>Lecteur : les permissions de mutation sont structurellement non attribuables.</p> : null}
    {!filtered.length ? <p>Aucune permission correspondant à la recherche.</p> : null}
    <ul className="permission-list">{filtered.map((item) => {
      const locked = isLocked(item, configuration, editable), value = grants[item.key] ?? "NONE";
      return <li key={item.key}><div><strong>{item.key}</strong><p>{item.sensitive ? "Sensible · " : "Consultation · "}{locked ? "Protection obligatoire / non modifiable" : "Configurable"}</p><p>Plafond global : {scopeLabels[configuration.globalCeiling[item.key] ?? "NONE"]}</p></div>
        {item.available === false ? <p>Action non encore exposée ; permission non attribuable.</p> : null}
        <label className="permission-toggle"><input type="checkbox" role="switch" checked={value !== "NONE"} disabled={busy || locked} onChange={(event) => onChange(item.key, event.target.checked ? offeredScopes(item, configuration.campus).find((scope) => scope !== "NONE") ?? "NONE" : "NONE")} />Activer {item.key}</label>
        <label>Portée de {item.key}<select value={value} disabled={busy || locked} onChange={(event) => onChange(item.key, event.target.value as Scope)}>{offeredScopes(item, configuration.campus).map((scope) => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></label></li>;
    })}</ul>
  </section>;
}
