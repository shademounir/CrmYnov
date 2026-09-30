"use client";

import {
  Alarm,
  Bell,
  CalendarBlank,
  CaretDown,
  ChartBar,
  ChatCircleDots,
  GearIcon as Gear,
  GitBranch,
  House,
  List,
  MagnifyingGlass,
  MapPin,
  PhoneCall,
  SidebarSimple,
  UploadSimple,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
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
  { href: "/calls/queue", label: "Appels", icon: PhoneCall },
  { href: "/imports/wizard", label: "Imports", icon: UploadSimple },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/chat", label: "Chat", icon: ChatCircleDots },
  { href: "/manager/reports/commercial-performance", label: "Rapports", icon: ChartBar },
  { href: "/admin/users", label: "Administration", icon: Gear },
  { href: "/admin/references", label: "Référentiels", icon: Gear },
  { href: "/admin/roles", label: "Rôles et permissions", icon: Gear },
  { href: "/admin/telephony", label: "Téléphonie", icon: PhoneCall },
  { href: "/admin/audit", label: "Journal d’audit", icon: List },
  { href: "/admin/scheduled-sheets", label: "Sheets planifié", icon: UploadSimple },
] as const;

type SessionRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "ADMISSIONS" | "AUDITOR";
type SessionProfile = { roles: SessionRole[]; professionalEmail?: string; scopeLabel?: string };
const commercialNavigation = new Set(["/leads", "/manager/reports/commercial-funnel", "/leads?view=FOLLOW_UP", "/appointments", "/calls/queue", "/notifications", "/chat"]);

export function visibleNavigation(roles: readonly SessionRole[]): typeof navigation[number][] {
  if (roles.includes("SUPER_ADMIN") || roles.includes("ADMIN")) return [...navigation];
  if (roles.includes("MANAGER")) return navigation.filter((item) => !item.href.startsWith("/admin/"));
  if (roles.includes("ADMISSIONS")) return navigation.filter((item) => commercialNavigation.has(item.href));
  if (roles.includes("AUDITOR")) return navigation.filter((item) => ["/leads", "/notifications", "/admin/audit"].includes(item.href));
  return [];
}

export async function loadShellSession(request: typeof fetch = fetch): Promise<SessionProfile> {
  const response = await request("/api/crm/sessions/current", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return { roles: [] };
  const value = await response.json() as { roles?: unknown; scopes?: unknown; professionalEmail?: unknown };
  const allowed: readonly string[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"];
  const scopes: unknown[] = Array.isArray(value.scopes) ? value.scopes : [];
  const hasScopeKind = (kind: string): boolean => scopes.some((scope) => typeof scope === "object" && scope !== null && "kind" in scope && scope.kind === kind);
  const scopeLabel = hasScopeKind("GLOBAL") ? "Tous les campus"
    : hasScopeKind("CAMPUS") ? "Campus attribué"
      : hasScopeKind("TEAM") ? "Équipe attribuée" : "Périmètre contrôlé";
  return {
    roles: Array.isArray(value.roles) ? value.roles.filter((role): role is SessionRole => typeof role === "string" && allowed.includes(role)) : [],
    scopeLabel,
    ...(typeof value.professionalEmail === "string" ? { professionalEmail: value.professionalEmail } : {}),
  };
}

export function isActive(pathname: string, href: string, locationSearch = ""): boolean {
  const [route = href, routeSearch = ""] = href.split("?");
  if (route === "/leads") {
    const expectedView = new URLSearchParams(routeSearch).get("view")?.toUpperCase();
    const currentView = new URLSearchParams(locationSearch).get("view")?.toUpperCase();
    if (expectedView === "FOLLOW_UP") return pathname === "/leads" && currentView === "FOLLOW_UP";
    return pathname === "/leads" && currentView !== "FOLLOW_UP";
  }
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

export async function loadUnreadNotificationCount(request: typeof fetch = fetch): Promise<number | undefined> {
  const response = await request("/api/crm/notifications?page=1&pageSize=1", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) return undefined;
  const payload = await response.json() as ApiValue;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.unread !== "number") return undefined;
  return Math.max(0, Math.floor(payload.unread));
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return <AppShellClient pathname={usePathname()} locationSearch={useSearchParams().toString()}>{children}</AppShellClient>;
}

export function AppShellClient({ pathname, locationSearch = "", children }: Readonly<{ pathname: string; locationSearch?: string; children: ReactNode }>): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "closed", items: [] });
  const [unreadNotifications, setUnreadNotifications] = useState<number>();
  const [sessionProfile, setSessionProfile] = useState<SessionProfile>({ roles: [] });
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const isAuthPath = authPaths.has(pathname);

  useEffect(() => {
    if (isAuthPath) return;
    void loadShellSession().then(setSessionProfile).catch(() => setSessionProfile({ roles: [] }));
  }, [isAuthPath]);

  useEffect(() => {
    if (mobileOpen) mobileCloseRef.current?.focus();
  }, [mobileOpen]);

  const closeMobileMenu = (): void => {
    setMobileOpen(false);
    mobileMenuRef.current?.focus();
  };

  const handleMobileKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (!mobileOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobileMenu();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  useEffect(() => {
    setMobileOpen(false);
    setProfileOpen(false);
  }, [locationSearch, pathname]);

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

  useEffect(() => {
    if (isAuthPath) return;
    void loadUnreadNotificationCount().then(setUnreadNotifications).catch(() => setUnreadNotifications(undefined));
    const update = (event: Event): void => setUnreadNotifications((event as CustomEvent<number>).detail);
    globalThis.addEventListener("crm:notifications-changed", update);
    return (): void => { globalThis.removeEventListener("crm:notifications-changed", update); };
  }, [isAuthPath, pathname]);

  if (isAuthPath) return <>{children}</>;

  return <AppShellView
    pathname={pathname}
    locationSearch={locationSearch}
    collapsed={collapsed}
    mobileOpen={mobileOpen}
    profileOpen={profileOpen}
    query={query}
    search={search}
    unreadNotifications={unreadNotifications}
    sessionRoles={sessionProfile.roles}
    professionalEmail={sessionProfile.professionalEmail}
    scopeLabel={sessionProfile.scopeLabel}
    onCollapse={() => setCollapsed((value) => !value)}
    onMobileOpen={() => setMobileOpen(true)}
    onMobileClose={closeMobileMenu}
    onMobileKeyDown={handleMobileKeyDown}
    mobileMenuRef={mobileMenuRef}
    mobileCloseRef={mobileCloseRef}
    sidebarRef={sidebarRef}
    onProfileToggle={() => setProfileOpen((value) => !value)}
    onQueryChange={setQuery}
    onSearchSelect={() => setQuery("")}
  >{children}</AppShellView>;
}

type AppShellViewProps = Readonly<{
  children: ReactNode;
  pathname: string;
  locationSearch?: string;
  collapsed: boolean;
  mobileOpen: boolean;
  profileOpen: boolean;
  query: string;
  search: SearchState;
  unreadNotifications?: number | undefined;
  sessionRoles?: readonly SessionRole[];
  professionalEmail?: string | undefined;
  scopeLabel?: string | undefined;
  onCollapse: () => void;
  onMobileOpen: () => void;
  onMobileClose: () => void;
  onMobileKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  mobileMenuRef?: RefObject<HTMLButtonElement | null>;
  mobileCloseRef?: RefObject<HTMLButtonElement | null>;
  sidebarRef?: RefObject<HTMLElement | null>;
  onProfileToggle: () => void;
  onQueryChange: (value: string) => void;
  onSearchSelect: () => void;
}>;

export function AppShellView({
  children,
  pathname,
  locationSearch = "",
  collapsed,
  mobileOpen,
  profileOpen,
  query,
  search,
  unreadNotifications,
  sessionRoles = [],
  professionalEmail,
  scopeLabel = "Périmètre contrôlé",
  onCollapse,
  onMobileOpen,
  onMobileClose,
  onMobileKeyDown,
  mobileMenuRef,
  mobileCloseRef,
  sidebarRef,
  onProfileToggle,
  onQueryChange,
  onSearchSelect,
}: AppShellViewProps): React.JSX.Element {
  const allowedNavigation = visibleNavigation(sessionRoles);
  const admin = sessionRoles.includes("SUPER_ADMIN") || sessionRoles.includes("ADMIN");
  const profileLabel = professionalEmail ?? "Session CRM";
  const currentLabel = allowedNavigation.find((item) => isActive(pathname, item.href, locationSearch))?.label ?? "CRM Admissions";
  return <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
    <aside id="crm-sidebar" ref={sidebarRef} className={`sidebar ${mobileOpen ? "is-mobile-open" : ""}`} aria-label="Navigation CRM" onKeyDown={onMobileKeyDown}>
      <div className="brand-lockup">
        <Image src="/brand/ynov-campus-maroc.png" alt="Maroc Ynov Campus" width={122} height={69} priority />
        {!collapsed ? <span>CRM Admissions</span> : null}
        <button ref={mobileCloseRef} type="button" className="mobile-close" onClick={onMobileClose} aria-label="Fermer la navigation"><X size={22} /></button>
      </div>
      <SidebarNavigation pathname={pathname} locationSearch={locationSearch} collapsed={collapsed} items={allowedNavigation} />
      {admin ? <Link className="sidebar-profile" href="/admin/users" aria-label="Ouvrir l’administration du compte">
        <span className="avatar" aria-hidden="true">CRM</span>
        {!collapsed ? <span><b>{profileLabel}</b><small>Droits contrôlés par l’API</small></span> : null}
      </Link> : <div className="sidebar-profile" aria-label={profileLabel}>
        <span className="avatar" aria-hidden="true">CRM</span>
        {!collapsed ? <span><b>{profileLabel}</b><small>Droits contrôlés par l’API</small></span> : null}
      </div>}
    </aside>
    <div className="app-main">
      <header className="topbar">
        <button ref={mobileMenuRef} type="button" className="icon-button mobile-menu" onClick={onMobileOpen} aria-label="Ouvrir la navigation" aria-controls="crm-sidebar" aria-expanded={mobileOpen}><List size={24} /></button>
        <button type="button" className="icon-button collapse-button" onClick={onCollapse} aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}><SidebarSimple size={22} /></button>
        <label className="global-search">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <span className="sr-only">Recherche globale</span>
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Rechercher un lead, identifiant, source…" autoComplete="off" />
          <kbd aria-hidden="true">Ctrl K</kbd>
        </label>
        <div className="topbar-actions">
          <span className="campus-button" aria-label={`Périmètre : ${scopeLabel}`}><MapPin size={19} aria-hidden="true" /><span>{scopeLabel}</span></span>
          <Link className="icon-button" href="/notifications" aria-label={unreadNotifications ? `Ouvrir les notifications, ${unreadNotifications} non lue${unreadNotifications > 1 ? "s" : ""}` : "Ouvrir les notifications"}><Bell size={22} />{unreadNotifications ? <span className="notification-dot" aria-hidden="true">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span> : null}</Link>
          <div className="popover-anchor">
            <button type="button" className="user-button" onClick={onProfileToggle} aria-expanded={profileOpen} aria-label="Ouvrir le menu du compte"><span className="avatar">CRM</span><span>{profileLabel}<small>Accès contrôlé</small></span><CaretDown size={15} aria-hidden="true" /></button>
            {profileOpen ? <div className="user-menu" role="menu">{admin ? <Link href="/admin/users" role="menuitem"><Gear size={18} /> Administration</Link> : null}<Link href="/" role="menuitem">Retour à la connexion</Link></div> : null}
          </div>
        </div>
      </header>
      <GlobalSearchResults search={search} query={query} onSearchSelect={onSearchSelect} />
      <div className="route-context sr-only" aria-live="polite">Page actuelle : {currentLabel}</div>
      <div className="page-canvas">{children}</div>
    </div>
    {mobileOpen ? <button type="button" tabIndex={-1} className="scrim" onClick={onMobileClose} aria-label="Fermer la navigation" /> : null}
  </div>;
}

function SidebarNavigation({ pathname, locationSearch, collapsed, items }: Readonly<{ pathname: string; locationSearch: string; collapsed: boolean; items: ReturnType<typeof visibleNavigation> }>): React.JSX.Element {
  return <nav aria-label="Navigation principale">
    {items.map(({ href, label, icon: Icon }) => {
      const active = isActive(pathname, href, locationSearch);
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
    {search.kind === "error" ? <p><WarningCircle size={18} /> Service CRM momentanément indisponible.</p> : null}
  </section>;
}
