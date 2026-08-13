# ADR-0006 — Propriété Terraform du projet bootstrap en Phase 0

- Statut : proposé pour revue Product Owner
- Date : 2026-08-13
- Ticket : CRMY-123
- Décideur attendu : Product Owner

## Contexte

Le projet `crmynov-bst-n7x4q2` doit devenir le projet bootstrap et quota ADC de la Foundation, sans introduire un cinquième projet permanent. Il doit pouvoir être créé avant le folder `CRM Ynov`, puis y être déplacé sans recréation. Cette livraison est exclusivement code-only : elle ne crée ni projet, ni lien de facturation, ni API, ni configuration ADC.

## Options étudiées

### A — Projet externe non géré par Terraform

Le projet est créé par une procédure hors Terraform et reste une dépendance externe.

- Avantage : démarrage simple.
- Rejet : dérive non détectée, rollback et traçabilité incomplets, gouvernance durablement partagée entre procédures manuelles et Terraform.

### B — Procédure contrôlée puis état Terraform Phase 0 dédié

La Phase 0 crée le projet par une racine Terraform dédiée. Le projet, son rattachement de facturation et les trois API minimales restent possédés par cet état. Foundation Phase 1 reçoit l'identifiant comme entrée, lit le projet et ne possède jamais la ressource `google_project` bootstrap.

- Avantages : propriétaire unique par ressource, prévention de suppression, preuve reproductible, évolution du parent par le même état et compatibilité WIF/OIDC.
- Contrainte : ordre d'exécution documenté et états distants séparés obligatoires avant toute exécution réelle.

### C — Phase 0 puis gestion conditionnelle par Foundation

La Phase 0 crée le projet, puis Foundation active conditionnellement sa gestion.

- Avantage : une seule racine finale.
- Rejet : transfert de propriété fragile, risque de double état, import conditionnel difficile à auditer et possibilité de recréation lors d'une mauvaise combinaison de variables.

## Décision

L'option **B** est retenue.

Le modèle de propriété est le suivant :

| Ressource | État propriétaire |
|---|---|
| Projet bootstrap | Phase 0 uniquement |
| Lien de facturation bootstrap | Phase 0 uniquement |
| API minimales bootstrap (Resource Manager, Billing, Service Usage) | Phase 0 uniquement |
| Folder CRM | Foundation Phase 1 uniquement |
| Projets DEV, STAGING et PROD et leurs liens de facturation | Foundation Phase 1 uniquement |
| API complémentaires bootstrap et API des environnements | Foundation Phase 1, avec adresses distinctes |
| Cinq budgets Foundation | Foundation Phase 1 uniquement |

Un projet n'est donc jamais possédé par deux ressources `google_project` ni par deux états. Les services API sont eux aussi répartis en ensembles fermés et disjoints. Aucun import vers Foundation n'est autorisé.

## Contrat d'enchaînement

1. Phase 0 reçoit les valeurs approuvées, notamment le compte de facturation hors Git.
2. Après autorisation séparée, son état dédié crée le projet au niveau de l'organisation, rattache la facturation et active exactement trois API.
3. Une procédure locale séparée peut configurer ce projet comme quota project ADC après vérification de l'identité ; cette action n'est pas une ressource Terraform.
4. Foundation Phase 1 reçoit `bootstrap_project_id`, vérifie le projet par une data source, crée le folder et les trois projets d'environnement, puis gère seulement ses ressources exclusives.
5. Après création du folder, une exécution Phase 0 séparément autorisée peut renseigner `bootstrap_parent_folder_id`. Le même état déplace le projet ; il ne le remplace pas.

Le SHA Git et les preuves expurgées relient les deux phases. Les backends Phase 0 et Phase 1 doivent utiliser des préfixes GCS distincts avant toute exécution réelle.

## Sécurité et garde-fous

- `deletion_policy = "PREVENT"` est obligatoire sur le projet bootstrap.
- Aucun compte de service ni clé JSON n'est créé ; WIF/OIDC reste la cible.
- Aucun secret, token ou identifiant complet de facturation n'entre dans Git ou dans une preuve.
- L'identité humaine, l'organisation, le project ID, la région, le SHA et l'allowlist d'API sont validés en fail-closed.
- Le mode réel du wrapper Phase 0 est désactivé par défaut et cette livraison ne contient aucun chemin d'exécution GCP autorisé.
- Une tentative concurrente ou répétée est refusée par le contrat d'exécution.

## Compteurs attendus

- Phase 0 Terraform : **5 créations** — 1 projet, 1 lien de facturation et 3 activations d'API.
- Phase 1 Foundation : **26 créations** — 1 folder, 3 projets, 3 liens de facturation, 14 activations d'API et 5 budgets.
- Total consolidé : **31 créations**.
- Configuration locale du quota project ADC : 1 opération procédurale, hors ressources Terraform et hors de la présente autorisation.

L'ancien contrat monolithique `31 create` devient donc deux contrats explicites `5 + 26`, sans conserver artificiellement `31` dans l'analyseur Phase 1.

## Rollback

Avant toute mutation, le rollback consiste à abandonner la branche. Après une future Phase 0 autorisée : désactiver toute utilisation comme quota project, conserver le projet sous `PREVENT`, corriger la cause, puis reprendre avec le même état. Une suppression de projet, un unlink de facturation ou une suppression d'état exige une autorisation Product Owner distincte. Foundation ne doit jamais importer ni supprimer le projet bootstrap pour effectuer un rollback.

## Conséquences

La Phase 1 dépend d'une Phase 0 réussie et vérifiée. Le déplacement ultérieur vers le folder est une opération gouvernée du même état Phase 0. Ce choix évite un seed permanent supplémentaire et maintient exactement quatre projets cibles.
