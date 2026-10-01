# CRMY-171 Mise en service Google Sheets ultérieure

## État actuel

Développement synthétique en cours. Ni la connexion au compte de service réel ni le job autonome ne sont validés. Les tests de l'adaptateur injectent leur transport et leur fournisseur de jeton ; ils ne disposent d'aucun fallback vers un accès réel. Ne pas interpréter un test simulé réussi comme une connexion Google validée.

## Préparation à valider séparément

Après livraison conforme et autorisation PO distincte, utiliser un compte de service dédié au CRM. Partager uniquement le classeur approuvé en Lecteur. Limiter l'autorisation API au scope `https://www.googleapis.com/auth/spreadsheets.readonly`. Le lien du classeur ne constitue pas une autorisation et n'est jamais utilisé comme URL de téléchargement arbitraire.

L'adaptateur construit exclusivement les URL `https://sheets.googleapis.com/v4/spreadsheets/{id}` et leur sous-ressource `values/{range}`, en GET, sans suivre les redirections. Les références officielles sont [spreadsheets.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get) et [spreadsheets.values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get).

L'authentification du compte de service doit être raccordée à un fournisseur serveur de jetons en lecture seule. Aucune clé privée, session personnelle, valeur de jeton ou credential ne doit être stocké dans la configuration JSON du connecteur, le frontend, Git, les captures ou les audits. L'adaptateur refuse de démarrer une requête sans jeton fourni ; l'intégration du fournisseur réel reste à livrer et à valider séparément, sans création de compte ou de clé pendant cette phase.

Valider ensuite campus, onglet, mapping versionné et identifiant stable de soumission. Une identité absente/divergente impose la revue sans fusion silencieuse. Prévoir une première simulation, réconcilier les comptes, puis activer un seul canal automatique conformément au cadrage en vigueur. Le secours manuel reste disponible.

## Désactivation et reprise prévues

La coordination déjà testée vérifie enabled, version, epoch, run et échéance du bail avant et après les écritures transactionnelles. Une désactivation entre deux unités empêche le worker de valider la suivante. Une unité ayant déjà verrouillé le connecteur termine sa transaction avant qu'une modification concurrente puisse obtenir ce verrou. Aucun appel réseau ne doit se trouver dans cette transaction.

Conserver les reçus, runs, provenance, audits et données CRM lors d'une désactivation. Ne pas supprimer de table ou de volume pour revenir à la version précédente. Le code d'ordonnancement, les commandes d'exploitation finales et l'UI restent à raccorder : aucune commande de lancement d'un job complet n'est annoncée à ce stade.
# Complément de validation CRMY-171 — 6 septembre 2026

L'historique conserve les exécutions enregistrées et leurs versions : `GET /scheduled-sheets/{id}/runs?page=1`, pages de 50, page entière de 1 à 10000, même périmètre/permissions à chaque lecture. Ordre `startedAt DESC, id ASC`. La réponse reste un tableau compatible. Actualiser la première page pour voir les nouvelles exécutions ; les pages ne sont pas un snapshot figé pendant de nouvelles insertions. Aucun événement n'est recalculé à partir de la configuration actuelle. Les boutons de pagination ne s'appliquent pas à la simulation.

Couverture reproductible : `npm run test:coverage`, après les dépendances verrouillées et avec Docker disponible, sans DATABASE_URL héritée. Le runner crée ses deux bases PostgreSQL tmpfs propres, vérifie leur marqueur et leur absence de tables applicatives, applique les migrations et exécute les preuves directes et HTTP dans la collecte c8. Deux API compilées écrivent chacune leurs compteurs V8 avant arrêt ; source maps et `--exclude-after-remap` associent les compteurs aux fichiers TypeScript. Aucun LCOV manuel ni assimilation d'une exécution PostgreSQL extérieure à de la couverture.

Pour le conteneur Linux local sans socket Docker, le même runner accepte uniquement les bases de test précréées sur le loopback de son namespace réseau dédié, noms fixes et marqueur de possession unique vérifié, sans table applicative préalable. `CRMY171_COVERAGE_PRECREATED=true` et `CRMY171_DATABASE_NONCE` concernent ce harnais synthétique, jamais un credential ou une base métier. Les noms de variables ne suffisent pas : le contenu du marqueur en PostgreSQL est contrôlé avant migration. Ne jamais diriger ce mode vers une prévisualisation.

Les tests de runtime peuvent utiliser `CRMY171_API_IMAGE` / `CRMY171_WEB_IMAGE` avec les identités SHA-256 locales exactes et `CRMY171_HTTP_TEST=true` pour le harnais `apps/api/test/sheet-import-http-postgres.test.ts`. Ces preuves d'images sont séparées de la couverture des sources ; aucune image distante n'est tirée implicitement. Le Web est contrôlé pour page/CSS, proxy JSON authentifié, historique persistant et refus anonyme. Conserver les JSON Trivy natifs correspondant exactement à ces images.
