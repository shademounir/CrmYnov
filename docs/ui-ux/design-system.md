# Design system Ynov du CRM

Ce socle traduit la charte Ynov en primitives d’interface accessibles. Les ressources de référence (charte PDF, captures et logo) restent hors du dépôt.

## Fondations

- Couleurs de marque : bleu canard `#23B2A4` et onyx `#1D1D1E`.
- Texte sur fond bleu canard : onyx par défaut ; le blanc est réservé aux combinaisons dont le contraste a été vérifié.
- Typographie : Montserrat, puis Helvetica, Arial et sans-serif. Aucun téléchargement distant n’est requis.
- Angle graphique : `21deg`, utilisé avec parcimonie comme accent et jamais au détriment de la lisibilité.
- États fonctionnels : succès, avertissement, erreur et information ont leurs propres couleurs ; le bleu canard ne porte pas seul une signification métier.
- Espacement : échelle de 4 à 48 px ; rayons de 8, 12 et 16 px ; ombres légères pour hiérarchiser les surfaces.

## Composants

Les composants partagés vivent dans `apps/web/app/_components/ui` : `PageHeader`, `StatCard`, `StatusBadge`, `EmptyState`, `ErrorState`, `Skeleton`, `FormField`, `Pagination` et `PermissionGate`.

`PermissionGate` masque une action non autorisée côté interface, mais ne remplace jamais le contrôle RBAC et anti-IDOR du backend.

Le shell CRMY-160 complète ces primitives avec la navigation onyx, la topbar, la recherche globale reliée à l’API, les cartes KPI, les files rapides, les panneaux du dashboard et les cartes mobiles des leads. Les icônes proviennent exclusivement de Phosphor Icons ; le logo raster transparent est l’actif officiel optimisé fourni par le Product Owner.

## États interactifs

- `hover` : variation légère de surface ou de bordure, sans déplacement qui gêne la lecture ;
- `focus-visible` : anneau de 3 px, décalé de 2 px et visible sur fond clair comme onyx ;
- `active` : surface onyx ou bleu canard pâle selon la nature du contrôle ;
- `disabled` : contraste atténué, curseur interdit et attribut natif `disabled` ;
- `loading` : état annoncé avec `aria-busy`, texte explicite et skeleton sans donnée métier ;
- `error` : bloc `role="alert"`, motif expurgé et action de nouvelle tentative ;
- `success` : message textuel associé à l’état vert, jamais une couleur seule ;
- confirmation destructive : modale explicite, action dangereuse distincte et action d’annulation prioritaire au clavier ;
- toast, tooltip, pagination et menus : noms accessibles, fermeture clavier et cibles tactiles de 44 × 44 px minimum.

## Responsive

- Desktop : shell complet et tableaux denses jusqu’à cinq actions prioritaires.
- Tablette : sidebar compacte, grille KPI conservée et panneaux principaux empilés lorsque nécessaire.
- Mobile : navigation en tiroir, tableaux Leads et Priorités transformés en cartes verticales ; les rubans KPI et vues enregistrées restent balayables sans provoquer de débordement de page.
- Les actions d’une fiche longue restent collantes et la timeline conserve son filtre sans modifier l’historique immuable.

## Accessibilité

- Focus visible de 3 px avec décalage.
- Champs associés à un libellé et aux aides/erreurs par `aria-describedby`.
- Erreurs annoncées avec `role="alert"` et chargements avec `role="status"`.
- Contrôles d’au moins 44 px sur les actions et la pagination.
- Animations désactivées avec `prefers-reduced-motion`.
- Mise en page utilisable dès 320 px sans imposer de largeur fixe.

## Usage

Les styles globaux définissent seulement les tokens et les primitives universelles. Les composants métier doivent utiliser des composants ou modules CSS dédiés afin de conserver un ordre CSS déterministe dans Next.js.
