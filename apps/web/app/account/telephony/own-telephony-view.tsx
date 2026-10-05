import React, { type RefObject } from "react";
import Link from "next/link";
import { ArrowClockwiseIcon, CheckCircleIcon, DesktopIcon, LinkSimpleIcon, PhoneCallIcon, ShieldCheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { readinessLabels, type OwnPairingCode, type OwnTelephonySnapshot } from "./own-telephony-contract";

export type TelephonyFeedback = { kind: "session" | "forbidden" | "unavailable" | "success"; message: string };
type ViewProps = Readonly<{
  snapshot: OwnTelephonySnapshot | undefined; loading: boolean; busy: boolean; ready: boolean; mutationBlocked: boolean;
  feedback: TelephonyFeedback | undefined; pairing: OwnPairingCode | undefined; revealCode: boolean; confirmedPairing: boolean; confirmRevoke: boolean;
  gatewayUrl: string | undefined;
  refreshRef: RefObject<HTMLButtonElement | null>; revokeRef: RefObject<HTMLButtonElement | null>; dialogRef: RefObject<HTMLDialogElement | null>;
  onRefresh: () => void; onOpenAgent: () => void; onPairingConfirmation: (value: boolean) => void; onPair: () => void; onRevealCode: () => void; onClearCode: () => void;
  onRevokeSelection: () => void; onCancelRevoke: () => void; onConfirmRevoke: () => void;
}>;

function dateLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }).format(new Date(value)) : "Aucun contact observé";
}

export function OwnTelephonyView(props: ViewProps): React.JSX.Element {
  return <div className="own-telephony">
    <OwnSummary snapshot={props.snapshot} loading={props.loading} busy={props.busy} ready={props.ready} onRefresh={props.onRefresh} refreshRef={props.refreshRef} />
    {props.feedback ? <FeedbackMessage feedback={props.feedback} /> : null}
    {props.loading && !props.snapshot ? <output className="own-telephony__loading" aria-live="polite" aria-atomic="true">Chargement de votre profil personnel…</output> : null}
    {props.snapshot ? <>
      <div className="own-telephony__grid"><OwnProfileCard snapshot={props.snapshot} /><OwnAgentCard workstation={props.snapshot.workstation} /></div>
      <LocalAgentCard onOpen={props.onOpenAgent} />
      <AssociationCard {...props} snapshot={props.snapshot} />
      <p className="own-telephony__limits"><PhoneCallIcon size={18} aria-hidden="true" /> Les appels restent soumis aux droits CRM et aux événements réellement reçus de l’agent. Réception et enregistrement audio sont désactivés. Aucun appel n’est lancé depuis cette page.</p>
    </> : null}
    {props.confirmRevoke ? <RevokeDialog dialogRef={props.dialogRef} busy={props.busy} mutationBlocked={props.mutationBlocked} feedback={props.feedback} onCancel={props.onCancelRevoke} onConfirm={props.onConfirmRevoke} /> : null}
  </div>;
}

function FeedbackMessage({ feedback }: Readonly<{ feedback: TelephonyFeedback }>): React.JSX.Element {
  if (feedback.kind === "success") return <output className="ui-state" aria-live="polite" aria-atomic="true">{feedback.message}</output>;
  return <div className="ui-state ui-state--error" role="alert"><p>{feedback.message}</p>{feedback.kind === "session" ? <Link href="/">Se reconnecter</Link> : null}</div>;
}

function summaryTitle(loading: boolean, ready: boolean): string {
  if (loading) return "Vérification de votre poste…";
  return ready ? "Votre poste est prêt" : "Un point reste à vérifier";
}

function summaryReason(snapshot: OwnTelephonySnapshot | undefined, ready: boolean): string {
  if (!snapshot) return "Les états affichés proviennent du CRM et du dernier contact de l’agent.";
  const reason = ready ? "READY" : snapshot.readiness.reason ?? "";
  return readinessLabels[reason] ?? "La disponibilité n’est pas confirmée. Vérifiez l’agent puis actualisez.";
}

function OwnSummary({ snapshot, loading, busy, ready, onRefresh, refreshRef }: Pick<ViewProps, "snapshot" | "loading" | "busy" | "ready" | "onRefresh" | "refreshRef">): React.JSX.Element {
  const title = summaryTitle(loading, ready);
  const reason = summaryReason(snapshot, ready);
  return <section className="panel own-telephony__summary" aria-busy={loading}>
    <span className={`own-telephony__status-icon ${ready ? "is-ready" : ""}`} aria-hidden="true">{ready ? <CheckCircleIcon size={27} /> : <WarningCircleIcon size={27} />}</span>
    <div><p className="eyebrow">Disponibilité observée</p><h2>{title}</h2><p>{reason}</p></div>
    <button ref={refreshRef} className="secondary-button" type="button" disabled={loading || busy} onClick={onRefresh}><ArrowClockwiseIcon size={18} /> Actualiser</button>
  </section>;
}

function OwnProfileCard({ snapshot }: Readonly<{ snapshot: OwnTelephonySnapshot }>): React.JSX.Element {
  return <section className="panel own-telephony__profile" aria-labelledby="own-profile-title"><header><ShieldCheckIcon size={23} aria-hidden="true" /><div><p className="eyebrow">Profil attribué</p><h2 id="own-profile-title">Mon identité téléphonique</h2></div></header>
    {snapshot.profile ? <dl><div><dt>Extension</dt><dd>{snapshot.profile.extension || "Non renseignée"}</dd></div><div><dt>Profil</dt><dd>{snapshot.profile.enabled ? "Activé" : "Désactivé"}</dd></div><div><dt>Émission CRM</dt><dd>{snapshot.global.enabled ? "Activée" : "Désactivée"}</dd></div></dl> : <p>Aucune extension ne vous est attribuée. Contactez votre administrateur ; cette page ne crée ni compte SIP ni droit d’appel.</p>}
    <p className="own-telephony__note">L’extension et le serveur sont gérés par l’administration. Aucun mot de passe SIP n’est demandé dans le navigateur.</p>
  </section>;
}

function OwnAgentCard({ workstation }: Readonly<{ workstation: OwnTelephonySnapshot["workstation"] }>): React.JSX.Element {
  return <section className="panel own-telephony__profile" aria-labelledby="own-agent-title"><header><DesktopIcon size={23} aria-hidden="true" /><div><p className="eyebrow">Poste personnel</p><h2 id="own-agent-title">Mon agent Windows</h2></div></header>
    {workstation ? <><dl><div><dt>Poste</dt><dd>{workstation.displayName}</dd></div><div><dt>Association CRM</dt><dd>{workstation.active && !workstation.revokedAt ? "Active" : "Révoquée"}</dd></div><div><dt>Connexion CRM de l’agent</dt><dd>{workstation.connectionState === "CONNECTED" ? "Signalée au dernier contact" : "Non confirmée"}</dd></div><div><dt>Dernier contact</dt><dd>{dateLabel(workstation.lastSeenAt)} <small>Heure UTC</small></dd></div><div><dt>Agent / SDK</dt><dd>{workstation.agentVersion || "Non communiqué"} / {workstation.sdkVersion || "Non communiqué"}</dd></div></dl>
      <AgentObservations workstation={workstation} />
      {workstation.lastErrorCode ? <p className="own-telephony__note">L’agent a signalé une erreur. Consultez son diagnostic local sans transmettre de secret.</p> : null}
    </> : <p>Aucun poste associé. Suivez les étapes ci-dessous après l’attribution de votre extension.</p>}
  </section>;
}

function AgentObservations({ workstation }: Readonly<{ workstation: NonNullable<OwnTelephonySnapshot["workstation"]> }>): React.JSX.Element {
  return <ul className="own-telephony__observations"><li>SDK : {workstation.sdkLoaded ? "chargé au dernier contact" : "non confirmé"}</li><li>SIP : {workstation.sipRegistered ? "enregistré au dernier contact" : "non confirmé"}</li><li>Microphone : {workstation.inputConfigured ? "sélection locale signalée" : "à vérifier dans l’agent"}</li><li>Sortie audio : {workstation.outputConfigured ? "sélection locale signalée" : "à vérifier dans l’agent"}</li></ul>;
}

function LocalAgentCard({ onOpen }: Readonly<{ onOpen: () => void }>): React.JSX.Element {
  return <section className="panel own-telephony__local" aria-labelledby="own-local-title"><div><p className="eyebrow">Réglages sur votre ordinateur</p><h2 id="own-local-title">Ouvrir mon agent</h2><p>Le microphone, le haut-parleur, le secret SIP et les préférences de démarrage se configurent dans l’agent. Ils sont conservés localement ; cette page ne les modifie pas.</p></div>
    <a className="primary-button" href="crmynov-telephony://open" onClick={onOpen}><DesktopIcon size={18} /> Ouvrir l’agent Windows</a>
    <p className="own-telephony__note">Si Windows ne reconnaît pas ce lien, utilisez l’installateur du pilote fourni par votre administrateur. Le pilote non signé n’est pas une distribution générale. Ouvrir l’agent ne compose aucun numéro.</p>
  </section>;
}

function AssociationCard(props: ViewProps & Readonly<{ snapshot: OwnTelephonySnapshot }>): React.JSX.Element {
  return <section className="panel own-telephony__association" aria-labelledby="own-pair-title"><header><LinkSimpleIcon size={23} aria-hidden="true" /><div><p className="eyebrow">Association guidée</p><h2 id="own-pair-title">Relier ou remplacer mon poste</h2></div></header>
    {props.gatewayUrl ? <div className="own-telephony__gateway"><label htmlFor="own-agent-gateway">Adresse CRM à saisir dans l’assistant graphique de l’agent</label><input id="own-agent-gateway" value={props.gatewayUrl} readOnly autoComplete="off" spellCheck={false} /><p>Cette passerelle utilise le même environnement que votre navigateur : HTTPS sur DEV, boucle locale uniquement pour une preview. Ce n’est ni l’adresse du serveur SIP ni l’API privée.</p></div> : <p className="own-telephony__note">L’adresse sécurisée de la passerelle agent ne peut pas être déterminée. Contactez l’administration avant d’associer le poste.</p>}
    <ol><li>Ouvrez l’agent Windows sur le poste que vous voulez utiliser.</li><li>Arrêtez l’ancien agent et tout autre client SIP utilisant le même compte. Ne connectez pas deux clients simultanément.</li><li>Saisissez le code CRM temporaire dans l’assistant graphique d’association de l’agent, pas dans une commande CLI. Le secret SIP reste configuré uniquement sur le poste.</li><li>Actualisez cette page pour lire le contact CRM et l’enregistrement SIP réellement observés.</li></ol>
    {props.snapshot.canPair ? <><label className="own-telephony__confirmation"><input type="checkbox" checked={props.confirmedPairing} disabled={props.busy || Boolean(props.pairing)} onChange={(event) => props.onPairingConfirmation(event.target.checked)} /> J’associe mon propre poste et j’ai arrêté tout autre client utilisant ce compte SIP.</label><button type="button" className="secondary-button" disabled={props.busy || props.loading || props.mutationBlocked || !props.confirmedPairing || !props.gatewayUrl || Boolean(props.pairing)} onClick={props.onPair}><LinkSimpleIcon size={18} /> Générer mon code d’association</button></> : <p className="own-telephony__note">{props.snapshot.workstation?.active ? "Un poste est déjà associé. Sa révocation explicite est nécessaire avant une nouvelle association." : "L’association n’est pas disponible avec votre profil ou vos permissions actuels."}</p>}
    {props.pairing ? <PairingCard pairing={props.pairing} revealed={props.revealCode} onReveal={props.onRevealCode} onClear={props.onClearCode} /> : null}
    {props.snapshot.canRevoke && props.snapshot.workstation ? <div className="own-telephony__revoke"><p>Changer de poste ou perdre l’accès à cet ordinateur ? La révocation retire son accès CRM ; elle ne garantit pas son arrêt SIP physique.</p><button ref={props.revokeRef} className="secondary-button" type="button" disabled={props.busy || props.loading || props.mutationBlocked} onClick={props.onRevokeSelection}>Révoquer mon poste</button></div> : null}
  </section>;
}

function PairingCard({ pairing, revealed, onReveal, onClear }: Readonly<{ pairing: OwnPairingCode; revealed: boolean; onReveal: () => void; onClear: () => void }>): React.JSX.Element {
  return <div className="own-telephony__pairing"><label htmlFor="own-pairing-code">Code CRM temporaire — jamais votre mot de passe SIP</label><div><input id="own-pairing-code" type={revealed ? "text" : "password"} value={pairing.code} readOnly autoComplete="off" spellCheck={false} /><button className="secondary-button" type="button" aria-pressed={revealed} onClick={onReveal}>{revealed ? "Masquer le code" : "Afficher le code"}</button></div><p><output aria-live="polite" aria-atomic="true">Code à usage unique disponible. Expiration : {dateLabel(pairing.expiresAt)}, heure UTC.</output> Ne le publiez pas. Retirer le code de cette page ne l’annule pas côté serveur avant son expiration ou son remplacement.</p><button className="text-button" type="button" onClick={onClear}>Masquer et retirer le code de cette page</button></div>;
}

function RevokeDialog({ dialogRef, busy, mutationBlocked, feedback, onCancel, onConfirm }: Readonly<{
  dialogRef: RefObject<HTMLDialogElement | null>; busy: boolean; mutationBlocked: boolean; feedback: TelephonyFeedback | undefined; onCancel: () => void; onConfirm: () => void;
}>): React.JSX.Element {
  return <dialog ref={dialogRef} className="own-telephony__dialog" aria-labelledby="own-revoke-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}><h2 id="own-revoke-title">Révoquer l’accès de mon poste ?</h2><p>Le jeton CRM de cet agent sera refusé. Son profil protégé et son secret SIP local ne sont pas effacés. Arrêtez physiquement l’ancien client avant d’en associer un autre.</p><p>Un appel ou une commande encore en cours empêchera la révocation.</p>{feedback && feedback.kind !== "success" ? <p role="alert">{feedback.message}</p> : null}<div><button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Conserver mon poste</button><button className="primary-button" type="button" disabled={busy || mutationBlocked} onClick={onConfirm}>{busy ? "Révocation en cours…" : "Confirmer la révocation"}</button></div></dialog>;
}
