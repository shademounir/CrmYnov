# Tableau de bord Manager/Admin

Le contrat `manager-dashboard-v1` compose les cinq rapports versionnés via `GET /reports/manager-dashboard`. Les filtres `from`, `to` et `campus` sont propagés à chaque panneau ; le périmètre RBAC de l’appelant reste l’autorité finale.

Les cartes, tendances journalières, répartitions et tableaux utilisent des comptages distincts par lead dans le fuseau `Africa/Casablanca`. `GET /reports/manager-dashboard/export` expose uniquement les agrégats KPI, tendances et répartitions ; aucun identifiant de lead ou de collaborateur n’est exporté. Les états vide, chargement et erreur sont explicites et accessibles.

Les conversions ne sont attribuées qu’au responsable principal. Les contributions secondaires restent séparées. Aucun scoring disciplinaire, calcul financier, commission ou décision automatisée n’est produit.

Le rollback applicatif consiste à retirer le contrôleur, le service et la page consolidés. Les rapports unitaires restent indépendants ; aucune migration ni donnée persistante n’est concernée.
