"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, CheckCircle, Desktop, LinkSimple, PhoneCall, ShieldCheck, WarningCircle } from "@phosphor-icons/react";

interface ServerProfile { id: string; name: string; sipDomain: string; proxyUri: string | null; transport: string; campusId: string | null; enabled: boolean; version: number }
interface Workstation { id: string; displayName: string; active: boolean; connectionState: string; sipRegistered: boolean; sdkLoaded: boolean; agentVersion: string; sdkVersion: string; lastErrorCode: string | null; lastSeenAt: string | null; version: number }
interface UserProfile { id: string; userId: string; sipAddress: string; authUsername: string | null; enabled: boolean; state: string; version: number; user: { id: string; professionalDisplayName: string | null; professionalEmail: string; campusId: string | null; active: boolean }; server: ServerProfile; workstations: Workstation[] }
interface Provisioning { servers: ServerProfile[]; users: UserProfile[] }
interface Collaborator { id: string; professionalDisplayName?: string | null; professionalEmail: string; campusId?: string | null; active: boolean }
interface Configuration { mode: string; clickToCallEnabled: boolean; inboundEnabled: boolean; outboundEnabled: boolean; recordingPolicy: string; maxCallDurationSeconds: number; version: number; outboundReadiness?: { available?: boolean; reason?: string; identityLabel?: string } }
interface PairingCode { code: string; expiresAt: string; profileId: string }

const stateLabels: Readonly<Record<string, string>> = { INCOMPLETE: "À compléter", PAIRING_REQUIRED: "Poste à associer", LOCAL_CONFIGURATION_REQUIRED: "Secret SIP local requis", READY: "Prêt à appeler", DISABLED: "Désactivé" };
const reasonLabels: Readonly<Record<string, string>> = { MODE_DISABLED: "Mode Liblinphone non activé", USER_PROFILE_DISABLED: "Profil utilisateur désactivé", USER_DISABLED: "Utilisateur CRM désactivé", SERVER_PROFILE_DISABLED: "Serveur SIP désactivé", WORKSTATION_NOT_PAIRED: "Poste non associé", WORKSTATION_OFFLINE: "Agent Windows hors ligne", SDK_NOT_LOADED: "SDK non chargé", SIP_NOT_REGISTERED: "Compte SIP non enregistré", READY: "Poste prêt" };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/crm/${path}`, { credentials: "same-origin", cache: "no-store", ...init, headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const payload = await response.json().catch(() => ({})) as { code?: string };
  if (!response.ok) throw new Error(payload.code ?? `telephony_http_${response.status}`);
  return payload as T;
}

function humanError(failure: unknown): string {
  const code = failure instanceof Error ? failure.message : "telephony_unavailable";
  return ({ authentication_required: "Votre session a expiré. Reconnectez-vous avant de modifier la configuration.", telephony_administration_forbidden: "Cette configuration est réservée aux administrateurs autorisés.", telephony_profile_scope_forbidden: "L’utilisateur ou le poste est hors de votre périmètre.", telephony_workstation_already_paired: "Un poste actif est déjà associé à cette identité.", telephony_user_profile_version_conflict: "Le profil a changé. Rechargez avant de recommencer.", telephony_server_profile_version_conflict: "Le serveur a changé. Rechargez avant de recommencer.", telephony_bridge_not_ready: "Le poste Windows doit être associé, actif et enregistré sur le compte SIP avant l’activation.", api_proxy_unavailable: "L’API locale est indisponible. Aucun changement n’a été enregistré." } as Record<string, string>)[code] ?? "L’opération n’a pas été confirmée. Rechargez l’état avant de recommencer.";
}

export function TelephonyAdmin(): React.JSX.Element {
  const [provisioning, setProvisioning] = useState<Provisioning>({ servers: [], users: [] });
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]); const [configuration, setConfiguration] = useState<Configuration>();
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [serverName, setServerName] = useState("Poste SIP CRM"); const [sipDomain, setSipDomain] = useState(""); const [proxyUri, setProxyUri] = useState(""); const [transport, setTransport] = useState("TLS"); const [serverCampus, setServerCampus] = useState("");
  const [selectedUser, setSelectedUser] = useState(""); const [selectedServer, setSelectedServer] = useState(""); const [sipAddress, setSipAddress] = useState(""); const [authUsername, setAuthUsername] = useState("");
  const [pairing, setPairing] = useState<PairingCode>();

  const load = useCallback(async (): Promise<void> => {
    setLoading(true); setError("");
    try {
      const [nextProvisioning, nextConfiguration, users] = await Promise.all([
        request<Provisioning>("telephony/provisioning"), request<Configuration>("telephony/configuration"),
        request<{ users?: Collaborator[] }>("users?active=true").catch(() => ({ users: [] })),
      ]);
      setProvisioning(nextProvisioning); setConfiguration(nextConfiguration); setCollaborators(Array.isArray(users.users) ? users.users : []);
      setPairing((current) => current && (new Date(current.expiresAt).getTime() <= Date.now() || nextProvisioning.users.some((profile) => profile.id === current.profileId && profile.workstations.some((workstation) => workstation.active))) ? undefined : current);
      setSelectedServer((current) => current || nextProvisioning.servers[0]?.id || "");
    } catch (failure) { setError(humanError(failure)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const ready = Boolean(configuration?.outboundReadiness?.available);
  const activeProfile = useMemo(() => provisioning.users.find((item) => item.userId === selectedUser), [provisioning.users, selectedUser]);
  const selectedServerProfile = useMemo(() => provisioning.servers.find((item) => item.id === selectedServer), [provisioning.servers, selectedServer]);
  useEffect(() => {
    if (!selectedServerProfile) return;
    setServerName(selectedServerProfile.name); setSipDomain(selectedServerProfile.sipDomain); setProxyUri(selectedServerProfile.proxyUri ?? "");
    setTransport(selectedServerProfile.transport); setServerCampus(selectedServerProfile.campusId ?? "");
  }, [selectedServerProfile]);

  async function operation(action: () => Promise<void>, message: string): Promise<void> {
    if (busy) return; setBusy(true); setError(""); setSuccess("");
    try { await action(); setSuccess(message); await load(); }
    catch (failure) { setError(humanError(failure)); }
    finally { setBusy(false); }
  }
  async function saveServer(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await operation(async () => { const saved = await request<ServerProfile>("telephony/provisioning/server-profiles", { method: "POST", body: JSON.stringify({ ...(selectedServerProfile ? { id: selectedServerProfile.id, expectedVersion: selectedServerProfile.version } : {}), name: serverName, sipDomain, proxyUri: proxyUri || null, transport, campusId: serverCampus || null, enabled: true }) }); setSelectedServer(saved.id); }, selectedServerProfile ? "Serveur SIP mis à jour sans credential." : "Serveur SIP enregistré sans credential.");
  }
  async function saveUser(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const existing = provisioning.users.find((item) => item.userId === selectedUser);
    await operation(async () => { await request("telephony/provisioning/user-profiles", { method: "POST", body: JSON.stringify({ userId: selectedUser, serverProfileId: selectedServer, sipAddress, authUsername: authUsername || null, enabled: true, ...(existing ? { expectedVersion: existing.version } : {}) }) }); }, "Identité SIP reliée au collaborateur. Le mot de passe reste absent du CRM.");
  }
  async function issuePairing(profileId: string): Promise<void> {
    if (busy) return; setBusy(true); setError(""); setSuccess(""); setPairing(undefined);
    try { setPairing(await request<PairingCode>(`telephony/provisioning/user-profiles/${encodeURIComponent(profileId)}/pairing-codes`, { method: "POST", body: "{}" })); }
    catch (failure) { setError(humanError(failure)); }
    finally { setBusy(false); }
  }
  async function revoke(workstationId: string): Promise<void> { await operation(() => request(`telephony/provisioning/workstations/${encodeURIComponent(workstationId)}/revoke`, { method: "PATCH", body: "{}" }).then(() => undefined), "Poste révoqué. Son token local ne peut plus interroger le CRM."); }
  async function activate(): Promise<void> {
    if (!configuration) return;
    await operation(() => request("telephony/configuration", { method: "PATCH", body: JSON.stringify({ expectedVersion: configuration.version, mode: "LINPHONE", clickToCallEnabled: true, inboundEnabled: false, outboundEnabled: true, recordingPolicy: "DISABLED", maxCallDurationSeconds: 7200 }) }).then(() => undefined), "Appels sortants activés pour les postes prêts. Réception et enregistrement restent désactivés.");
  }

  return <div className="telephony-admin">
    <section className="panel telephony-admin__status" aria-busy={loading}>
      <div className={`telephony-admin__status-icon ${ready ? "is-ready" : ""}`} aria-hidden="true">{ready ? <CheckCircle size={25} /> : <WarningCircle size={25} />}</div>
      <div><p className="eyebrow">État du pilote</p><h2>{ready ? "Poste prêt pour les appels sortants" : "Activation contrôlée"}</h2><p>{reasonLabels[configuration?.outboundReadiness?.reason ?? "MODE_DISABLED"] ?? "La disponibilité doit être confirmée par l’agent Windows."}</p></div>
      <button className="secondary-button" type="button" disabled={loading || busy} onClick={() => void load()}><ArrowClockwise size={17} /> Actualiser</button>
    </section>
    {error ? <p className="ui-state ui-state--error telephony-admin__feedback" role="alert">{error}</p> : null}
    {success ? <p className="ui-note telephony-admin__feedback" role="status">{success}</p> : null}
    <ol className="telephony-admin__steps" aria-label="Configuration du poste d’appel">
      <li className="panel"><header><span>1</span><div><p className="eyebrow">Infrastructure autorisée</p><h2>Serveur SIP</h2></div></header><p>Renseignez seulement l’adresse de connexion déjà utilisée. Aucun accès administratif PBX n’est requis.</p>
        <form onSubmit={(event) => void saveServer(event)}><label>Nom du profil<input value={serverName} onChange={(event) => setServerName(event.target.value)} required minLength={2} maxLength={120} /></label><label>Domaine SIP<input value={sipDomain} onChange={(event) => setSipDomain(event.target.value)} placeholder="sip.exemple.local" required /></label><label>Proxy facultatif<input value={proxyUri} onChange={(event) => setProxyUri(event.target.value)} placeholder="sip:sip.exemple.local:5061" /></label><div className="telephony-admin__row"><label>Transport<select value={transport} onChange={(event) => setTransport(event.target.value)}><option>TLS</option><option>TCP</option><option>UDP</option></select></label><label>Campus facultatif<input value={serverCampus} onChange={(event) => setServerCampus(event.target.value)} /></label></div><button className="secondary-button" disabled={busy} type="submit">Enregistrer le serveur</button></form>
        {provisioning.servers.length ? <ul className="telephony-admin__compact-list">{provisioning.servers.map((server) => <li key={server.id}><strong>{server.name}</strong><span>{server.sipDomain} · {server.transport} · {server.enabled ? "actif" : "désactivé"}</span></li>)}</ul> : null}
      </li>
      <li className="panel"><header><span>2</span><div><p className="eyebrow">Identité contrôlée</p><h2>Collaborateur et extension</h2></div></header><p>L’extension appartient à un utilisateur CRM. Son mot de passe sera saisi uniquement sur son poste Windows.</p>
        <form onSubmit={(event) => void saveUser(event)}><label>Collaborateur<select value={selectedUser} onChange={(event) => { setSelectedUser(event.target.value); const profile = provisioning.users.find((item) => item.userId === event.target.value); if (profile) { setSipAddress(profile.sipAddress); setAuthUsername(profile.authUsername ?? ""); setSelectedServer(profile.server.id); } }} required><option value="">Sélectionner</option>{collaborators.map((user) => <option key={user.id} value={user.id}>{user.professionalDisplayName || user.professionalEmail}</option>)}</select></label><label>Serveur<select value={selectedServer} onChange={(event) => setSelectedServer(event.target.value)} required><option value="">Sélectionner</option>{provisioning.servers.filter((item) => item.enabled).map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label><label>Adresse SIP<input value={sipAddress} onChange={(event) => setSipAddress(event.target.value)} placeholder="sip:extension@domaine" required /></label><label>Nom d’authentification facultatif<input value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} autoComplete="off" /></label><button className="secondary-button" disabled={busy || !selectedServer || !selectedUser} type="submit">Enregistrer l’identité</button></form>
        {activeProfile ? <p className="telephony-admin__profile-state"><ShieldCheck size={18} /> {stateLabels[activeProfile.state] ?? activeProfile.state}</p> : null}
      </li>
      <li className="panel"><header><span>3</span><div><p className="eyebrow">Association locale</p><h2>Poste Windows</h2></div></header><p>Le code est valable dix minutes et une seule fois. L’agent utilisera ensuite un token révocable, protégé localement avec DPAPI.</p>
        {provisioning.users.length === 0 ? <p className="telephony-admin__empty">Créez d’abord une identité SIP.</p> : <div className="telephony-admin__profiles">{provisioning.users.map((profile) => <article key={profile.id}><div><strong>{profile.user.professionalDisplayName || profile.user.professionalEmail}</strong><span>{stateLabels[profile.state] ?? profile.state}</span></div>{profile.workstations.some((item) => item.active) ? profile.workstations.filter((item) => item.active).map((workstation) => <div className="telephony-admin__workstation" key={workstation.id}><Desktop size={19} /><span><strong>{workstation.displayName}</strong><small>{workstation.sdkLoaded ? "SDK chargé" : "SDK absent"} · {workstation.sipRegistered ? "SIP enregistré" : "SIP non enregistré"}</small></span><button className="text-button" disabled={busy} type="button" onClick={() => void revoke(workstation.id)}>Révoquer</button></div>) : <button className="secondary-button" disabled={busy} type="button" onClick={() => void issuePairing(profile.id)}><LinkSimple size={17} /> Générer le code d’association</button>}</article>)}</div>}
        {pairing ? <div className="telephony-admin__pairing" role="status"><p className="eyebrow">Code à saisir dans l’agent Windows</p><code>{pairing.code}</code><p>Expire à {new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Casablanca" }).format(new Date(pairing.expiresAt))}, heure de Casablanca. Ne le publiez pas.</p></div> : null}
      </li>
    </ol>
    <section className="panel telephony-admin__activation"><div><PhoneCall size={24} /><div><p className="eyebrow">Dernière barrière</p><h2>Activer uniquement l’émission</h2><p>Le bouton reste soumis au contrôle serveur : poste associé, SDK chargé et compte SIP enregistré. La réception et l’enregistrement audio demeurent désactivés.</p></div></div><button className="primary-button" type="button" disabled={busy || !ready || configuration?.mode === "LINPHONE" && configuration.outboundEnabled} onClick={() => void activate()}>{configuration?.mode === "LINPHONE" && configuration.outboundEnabled ? "Émission activée" : "Activer les appels sortants"}</button></section>
  </div>;
}
