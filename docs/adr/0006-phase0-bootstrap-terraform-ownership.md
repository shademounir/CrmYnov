# ADR-0006 — Adoption Terraform du projet bootstrap préexistant

- Statut : corrigé après revue Product Owner, proposé pour nouvelle revue
- Date : 2026-08-13
- Ticket : CRMY-123
- Décideur attendu : Product Owner

## Contexte

Le projet `crmynov-bst-n7x4q2` doit devenir le projet bootstrap et quota ADC de la Foundation, sans cinquième projet permanent. Il ne peut pas servir de quota project avant d'exister. Cette livraison reste code-only et ne crée ni projet, ni lien de facturation, ni API, ni configuration ADC, ni import Terraform réel.

## Options étudiées

### A — Projet externe non géré par Terraform

Le projet est créé hors Terraform et reste une dépendance externe. Cette option évite l'import, mais ne fournit pas de gouvernance Terraform durable sur son lifecycle, son parent et ses labels.

### B — Création contrôlée puis adoption dans un état Phase 0 dédié

Une procédure Phase 0A crée uniquement le projet. Une Phase 0B séparément autorisée importe ensuite sa ressource `google_project` dans l'état Phase 0. Foundation ne possède jamais cette ressource.

### C — Création Phase 0 puis gestion conditionnelle par Foundation

Foundation pourrait adopter conditionnellement le projet, mais cette option expose à une double propriété, à un import ambigu et à une recréation du même project ID.

## Décision

L'option **B** est retenue avec quatre étapes obligatoirement ordonnées.

### Phase 0A — création procédurale

1. Vérifier l'identité humaine, l'organisation et la disponibilité du project ID.
2. Obtenir une autorisation Product Owner dédiée à une tentative unique.
3. Créer uniquement `crmynov-bst-n7x4q2` dans l'organisation approuvée.
4. Ne créer aucune autre ressource CRM, aucune clé de service account et ne lancer aucune Foundation Terraform.

### Phase 0B — adoption Terraform

1. Vérifier que le projet existe, que son project ID et son organisation sont exacts et qu'il n'est pas pending deletion.
2. Vérifier qu'aucun autre état Terraform ne contient ce projet.
3. Obtenir une autorisation explicite d'import distincte.
4. Importer uniquement le projet dans `google_project.bootstrap` de l'état Phase 0 dédié.
5. Vérifier immédiatement que `deletion_policy = "PREVENT"`, `auto_create_network = false` et la cible de parent sont compatibles sans remplacement.

Un plan avant cet import est interdit. Foundation Phase 1 ne peut ni créer, ni importer, ni posséder le projet bootstrap.

### Phase 0C — quota, API et socle

1. Vérifier `serviceusage.services.use` pour l'identité humaine sur le projet existant. Aucune API ne « configure » l'ADC : la définition du quota project est une écriture locale dans l'ADC ; Service Usage fournit la permission obligatoire pour désigner et utiliser ce projet.
2. Par une procédure séparément autorisée, activer la liste fermée des trois API nécessaires avant le premier plan : Service Usage, Cloud Resource Manager et Cloud Billing.
3. Importer chacune des trois ressources `google_project_service.phase0` dans le même état Phase 0 avant le plan. Une API activée procéduralement ne doit jamais apparaître comme une création Terraform.
4. Configurer ensuite l'ADC avec le projet existant comme quota project, sous autorisation séparée.
5. Préparer le rattachement de facturation comme ressource Phase 0 et produire un plan Terraform Phase 0 JSON séparé.
6. Valider le JSON réel avant tout apply. Les compteurs documentés avant ce plan sont indicatifs.

### Phase 1 — Foundation

Foundation lit le bootstrap avec `data.google_project.bootstrap`. Elle crée le folder, DEV, STAGING et PROD, leurs liens de facturation, ses API disjointes et les budgets. Elle ne recrée, n'importe ni ne possède le bootstrap.

## Propriété exacte

| Ressource ou opération | Propriétaire |
|---|---|
| Création initiale du projet bootstrap | Procédure Phase 0A, avant Terraform |
| `google_project.bootstrap` après import | État Terraform Phase 0 exclusivement |
| Activation initiale des 3 API | Procédure Phase 0C explicitement autorisée |
| `google_project_service.phase0` après import | État Terraform Phase 0 exclusivement |
| Lien de facturation bootstrap | État Terraform Phase 0 exclusivement |
| Configuration locale du quota ADC | Procédure locale Phase 0C, hors Terraform |
| Folder CRM, projets DEV/STAGING/PROD et leurs liens | Foundation Phase 1 exclusivement |
| API complémentaires et budgets | Foundation Phase 1, adresses disjointes |

Les inventaires d'état Phase 0, Phase 1 et tout état historique doivent être comparés avant import. Toute présence du bootstrap dans un état différent est un NO-GO.

## Contrat API

- Aucune API Google Cloud ne réalise l'écriture locale du quota project ADC. `serviceusage.googleapis.com` permet la gestion des services, tandis que la permission IAM `serviceusage.services.use` est obligatoire pour désigner et utiliser le projet comme quota project.
- `cloudresourcemanager.googleapis.com` est nécessaire aux lectures et à la gestion du lifecycle/parent du projet.
- `cloudbilling.googleapis.com` est nécessaire au rattachement et à la lecture de facturation.
- Ces trois API doivent être actives avant le premier plan Phase 0 qui les utilise.
- Leur activation initiale est procédurale, puis chaque ressource est importée dans l'état Phase 0 avant plan. Terraform n'en annonce donc pas la création.
- `billingbudgets`, `iam`, `iamcredentials`, `sts` et `storage` restent en Phase 1.

## Compteurs et statut de preuve

Les nombres suivants sont des **estimations de contrat**, jamais une preuve de plan :

- création procédurale Phase 0A : **1 projet** ;
- adoption Phase 0B : **1 ressource projet importée** ;
- adoption API Phase 0C : **3 ressources service importées** ;
- premier plan Phase 0 après imports : **1 création indicative** pour le lien de facturation ;
- changements Phase 0 : **indéterminés** jusqu'au plan JSON réel ; toute replacement ou destruction sera refusée ;
- plan Phase 1 : **26 créations indicatives** ;
- total consolidé visé après application des deux états : **31 ressources Terraform gérées** — 5 en Phase 0 et 26 en Phase 1.

La création procédurale et les imports sont des événements séparés ; ils ne sont pas comptés comme des créations du plan. Aucun compteur ne devient opposable avant analyse d'un plan JSON réel.

## Sécurité et rollback

- Aucune clé de service account ; WIF/OIDC reste la cible.
- Aucun secret ou identifiant complet de facturation dans Git ou les preuves.
- Le wrapper reste limité à `SyntheticFixture` et `ContractSimulation`; `Real` échoue par défaut.
- Un import exige une autorisation explicite et n'est jamais déclenché par le code actuel.
- Après Phase 0A, un échec conserve le projet ; aucune suppression automatique.
- Après import, corriger avec le même état. Ne jamais retirer la ressource de l'état ou l'importer ailleurs sans nouvelle autorisation.
- Un déplacement futur vers le folder est effectué par le même état Phase 0 et doit être prouvé non destructif.

## Conséquences

Phase 0A est un bootstrap minimal hors Terraform, nécessaire pour casser le cycle de quota. Phase 0B établit ensuite une propriété Terraform unique et durable. La Phase 1 dépend des preuves 0A/0B/0C et reste incapable de recréer le bootstrap.
