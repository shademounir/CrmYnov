import { ChartBar, Info } from "@phosphor-icons/react";
import { StatusBadge } from "../../_components/ui/status-badge";
import { scopeLabels, type Catalogue, type Configuration, type Scope } from "./permission-types";

export function DashboardGuidance({ catalogue, configuration, grants }: { catalogue: Catalogue; configuration: Configuration; grants: Record<string, Scope> }): React.JSX.Element {
  const available = catalogue.catalogue.some((item) => item.key === "reporting.pilotage.view");
  const saved = configuration.grants["reporting.pilotage.view"] ?? "NONE", draft = grants["reporting.pilotage.view"] ?? "NONE";
  return <section className="panel permission-dashboard-guide" aria-labelledby="permission-dashboard-title">
    <div className="permission-guide-icon"><ChartBar size={24} aria-hidden="true" /></div><div className="permission-guide-content"><div className="permission-section-heading"><div><p className="eyebrow">Pilotage</p><h2 id="permission-dashboard-title">Un accès dédié au tableau de bord</h2></div>{available ? <StatusBadge tone={draft === "NONE" ? "neutral" : "info"}>{draft === "NONE" ? "Non attribué dans ce brouillon" : "Attribué dans ce brouillon"}</StatusBadge> : <StatusBadge tone="neutral">Catalogue actuel</StatusBadge>}</div>
      {available ? <div className="permission-guide-scopes"><p><span>Enregistré</span><strong>{scopeLabels[saved]}</strong></p><p><span>Brouillon local</span><strong>{scopeLabels[draft]}</strong></p></div> : <p>Le catalogue reçu ne propose pas encore une autorisation Pilotage distincte. Aucun droit supplémentaire n’est déduit.</p>}
      <p>Le tableau de bord complet exige la consultation des indicateurs, l’accès Pilotage et le droit de consulter chaque Lead dans le périmètre autorisé. L’export dispose de sa propre permission.</p>
      <p className="permission-help"><Info size={16} aria-hidden="true" />La responsabilité Admissions ne donne pas automatiquement l’accès au Pilotage : un rôle autorisé ou une configuration campus explicite est requis. Pour un Commercial, l’autorisation est explicite ; elle n’accorde aucun droit d’administration.</p>
      {available && configuration.campus !== "GLOBAL" ? <p className="permission-help">Une configuration campus ne peut pas dépasser le droit global du rôle ni les plafonds. Si le Pilotage du rôle Commercial est globalement désactivé, un Super Admin doit d’abord autoriser son périmètre global.</p> : null}
    </div>
  </section>;
}

export function ConfigurationImpact({ catalogue, configuration }: { catalogue: Catalogue; configuration: Configuration }): React.JSX.Element {
  const role = catalogue.roles.find((item) => item.role === configuration.role);
  const campus = configuration.campus === "GLOBAL" ? "configuration globale" : catalogue.campuses.find((item) => item.id === configuration.campus)?.code ?? "campus sélectionné";
  return <p className="permission-impact">Vous modifiez {role ? `le rôle ${role.label}` : "le plafond de tous les rôles"} · {campus}{role ? ` · ${role.users} utilisateurs associés` : ""}, pas les droits d’une personne seule. {configuration.campus === "GLOBAL" && configuration.kind === "ROLE" ? "Le rôle global s’applique aussi aux campus sans configuration propre." : "Les plafonds et le périmètre sélectionné restent applicables."}</p>;
}
