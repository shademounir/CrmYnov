# GENERAL : une observation prospective supplémentaire

Ce contrat additif ne réconcilie pas le RUN du 28 octobre : son UNKNOWN, son snapshot et son journal restent immuables. Aucun ancien driver ou collecteur n'est modifié. L'expiration ancienne du catalogue demeure `2026-10-29T14:35:01.178Z` ; une autorité additive avec fenêtre explicite est requise, sans prolongation silencieuse.

`runProspectiveGeneralPre` est l'entrée concrète protégée. Elle construit la gouvernance GitHub/Jira, l'authentification officielle existante, le transport natif et le consommateur. Aucun callback externe ne remplace ces contrôles ; l'hôte fournit uniquement les données épinglées et la lecture de clé en mémoire. Les auxiliaires de protocole injectables sont destinés aux tests synthétiques et ne constituent jamais une acceptation native.

## Preuve Jira native, sans substitution UI

L'autorité prospective accepte le format réellement recueilli `OFFICIAL_ATLASSIAN_CONNECTOR_NATIVE_READ` : acteur/grant, compte Atlassian et tenant/cloud exacts, UUID d'invocation, URL du tenant, CRMY-63/id10681/Task/In Review, label `codex-ready`, absence de blocage et dépendance CRMY-61 Done sont contrôlés. Les bytes sont liés au hash du marqueur frais ; l'âge maximal reste 600 000 ms et borne la lease.

Ce reçu natif ne contient ni `schemaVersion` ni claim UI : ces champs ne sont pas fabriqués ou ajoutés aux anciens reçus. Le validateur produit sa propre projection versionnée, explicitement sans signature cryptographique du fournisseur et sans approbation humaine personnelle. L'ancien validateur UI reste inchangé ; cette autorité n'offre aucun fallback ni ré-étiquetage vers UI.

Les lectures de source et les polls d'opération/sortie restent séquentiels, arrêtés au premier refus et bornés, via récursion limitée. Aucun parallélisme de GCP, suppression de règle, exclusion ou changement de seuil de contrôle n'est introduit.

## Bornes et refus

- Une capacité déterminée par le reçu humain, un dossier d'évidence fixe, un claim permanent `wx`/`fsync`, un INTENT distinct avant l'unique POST. Aucun faux CREATE, copie de journal, reset, suppression du claim ou réinitialisation.
- Même projet/région/job/UID/objectif/source/image/bundle/SELECTs ; aucun override. Le préflight exige un compteur natif zéro, une référence latest vide et un inventaire vide. Une omission proto3 du compteur signifie zéro ; `null` ou une valeur positive refuse avant POST. Ce garde ne prouve pas l'absence d'effet historique.
- Une seule acquisition réelle d'autorité protégée avant le premier GCP ; toutes les lectures GitHub de gouvernance précèdent cette session. Ensuite, les mêmes reçus/bytes/source/lease sont vérifiés localement avant chaque requête et chaque chunk. Aucun renouvellement pendant la session ; une expiration plus courte de la lease arrête la session.
- Budget GCP : 900 secondes depuis le premier appel, 200 requêtes, 20 pages/collection, 20 MiB au total et 1 MiB/réponse. Délai par requête et corps : minimum entre 15 secondes, budget restant et lease restante, avec abort et horloge monotone. Aucun retry de refus/timeout/ambiguïté.
- Seuls les `entries:list` HTTP 200 réellement vides peuvent être relus pour le retard normal d'ingestion de CETTE nouvelle exécution, dans les budgets et la fenêtre de fraîcheur. Une pagination, une sortie multiple ou une erreur termine la session. Aucun second POST RunJob.

La référence d'opération est persistée dès son retour valide et avant tout autre GET. L'opération CREATE connue est rejetée. La nouvelle exécution/tâche/UID/latest native, le compteur après RUN égal à un, le réseau privé, l'absence de retry et la sortie chiffrée sont contrôlés avec les validateurs existants, sans réécrire de métadonnées.

## Consommateur et preuves

L'ouverture se fait en mémoire seulement. La baseline historique, les sept bindings de l'interprétation prospective MANAGER et l'index de 19 preuves réutilisables sont épinglés. Le consommateur existant compose une configuration et ses 49 grants explicites ; il ne crée pas 49 affectations et conserve les deux lignes historiques. `compareCapturedGeneral` garde tous ses invariants.

Avant et après comparaison/persistance, le délai de 300 000 ms depuis la vraie fin SQL est contrôlé. `freshAtComparison` et l'âge décrivent uniquement cet instant. Une dérive métier produit un reçu `GENERAL-SEMANTIC-REFUSED` et un dossier concret avec blocage expurgé ; l'observation native chiffrée vérifiée n'est pas perdue et aucune acceptation métier n'est inventée.

Les sauvegardes locales contiennent des hashes, métadonnées minimisées, le record chiffré et les comparaisons/dossier expurgés. Aucun token, clé privée, environnement natif brut ou snapshot déchiffré. Les anciens SQLite sont seulement lus comme octets pour vérifier leurs empreintes, jamais ouverts comme bases.

GENERAL n'est pas un PRE global : Ledger FIN n'est pas rejoué ; aucune snapshot commune ni fraîcheur actuelle des preuves anciennes n'est prétendue. POOL, LEDGER, GENERAL, PERMISSIONS, JOB_INVENTORY, RECOVERABILITY et ROLLBACK restent distincts. Aucun backup/apply/déploiement, activation Sheets, changement IAM/Logging/mail/Scheduler ou appel téléphonique n'est autorisé par cette capacité.

Les tests de protocole/autorité sont synthétiques, sans SDK réel, SQL PROD ou Docker. Les recettes inchangées du collecteur et du bundle doivent être réutilisées par leurs empreintes ; les nouvelles assertions ne prétendent pas une recette native.
