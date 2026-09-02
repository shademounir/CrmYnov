"use client";

import {
  Alarm,
  Bell,
  CalendarBlank,
  CaretDown,
  ChartBar,
  ChatCircleDots,
  Gear,
  GitBranch,
  House,
  List,
  MagnifyingGlass,
  MapPin,
  SidebarSimple,
  UploadSimple,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { apiString, resourceObjects, type ApiValue } from "./connected-resource";

export type SearchState =
  | { kind: "closed"; items: never[] }
  | { kind: "loading"; items: never[] }
  | { kind: "ready"; items: Array<{ id: string; label: string; detail: string }> }
  | { kind: "empty"; items: never[] }
  | { kind: "session" | "forbidden" | "error"; items: never[] };

const authPaths = new Set(["/", "/access-recovery", "/first-login"]);
const navigation = [
  { href: "/manager/reports/dashboard", label: "Vue d’ensemble", icon: House },
  { href: "/leads", label: "Tous les leads", icon: UsersThree },
  { href: "/manager/reports/commercial-funnel", label: "Pipeline", icon: GitBranch },
  { href: "/leads?view=FOLLOW_UP", label: "Relances", icon: Alarm },
  { href: "/appointments", label: "Rendez-vous", icon: CalendarBlank },
  { href: "/imports/wizard", label: "Imports", icon: UploadSimple },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/chat", label: "Chat", icon: ChatCircleDots },
  { href: "/manager/reports/commercial-performance", label: "Rapports", icon: ChartBar },
  { href: "/admin/users", label: "Administration", icon: Gear },
  { href: "/admin/references", label: "Référentiels", icon: Gear },
] as const;

export function isActive(pathname: string, href: string): boolean {
  const route = href.split("?")[0] ?? href;
  if (route === "/leads") return pathname === "/leads";
  if (route === "/manager/reports/dashboard") return pathname === route;
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function searchItems(value: ApiValue): Array<{ id: string; label: string; detail: string }> {
  return resourceObjects(value).map((item) => ({
    id: apiString(item, "id"),
    label: [apiString(item, "firstName"), apiString(item, "lastName")].filter(Boolean).join(" ") || "Lead",
    detail: `${apiString(item, "leadCode", "Sans identifiant")} · ${apiString(item, "program", "Formation non renseignée")}`,
  })).filter((item) => item.id);
}

export async function loadSearchResults(
  query: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<SearchState> {
  const params = new URLSearchParams({ search: query, page: "1", pageSize: "5" });
  const response = await request(`/api/crm/leads?${params.toString()}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
    signal,
  });
  if (response.status === 401) return { kind: "session", items: [] };
  if (response.status === 403) return { kind: "forbidden", items: [] };
  if (!response.ok) return { kind: "error", items: [] };
  const items = searchItems(await response.json() as ApiValue);
  return items.length ? { kind: "ready", items } : { kind: "empty", items: [] };
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return <AppShellClient pathname={usePathname()}>{children}</AppShellClient>;
}

export function AppShellClient({ pathname, children }: Readonly<{ pathname: string; children: ReactNode }>): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "closed", items: [] });
  const isAuthPath = authPaths.has(pathname);

  useEffect(() => {
    setMobileOpen(false);
    setProfileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2 || isAuthPath) {
      setSearch({ kind: "closed", items: [] });
      return;
    }
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => {
      setSearch({ kind: "loading", items: [] });
      void loadSearchResults(normalized, controller.signal).then(setSearch).catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") setSearch({ kind: "error", items: [] });
      });
    }, 250);
    return (): void => { globalThis.clearTimeout(timeout); controller.abort(); };
  }, [isAuthPath, query]);

  if (isAuthPath) return <>{children}</>;

  return <AppShellView
    pathname={pathname}
    collapsed={collapsed}
    mobileOpen={mobileOpen}
    profileOpen={profileOpen}
    query={query}
    search={search}
    onCollapse={() => setCollapsed((value) => !value)}
    onMobileOpen={() => setMobileOpen(true)}
    onMobileClose={() => setMobileOpen(false)}
    onProfileToggle={() => setProfileOpen((value) => !value)}
    onQueryChange={setQuery}
    onSearchSelect={() => setQuery("")}
  >{children}</AppShellView>;
}

type AppShellViewProps = Readonly<{
  children: ReactNode;
  pathname: string;
  collapsed: boolean;
  mobileOpen: boolean;
  profileOpen: boolean;
  query: string;
  search: SearchState;
  onCollapse: () => void;
  onMobileOpen: () => void;
  onMobileClose: () => void;
  onProfileToggle: () => void;
  onQueryChange: (value: string) => void;
  onSearchSelect: () => void;
}>;

export function AppShellView({
  children,
  pathname,
  collapsed,
  mobileOpen,
  profileOpen,
  query,
  search,
  onCollapse,
  onMobileOpen,
  onMobileClose,
  onProfileToggle,
  onQueryChange,
  onSearchSelect,
}: AppShellViewProps): React.JSX.Element {
  const currentLabel = navigation.find((item) => isActive(pathname, item.href))?.label ?? "CRM Admissions";
  return <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
    <aside className={`sidebar ${mobileOpen ? "is-mobile-open" : ""}`} aria-label="Navigation CRM">
      <div className="brand-lockup">
        <Image src="/brand/ynov-campus-maroc.png" alt="Maroc Ynov Campus" width={122} height={69} priority />
        {!collapsed ? <span>CRM Admissions</span> : null}
        <button type="button" className="mobile-close" onClick={onMobileClose} aria-label="Fermer la navigation"><X size={22} /></button>
      </div>
      <SidebarNavigation pathname={pathname} collapsed={collapsed} />
      <Link className="sidebar-profile" href="/admin/users" aria-label="Ouvrir le profil de la session locale">
        <span className="avatar" aria-hidden="true">SL</span>
        {!collapsed ? <span><b>Session locale</b><small>Droits contrôlés par l’API</small></span> : null}
      </Link>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <button type="button" className="icon-button mobile-menu" onClick={onMobileOpen} aria-label="Ouvrir la navigation"><List size={24} /></button>
        <button type="button" className="icon-button collapse-button" onClick={onCollapse} aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}><SidebarSimple size={22} /></button>
        <label className="global-search">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <span className="sr-only">Recherche globale</span>
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Rechercher un lead, identifiant, source…" autoComplete="off" />
          <kbd aria-hidden="true">Ctrl K</kbd>
        </label>
        <div className="topbar-actions">
          <button type="button" className="campus-button" aria-label="Campus sélectionné : Casablanca"><MapPin size={19} aria-hidden="true" /><span>Casablanca</span><CaretDown size={15} aria-hidden="true" /></button>
          <Link className="icon-button" href="/notifications" aria-label="Ouvrir les notifications"><Bell size={22} /><span className="notification-dot" aria-label="Notifications non lues">3</span></Link>
          <div className="popover-anchor">
            <button type="button" className="user-button" onClick={onProfileToggle} aria-expanded={profileOpen} aria-label="Ouvrir le menu de la session locale"><span className="avatar">SL</span><span>Session locale<small>Accès contrôlé</small></span><CaretDown size={15} aria-hidden="true" /></button>
            {profileOpen ? <div className="user-menu" role="menu"><Link href="/admin/users" role="menuitem"><Gear size={18} /> Administration</Link><Link href="/" role="menuitem">Se déconnecter</Link></div> : null}
          </div>
        </div>
      </header>
      <GlobalSearchResults search={search} query={query} onSearchSelect={onSearchSelect} />
      <div className="route-context sr-only" aria-live="polite">Page actuelle : {currentLabel}</div>
      <div className="page-canvas">{children}</div>
    </div>
    {mobileOpen ? <button type="button" className="scrim" onClick={onMobileClose} aria-label="Fermer la navigation" /> : null}
  </div>;
}

function SidebarNavigation({ pathname, collapsed }: Readonly<{ pathname: string; collapsed: boolean }>): React.JSX.Element {
  return <nav aria-label="Navigation principale">
    {navigation.map(({ href, label, icon: Icon }) => {
      const active = isActive(pathname, href);
      return <Link key={`${label}-${href}`} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined}>
        <Icon size={21} weight={active ? "fill" : "regular"} aria-hidden="true" />
        {!collapsed ? <span>{label}</span> : <span className="sr-only">{label}</span>}
      </Link>;
    })}
  </nav>;
}

function GlobalSearchResults({ search, query, onSearchSelect }: Readonly<{ search: SearchState; query: string; onSearchSelect: () => void }>): React.JSX.Element | null {
  if (search.kind === "closed") return null;
  return <section className="search-results" aria-label="Résultats de la recherche globale" aria-live="polite">
    {search.kind === "loading" ? <p>Recherche en cours…</p> : null}
    {search.kind === "ready" ? search.items.map((item) => <Link key={item.id} href={`/leads/${encodeURIComponent(item.id)}`} onClick={onSearchSelect}><MagnifyingGlass size={17} /><span><b>{item.label}</b><small>{item.detail}</small></span></Link>) : null}
    {search.kind === "empty" ? <p>Aucun lead ne correspond à « {query} ».</p> : null}
    {search.kind === "session" ? <p><WarningCircle size={18} /> Session expirée. <Link href="/">Se reconnecter</Link></p> : null}
    {search.kind === "forbidden" ? <p><WarningCircle size={18} /> Accès interdit pour cette recherche.</p> : null}
    {search.kind === "error" ? <p><WarningCircle size={18} /> API locale momentanément indisponible.</p> : null}
  </section>;
}
