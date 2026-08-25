# Migration progressive vers le MVP local persistant

Statut : audit d'architecture CRMY-150, établi sur `develop` au commit
`bb57a2f122fa4812cc8f4731530fd33c63599144`.

## Périmètre et invariants

Le chemin d'exécution local ordinaire doit devenir `Next.js -> NestJS ->
Prisma -> PostgreSQL local`. Les doubles mémoire restent autorisés uniquement
dans les tests unitaires qui les déclarent explicitement. Les parseurs peuvent
conserver des `Map` temporaires purement algorithmiques.

Le jalon utilise exclusivement des identités et données synthétiques. Il ne
requiert ni base distante, ni GCP, ni Cloud SQL, ni Identity Platform, ni
Forminator/Zapier réel, ni téléphonie réelle. Toutes les migrations restent
additives et doivent passer la politique CRMY-126 sur PostgreSQL éphémère.

## État observé

`AppModule` construit directement les services métier et les adaptateurs
locaux. Aucun `PrismaClient`, `PrismaService` ou `$transaction` n'est utilisé
dans `apps/api/src`. Le schéma Prisma décrit pourtant 37 modèles et 18
migrations existent. PostgreSQL est déclaré dans `compose.yaml` avec le volume
nommé `postgres-data`, mais l'API ne l'ouvre pas dans son chemin métier.

### Stores mémoire de production

| Domaine | État mémoire observé | Cible Prisma existante | Écart à traiter |
| --- | --- | --- | --- |
| Récupération locale | challenges, credentials | `Collaborator` seulement | ajouter credential et recovery challenge |
| Sessions | sessions | aucune | ajouter session expirante/révocable |
| Limitation locale | buckets de tentatives | aucune | conserver mémoire pour le débit d'une instance; verrou métier en base |
| Utilisateurs | users | `Collaborator` | repository Prisma, version optimiste et seed |
| Audit | events | `AuditEvent` | repository append-only et idempotence DB |
| Leads | leads, activities, correction receipts | `Lead`, `LeadActivity` | repository transactionnel et reçu de correction unique |
| Affectation | rules, decisions, history | `AssignmentRule`, `AssignmentRuleCandidate`, `AssignmentDecision` | transactions et verrou du curseur round-robin |
| Affectation en masse | completed batches | `AssignmentBatch`, `AssignmentBatchItem` | contrainte d'idempotence et transaction par lot |
| Réaffectation | requests, idempotency | `ReassignmentRequest` | décision atomique avec lead et timeline |
| Collaboration lead | requests | `LeadCollaborator` seulement | ajouter demande/décision ou clarifier son cycle |
| Clôture | requests | aucune | ajouter demande/décision de clôture |
| Relances | items | aucune | ajouter follow-up et événements associés |
| Notifications | notifications, déduplication | aucune | ajouter notification et clé de déduplication |
| Rendez-vous | appointments, events, reports, receipts | `Appointment`, `AppointmentParticipant`, `AppointmentEvent`, `InterviewReport` | repository Prisma et reçu idempotent |
| Chat | conversations, messages, versions, mentions, lectures, conversions | modèles `Chat*` | repositories Prisma et transactions message/mentions/outbox |
| Broadcasts | broadcasts, request receipts | `Broadcast`, `BroadcastRecipient` | transaction broadcast/destinataires/outbox |
| Téléphonie synthétique | calls, provider index, event receipts | modèles `Telephony*` | repository local; fournisseurs réels restent désactivés |
| Documents | checklists, métadonnées, événements | modèles `CandidateDocument*` | métadonnées Prisma; contenu temporaire reste hors DB |
| Import wizard | sessions | aucune | ajouter session de préparation expirante ou rendre le wizard stateless |
| Mapping import | versions de mappings | aucune | ajouter profil et versions immuables |
| Import | batches, provenances, occurrences | `IngestionBatch`, `LeadProvenance`, `IngestionReviewItem` | transaction import/reconciliation/audit |
| Rapports d'import | rapports, rejets, fingerprints | `ImportReport`, `ImportRejection` | repository immuable et empreinte unique |
| Revue d'import | items, receipts | `IngestionReviewItem` partiel | persister décisions et idempotence |
| Webhook synthétique | receipts, buckets | aucune | conserver désactivé; persister reçu uniquement avant activation future |
| Création rapide | receipts | `Lead` et `LeadProvenance` | transaction lead/provenance/affectation/timeline |

Les `Map` utilisés dans les parseurs CSV/XLSX, les agrégations de reporting,
les index temporaires de dry-run et la table constante des formats de documents
ne représentent pas un état durable. Ils restent légitimes et ne doivent pas
être remplacés par des accès base ligne par ligne.

### Couverture du schéma et migrations

Les migrations existantes couvrent : audit, collaborateurs et première
connexion; leads et timeline; règles, décisions et lots d'affectation;
réaffectations, vues de travail et provenances; rapports d'import; chat,
mentions et contexte lead; broadcasts; métadonnées documentaires; téléphonie;
rendez-vous et entretiens.

Les trous de schéma bloquant la persistance complète sont : credentials,
sessions et récupération; relances; notifications; demandes de collaboration
et de clôture; outbox; mapping/wizard et décisions de revue d'import. Les vues
de travail sont créées par SQL mais n'ont pas de modèle Prisma typé dans le
schéma. Les migrations devront être ajoutées dans cet ordre et ne contenir ni
`DROP`, ni `TRUNCATE`, ni mutation de données.

### Pages Next.js encore alimentées par présentation

Les pages suivantes contiennent des tableaux, événements ou listes statiques
dans le chemin applicatif :

- `/leads`, `/leads/[leadId]/timeline`, `/leads/[leadId]/status` et documents;
- `/admin/assignment`, `/manager/assignment` et `/admin/telephony`;
- `/appointments`, `/chat`, `/broadcasts` et `/audit`;
- l'assistant d'import;
- funnel, performance commerciale, efficacité des sources et risques
  opérationnels.

Seuls récupération d'accès, profils/mappings/rapports d'import et le dashboard
interactif appellent déjà une API. Ces appels doivent converger vers un client
serveur commun, avec session, corrélation, erreurs expurgées et validation de
réponse. Les mocks Playwright et fixtures de tests restent isolés sous les
répertoires de tests.

## Contrats dupliqués à converger

Les types métier `Collaborator`, `LeadRecord`, `LeadActivityRecord`,
`AppointmentRecord`, `AuditEvent`, `StoredBroadcast` et les types `Chat*`
reproduisent des colonnes Prisma sous forme de chaînes libres. Prisma ne doit
pas devenir le contrat HTTP : les DTO et règles métier restent indépendants,
mais un mapper unique par agrégat convertit explicitement les lignes Prisma.

Les reçus d'idempotence en `Map` doublonnent plusieurs contraintes déjà prévues
en base (`AuditEvent.idempotencyKey`, `IngestionBatch.idempotencyKey`,
`AssignmentBatch.idempotencyKey`, `AssignmentDecision.eventKey`). Les futurs
reçus manquants utilisent des index uniques, jamais un cache comme source de
vérité.

## Frontières transactionnelles obligatoires

| Commande métier | Écritures atomiques minimales |
| --- | --- |
| Seed identité | collaborator + credential + audit |
| Connexion/renouvellement | credential check + session + audit |
| Révocation/changement de rôle | collaborator version + sessions révoquées + audit |
| Création de lead | lead + provenance + affectation + timeline + audit + outbox |
| Activité/correction | activity append-only + projection lead + audit + outbox |
| Affectation round-robin | verrou règle/candidat + décision unique + lead + timeline + outbox |
| Réaffectation/clôture | demande/décision + lead + timeline + audit + outbox |
| Relance/rendez-vous | agrégat + événement + notification/outbox + audit |
| Message/mention/broadcast | message ou broadcast + destinataires/mentions + outbox + audit |
| Confirmation d'import | batch + leads/provenances/revue + rapport/rejets + audit + outbox |

Les commandes utilisent une transaction Prisma explicite. La concurrence est
arbitrée par index unique, version optimiste ou verrou PostgreSQL ciblé; elle ne
repose jamais sur un verrou en mémoire. Une violation unique est relue pour
retourner le résultat idempotent ou un conflit métier stable.

## Outbox locale

Une table additive `LocalOutboxEvent` portera une clé d'idempotence unique, le
type, une charge utile minimisée, le statut `PENDING`, `PROCESSING`, `DELIVERED`
ou `FAILED`, le nombre de tentatives, `availableAt`, un lease borné et les
horodatages. Le worker revendique un petit lot avec verrou concurrent, publie
uniquement vers des adaptateurs locaux et enregistre le résultat. Au
redémarrage, un lease expiré redevient disponible. Aucun payload ne doit
contenir de nom, email, téléphone ou texte libre candidat.

## Ordre de migration sans big-bang

1. **CRMY-150 — architecture** : présent document et inventaire vérifiable.
2. **CRMY-151 — identité** : socle Prisma partagé, seed, credentials, sessions,
   récupération et RBAC. Conserver les doubles mémoire pour tests unitaires.
3. **CRMY-152 — cœur Lead** : leads, timeline, affectation, collaboration,
   réaffectation et clôture; exposer des repositories transactionnels.
4. **CRMY-153 — interactions/outbox** : relances, rendez-vous, notifications,
   chat, broadcast et téléphonie synthétique sur le socle lead persistant.
5. **CRMY-154 — imports** : mapping, dry-run et confirmation transactionnelle;
   peut progresser après CRMY-152 en parallèle conceptuel de CRMY-153.
6. **CRMY-155 — reporting** : requêtes persistantes après interactions et
   imports afin de ne pas reconstruire deux fois les projections.
7. **CRMY-156 — UI/API** : supprimer les données de présentation des chemins
   ordinaires après stabilisation des contrats API persistants.
8. **CRMY-157 — recette** : Docker persistant, redémarrage, rejeu, deux
   instances et nettoyage sécurisé.

Chaque lot bascule un agrégat complet derrière une interface de repository. Un
mode local ne peut pas mélanger mémoire et Prisma pour le même agrégat : la
sélection est explicite au démarrage et échoue si `DATABASE_URL` n'identifie pas
PostgreSQL local. Les tests unitaires construisent volontairement leurs doubles
mémoire sans passer par `AppModule`.

## Garde-fous Docker et nettoyage

Le volume existant est `crmynov-local_postgres-data` (nom Compose dérivé du
projet et de `postgres-data`). Le futur nettoyage doit vérifier simultanément
`CRM_LOCAL_MODE=true`, le projet Compose exact `crmynov-local`, le volume exact,
une URL de base pointant vers `postgres` ou loopback, et l'absence de paramètres
SSL/distants. Il doit afficher la cible et refuser par défaut. Aucune commande
de nettoyage n'est ajoutée par CRMY-150.

## Critères de sortie du jalon global

La preuve finale doit démontrer par E2E navigateur la chaîne UI/API/PostgreSQL,
la persistance après redémarrage, le rejeu sans doublon et la livraison outbox
avec deux instances. Elle doit aussi confirmer que les stores mémoire listés
ci-dessus ne sont plus construits par le chemin local ordinaire, tout en gardant
les doubles de tests explicites et les `Map` algorithmiques.
