# Prérelease interne DEV `v0.1.0-rc.1`

Le numéro est disponible au 23 septembre 2026 mais le tag n'est créé qu'après
intégration des PR dédiées et contrôles sur le SHA exact de `develop`.

## Candidat et composants

- socle DEV actuellement déployé : `17bed5548329acc23c394b0e9830e00224718d1b` ;
- API : `sha256:0abb988860ee9191205491965580c0e32de6709eea670d6f3586f821bdb9d0d7` ;
- Web : `sha256:9581c023ceadd965485ab09457c9450bedd007fea7b4d2170b71282856610ac3` ;
- agent Windows candidat : `0.4.9-pilot`, PR98, package lié au SHA exact de la PR ;
- correction turquoise de connexion : PR99, non incluse tant que CRMY-161 reste
  bloquée par CRMY-160.

Le manifeste final sera généré avec `scripts/release-manifest/cli.mjs` sur le SHA
exact intégré. Une preuve locale ou d'une PR ne couvre jamais automatiquement ce
SHA. Le déploiement manuel DEV ne valide pas WIF ; ce blocage reste affiché.

## Matrice fonctionnelle bornée

| Page/action | Web/BFF | API et permission | Persistance | État de preuve DEV |
|---|---|---|---|---|
| Connexion / première connexion | `/`, `/api/crm/sessions`, `/first-login` | sessions, utilisateur actif et scopes | PostgreSQL sessions/credentials | Connexion synthétique prouvée ; émission nominative ajoutée dans ce lot, à déployer |
| Administration utilisateurs | `/admin/users` | `/users*`, `SUPER_ADMIN` | collaborateurs, versions d'authentification, audit | Création/listing livrés ; émission temporaire testée par code dans ce lot |
| Liste, création, fiche et édition Lead | `/leads*` | `/leads*`, permission/campus | Leads, activités et reçus | Livré et déjà recetté sur données synthétiques |
| Statut et clôtures | fiche + `/closure` | `/lead-status*`, `/closures*`, demandeur/approbateur | workflow, audit, activités | ENROLLED/CLOSED_LOST et rejeu prouvés avant fusion PR93 |
| Relances et notifications | fiche, `/notifications` | `/follow-ups*`, `/notifications*` | PostgreSQL + job idempotent | Livré ; Scheduler DEV actif, réception à échéance recettée |
| Rendez-vous | `/appointments*` | `/appointments*`, périmètre Lead | PostgreSQL + événements | Livré et recetté |
| Téléphonie sortante | fiche, `/admin/telephony`, gateway `/agent` | `/telephony*`, poste/utilisateur | commandes et événements | Pilote livré ; agent 0.4.9 en PR98, installateur non signé |
| Imports Sheets | administration imports | routes Sheets | PostgreSQL si activé | **Indisponible en DEV : Sheets désactivé** |
| Documents candidats | fiche | validation locale temporaire | stockage temporaire seulement | **Non livrable équipe : CRMY-90/Cloud Storage requis** |
| Outbox asynchrone | sans page dédiée | worker local actuel | mémoire/local selon adaptateur | **Pub/Sub non livré : CRMY-87** |
| Rapports et dashboards métier | `/manager/reports*` | endpoints reporting et scopes | lectures PostgreSQL | Disponibles, validation UI exhaustive encore progressive |

Chaque action de la recette doit couvrir succès, refus de permission/périmètre,
erreur serveur explicite et relecture après actualisation lorsque l'action écrit.
Aucune réponse visuelle ne remplace une relecture API/PostgreSQL.

## Réserves de diffusion

- agent/installateur Windows non signé : pilote interne seulement ;
- légère réserve audio connue, qualité d'appel pilote acceptée à 8/10 ;
- WIF institutionnel non démontré ; déploiement manuel distinct ;
- canal d'alerte et réception non testés tant que le destinataire manque ;
- Storage documentaire et Pub/Sub indisponibles ; Sheets désactivé ;
- compte nominatif créé uniquement après réception de la liste autorisée ;
- page connexion turquoise exclue tant que la dépendance Jira de PR99 reste ouverte.

## Guide équipe par rôle

- Admissions : accès campus, liste/fiche Lead, édition autorisée, interaction,
  relance et appel sortant ; vérifier un refus intercampus.
- Manager/Admin : affectation, rendez-vous, décision de clôture distincte du
  demandeur, notifications et rapports autorisés.
- Super Admin : création/désactivation, rôles/périmètres, émission d'accès initial
  et audit ; ne pas utiliser ce rôle pour masquer un refus métier.
- Auditeur/Lecteur : lecture seule et refus de mutation.

Les comptes nécessitent : nom, email professionnel, rôle, campus et extension SIP
éventuelle. Aucun mot de passe ne circule dans la liste de préparation.

## Sous-domaines proposés — aucun changement DNS effectué

Au 23 septembre, `crm-dev.ynov.ma` et `crm.ynov.ma` n'ont pas de réponse A/CNAME.
L'apex, `www`, MX et NS restent hors périmètre. L'architecture recommandée est un
load balancer HTTPS externe global, NEG serverless vers le Web public, IP statique
et certificat Google Certificate Manager. L'API reste privée IAM derrière le BFF.

Après choix du nom, Terraform doit produire l'autorisation DNS du certificat :
ajouter uniquement le CNAME ACME retourné par Certificate Manager, puis un A pour
le sous-domaine vers l'IP statique. Les valeurs exactes ne doivent jamais être
inventées avant le plan. Conserver `run.app` pendant la transition et comme retour
arrière.

Le Web utilise des cookies host-only `Secure`, `HttpOnly`, `SameSite=Strict` et
une origine CSRF explicitement autorisée. Le changement d'origine impose une
nouvelle association contrôlée de l'agent ; aucun jeton ou secret SIP n'est copié
automatiquement entre profils.

## Décisions externes restantes

1. liste nominative des testeurs et leurs rôles/campus/extensions ;
2. destinataire du canal d'alerte qui pourra accuser réception du test ;
3. choix et autorisation DNS (`crm-dev.ynov.ma`, puis éventuellement
   `crm.ynov.ma`).
