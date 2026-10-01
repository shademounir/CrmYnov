# Matrice de mapping des entrées de leads

Cette matrice est issue d'une analyse locale en lecture seule des deux canevas anonymisés du 23 août 2026. Les fichiers originaux restent hors Git. Aucune valeur de cellule n'est reproduite ici et seules des fixtures synthétiques peuvent être versionnées.

## Périmètre et précédence

- `LEADS YNOV.MA` est la source canonique de la reprise initiale.
- L'export Forminator/Zapier complète uniquement les leads absents ; il ne remplace ni statut, ni responsable, ni relance, ni commentaire consolidé.
- `VISITES ET APPELS`, `LEADS YNOV.COM`, `JOBINTECH REACT`, `BDD Relance 2025` et `Feuil10` sont des sources historiques complémentaires.
- Les feuilles de reporting, planning, guide et création ne sont jamais interprétées comme des leads.
- `Feuil10` ne possède pas d'en-tête fiable : son profil reste bloqué jusqu'à validation humaine d'un mapping positionnel.

## Excel CRM actuel — `LEADS YNOV.MA`

| Source | Colonne source | Champ CRM cible | Transformation | Obligatoire | Règle d'erreur |
| --- | --- | --- | --- | --- | --- |
| Excel CRM | `NOM` | `lastName` | trim et normalisation Unicode | oui | ligne invalide si vide |
| Excel CRM | `PRÉNOM` | `firstName` | trim et normalisation Unicode | oui | ligne invalide si vide |
| Excel CRM | `TÉLÉPHONE` | `phone` | caractères de présentation retirés, format international conservé | conditionnel | invalide si présent et hors 8–15 chiffres |
| Excel CRM | `EMAIL` | `email` | trim et minuscules | conditionnel | invalide si présent et mal formé |
| Excel CRM | `NIVEAU` | `educationLevel` | table de correspondance versionnée | oui pour création | revue si absent ou inconnu |
| Excel CRM | `SPÉCIALITÉ` | provenance autorisée | trim ; ne remplace pas la formation | non | conservée comme métadonnée |
| Excel CRM | `FORMATION SOUHAITÉE` | `program` | mapping de formation validé | oui pour création | revue si absent ou ambigu |
| Excel CRM | `DATE RÉCEPTION` | `provenance.occurredAt` | date Excel ou texte converti en ISO avec fuseau documenté | non | revue si présente et invalide |
| Excel CRM | `DATE TRAITEMENT` | activité historique | créer seulement si une date structurée existe | non | aucune date fabriquée |
| Excel CRM | `DÉLAI (jours)` | — | calcul dérivé ignoré | non | jamais importé comme fait métier |
| Excel CRM | `SOURCE` | `provenance.originalSource` | mapping vers la taxonomie contrôlée | oui pour création | revue si absente ou inconnue |
| Excel CRM | `STATUT` | `lead.status` + `provenance.rawStatus` | mapping PO ci-dessous ; brut toujours conservé | non | valeur inconnue en revue |
| Excel CRM | `COMMENTAIRE 1` | activité historique | note append-only, sans date inventée | non | formule refusée ; longueur bornée |
| Excel CRM | `QUALIFICATION` | provenance autorisée | valeur historique, sans changement automatique du statut | non | inconnue conservée, pas interprétée |
| Excel CRM | `COMMENTAIRE 2` | activité historique | même règle que commentaire 1 | non | formule refusée |
| Excel CRM | `rdv` | activité `MEETING` | uniquement si information structurée | non | aucune activité fabriquée |
| Excel CRM | `PROCHAINE ACTION` | activité/relance historique | convertir seulement date/action structurée | non | ambiguë en revue |
| Excel CRM | `RESPONSABLE` | affectation historique proposée | résolution par référentiel collaborateurs | non | inconnu en revue, jamais auto-créé |
| Excel CRM | `PAYS` | provenance autorisée | normalisation contrôlée | non | valeur libre conservée |
| Excel CRM | `Part 1er (%)` | — | calcul dérivé ignoré | non | jamais importé |
| Excel CRM | `Lien WhatsApp` | — | formule/lien calculé ignoré | non | jamais évalué ni journalisé |
| Excel CRM | `VILLE` | provenance autorisée | trim et mapping contrôlé | non | revue si utilisé pour déduire un campus |

## Forminator/Zapier — export brut

Ordre observé : `Submission ID`, `Submission Time`, `Nom - Prénom`, `Nom - Nom`, `Adresse éléctronique`, `Numéro de téléphone`, `Niveau d'étude`, `Formation choisie`, `Webhook Info`.

| Source | Colonne source | Champ CRM cible | Transformation | Obligatoire | Règle d'erreur |
| --- | --- | --- | --- | --- | --- |
| Forminator/Zapier | `Submission ID` | `provenance.externalId` | trim ; clé `FORMINATOR_ZAPIER:<id>` | oui | ligne invalide si vide ; replay idempotent |
| Forminator/Zapier | `Submission Time` | `provenance.occurredAt` | date textuelle convertie en ISO | oui | ligne invalide si conversion impossible |
| Forminator/Zapier | `Nom - Prénom` | `firstName` | trim et Unicode | oui | ligne invalide si vide |
| Forminator/Zapier | `Nom - Nom` | `lastName` | trim et Unicode | oui | ligne invalide si vide |
| Forminator/Zapier | `Adresse éléctronique` | `email` | trim et minuscules | conditionnel | au moins email ou téléphone valide |
| Forminator/Zapier | `Numéro de téléphone` | `phone` | normalisation 8–15 chiffres | conditionnel | au moins email ou téléphone valide |
| Forminator/Zapier | `Niveau d'étude` | `educationLevel` | mapping versionné | oui pour création | revue si inconnu |
| Forminator/Zapier | `Formation choisie` | `program` | mapping versionné | oui pour création | revue si ambiguë |
| Forminator/Zapier | `Webhook Info` | métadonnée technique minimale | allowlist de clés ; valeur libre ignorée | non | colonne inconnue ou secret présumé refusé |

## Profils historiques complémentaires

- `VISITES ET APPELS` et `LEADS YNOV.COM` utilisent les colonnes communes `NOM`, `PRÉNOM`, `TÉLÉPHONE`, `EMAIL`, `NIVEAU`, `SPÉCIALITÉ`, `FORMATION SOUHAITÉE`, dates, `SOURCE`, `INTÉRÊT`, `STATUT`, `DERNIER CONTACT`, commentaires, `PROCHAINE ACTION`, `RESPONSABLE`. Les colonnes calculées `DÉLAI (jours)`, `Part 1er (%)` et `Lien WhatsApp` sont ignorées.
- `JOBINTECH REACT` ajoute `PROFIL JOBINTECH`, `STATUT JOBINTECH`, `STATUT LEAD`, `MAIL ENVOYÉ ?`, `A RÉPONDU ?` et `ORIGINE`. Les statuts JobInTech restent exclusivement des métadonnées de provenance ; seul `STATUT LEAD` peut alimenter le mapping CRM validé.
- `BDD Relance 2025` expose `N°`, `Date contact`, `Canal`, `Nom & Prénom`, `Téléphone`, `E-mail`, `Option d'admission`, `Niveau d'étude`, `Recommandation commerciale`, `Observations 2024`, trois colonnes de relance, `Statut de suivi` et un commentaire de retour. `N°` n'est pas considéré comme identifiant stable sans validation de portée.

## Mapping des statuts historiques

| Libellé normalisé | Statut CRM | Condition |
| --- | --- | --- |
| À contacter, À qualifier, Injoignable, Injoignable / à relancer | `PROSPECT` | toujours |
| Contacté, RDV planifié | `CONTACTED` | toujours |
| RDV effectué, Dossier ouvert | `QUALIFIED` | toujours |
| Inscrit | `ENROLLED` | reprise historique, sans nouvelle approbation |
| Sans suite | `CLOSED_LOST` | reprise historique, sans nouvelle approbation |
| À relancer | `CONTACTED` | seulement avec preuve structurée d'un contact antérieur |
| À relancer | `PROSPECT` | absence de preuve ou incertitude |
| Doublon | aucune création | rattacher une provenance seulement sur correspondance fiable |
| autre | aucune conversion | revue manuelle |

Le libellé brut est toujours conservé dans une provenance de source `LEGACY_IMPORT`, avec lot et date d'import. Les rendez-vous, appels et relances deviennent des activités historiques seulement lorsque leur nature et leur date sont structurées.

## Déduplication et idempotence

1. système source + identifiant externe ;
2. email normalisé ;
3. téléphone normalisé ;
4. nom/prénom : alerte uniquement, jamais fusion automatique.

Un email et un téléphone pointant vers deux leads distincts provoquent `identity_collision` et une revue manuelle. Une occurrence fiable sur un lead existant ajoute seulement une provenance append-only et ne change ni statut, ni responsable, ni prochaine action. Les champs campus ou campagne absents ne sont jamais déduits silencieusement.

## Colonnes inconnues, formules et données absentes

- Toute colonne inconnue bloque la ligne ou le profil jusqu'à validation du mapping.
- Une cellule contenant une formule n'est jamais évaluée comme donnée d'entrée.
- Les dates, activités, campagnes et campus absents ne sont jamais fabriqués.
- Les feuilles `CONGE PREVISIONNEL`, `RAPPORT CAMPAGNE`, `STATISTIQUES`, `DASHBOARD`, `PLANNING TESTS`, `RECAP RDV`, `RETOUR TERRAIN`, `GUIDE`, `BRIEF CREATIF`, `SUIVI CAMPAGNE` sont hors import de leads.

## Preuve de non-versionnement

Les deux fichiers sources résident hors du dépôt. Les règles Git et les scans de secrets/historique doivent refuser les formats et noms de données réelles ; aucune copie temporaire n'est conservée après l'analyse.
