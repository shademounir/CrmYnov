"use client";
import { MagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
import { useState } from "react";
import { StatusBadge } from "../../_components/ui/status-badge";
import { lockReason, moduleLabel, offeredScopes, permissionLabel, scopeLabels, type Configuration, type Definition, type Scope } from "./permission-types";

export function PermissionEditor({ items, configuration, grants, editable, busy, onChange }: { items: Definition[]; configuration: Configuration; grants: Record<string, Scope>; editable: boolean; busy: boolean; onChange: (key: string, value: Scope) => void }): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [module, setModule] = useState("");
  const filtered = items.filter((item) => (!module || item.module === module) && `${permissionLabel(item.key)} ${moduleLabel(item.module)}`.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")));
  const groups = [...new Set(filtered.map((item) => item.module))];
  return <section className="panel permission-editor" aria-labelledby="permission-catalogue-title" aria-busy={busy}>
    <div className="permission-section-heading"><div><p className="eyebrow">Capacités du rôle</p><h2 id="permission-catalogue-title">Configurer les permissions</h2><p>Les valeurs ci-dessous constituent le brouillon local. Elles ne prennent effet qu’après enregistrement.</p></div><StatusBadge tone="neutral">{`${filtered.length} / ${items.length} capacités`}</StatusBadge></div>
    <div className="permission-toolbar permission-filters"><label>Rechercher une capacité<div className="permission-search"><MagnifyingGlass size={18} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ex. Pilotage, affectation, export…" type="search" /></div></label><label>Fonction<select value={module} onChange={(event) => setModule(event.target.value)}><option value="">Toutes les fonctions</option>{[...new Set(items.map((item) => item.module))].map((key) => <option key={key} value={key}>{moduleLabel(key)}</option>)}</select></label></div>
    <p className="permission-help">{configuration.inherited ? "Droits standards du rôle" : `Configuration enregistrée · version ${configuration.version}`} · Les protections métier restent obligatoires. Le serveur vérifie aussi les plafonds et votre autorité d’administration.</p>
    {configuration.role === "AUDITOR" ? <p className="permission-notice">Lecteur : les permissions de mutation sont structurellement non attribuables.</p> : null}
    {!filtered.length ? <div className="permission-empty"><SlidersHorizontal size={24} aria-hidden="true" /><h3>Aucune permission correspondant à la recherche.</h3><p>Essayez un autre terme ou choisissez toutes les fonctions.</p><button className="secondary-button" type="button" onClick={() => { setSearch(""); setModule(""); }}>Effacer les filtres</button></div> : null}
    <div className="permission-groups">{groups.map((group) => {
      const definitions = filtered.filter((item) => item.module === group);
      return <section className="permission-module" key={group} aria-labelledby={`permission-module-${group}`}><div className="permission-module-heading"><h3 id={`permission-module-${group}`}>{moduleLabel(group)}</h3><span>{definitions.filter((item) => (grants[item.key] ?? "NONE") !== "NONE").length} / {definitions.length} attribuées dans le brouillon</span></div>
        <ul className="permission-list">{definitions.map((item) => {
          const restriction = lockReason(item, configuration, editable), locked = restriction !== null;
          const value = grants[item.key] ?? "NONE", saved = configuration.grants[item.key] ?? "NONE", changed = value !== saved;
          const id = `permission-${item.key.replaceAll(".", "-")}`;
          return <li key={item.key} className={changed ? "permission-row is-changed" : "permission-row"}>
            <div className="permission-row-copy"><div className="permission-row-title"><strong>{permissionLabel(item.key)}</strong>{changed ? <StatusBadge tone="warning">Modifié</StatusBadge> : null}</div><p className="permission-row-kind">{item.sensitive ? "Action sensible" : item.mutation ? "Modification" : "Consultation"}{locked ? " · Lecture seule / protégé" : " · Configurable"}</p><p id={`${id}-help`} className="permission-help">{restriction ?? `Plafond global : ${scopeLabels[configuration.globalCeiling[item.key] ?? "NONE"]}`}</p>{changed ? <p className="permission-saved">Enregistré : {scopeLabels[saved]}</p> : null}</div>
            <label className="permission-switch"><input type="checkbox" role="switch" aria-label={`Activer cette capacité : ${permissionLabel(item.key)}`} aria-describedby={`${id}-help`} checked={value !== "NONE"} disabled={busy || locked} onChange={(event) => onChange(item.key, event.target.checked ? offeredScopes(item, configuration.campus).find((scope) => scope !== "NONE") ?? "NONE" : "NONE")} /><span className="permission-switch-track" aria-hidden="true" /><span>{value === "NONE" ? "Désactivée" : "Activée"}</span></label>
            <label className="permission-scope" htmlFor={`${id}-scope`}>Périmètre<select id={`${id}-scope`} value={value} aria-describedby={`${id}-help`} disabled={busy || locked} onChange={(event) => onChange(item.key, event.target.value as Scope)}>{offeredScopes(item, configuration.campus).map((scope) => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></label>
          </li>;
        })}</ul>
      </section>;
    })}</div>
  </section>;
}
