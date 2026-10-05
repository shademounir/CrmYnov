# CRMY-161 — QA récupération d’accès complète

État du dossier au 5 octobre 2026 : préparation technique, pas une preuve de
release ni de déploiement. Branche `feature/CRMY-161-recovery-complete-20261005`,
base `d1d4f1be7e2076fe58617bea7c589f44736699d1` après intégration explicite de
PR117 par merge, sans réintroduire son correctif dans le diff. Les preuves portent
sur le patch de travail ; elles devront être rattachées au SHA publié exact.
Exécutant : Codex, sous `crm-ynov-po-delegation-20261001`, sans attestation de
revue esthétique personnelle du PO.

## Périmètre et contrat

- Demande anonyme `POST /api/crm/access-recovery/requests`, avec email et
  `returnPath: /access-recovery/complete` ; accusé `202` commun aux comptes
  connus, inconnus, inéligibles et à un envoi incertain. Ce n’est pas une preuve
  de mail envoyé ou reçu. Infrastructure indisponible : `503`, quota : `429`.
- Complétion anonyme `POST /api/crm/access-recovery/completions`, avec token,
  même chemin de retour et nouveau secret ; succès `204` vide, sans connexion
  automatique. Révocation des anciennes sessions et challenges dans la
  transaction ; refus générique des tokens expirés, utilisés ou invalidés.
- Token aléatoire de 256 bits transmis par fragment, jamais par query. La page
  nettoie l’URL avant son utilisation ; aucun token dans le HTML SSR, les
  champs cachés, les logs ou le stockage navigateur. `no-store` et
  `no-referrer` configurés ; suppression des cookies sur le `204` du proxy.
- Secret de 14 à 128 caractères avec confirmation et politique serveur ;
  verrou de soumission, attente bornée et erreur réseau maîtrisée. Aucun
  renvoi automatique après résultat incertain.
- Pas de migration Prisma, modification de droits, dépendance ajoutée,
  changement IAM/WIF, configuration Gmail ou nouveau connecteur dans ce lot.
  Les dépendances Jira existantes restent conservées.
- Gate de livraison : `CRM_ACCESS_RECOVERY_ENABLED` doit être exactement `true`.
  Absent ou désactivé : `503 recovery_disabled` avant quota, challenge, mail ou
  mutation d'identité. DEV reçoit un booléen Terraform `access_recovery_enabled`,
  désactivé par défaut et câblé uniquement sur l'API. Aucun couplage au paramètre
  Gmail, aucun changement de secret/IAM ou de provisionnement.

## Preuves acquises et limites

| Contrôle | Résultat obtenu | Portée / limite |
| --- | --- | --- |
| Web ciblé | **77/77 PASS** | DOM/SSR, récupération, fragments, concurrence, erreurs réseau, proxy anonyme, cookies `204`, régressions login/premier accès/invitation/shell ; pas une recette navigateur connectée. |
| API ciblée | **23/23 PASS** | Contrats locaux, persistance simulée et transport Gmail substitué ; gate absent/false/ambigu sans effet et true explicite. Pas une preuve d’envoi Gmail. |
| Runner / couverture / gate DEV | **10/10 PASS** | 6 contrats runner, 2 contrats de couverture et 2 contrats Terraform DEV, hors Docker ; filtres et seuils canoniques inchangés. |
| Qualité locale Web | **PASS** | ESLint ciblé, TypeScript `--noEmit --incremental false`, `git diff --check` ; ne remplace pas les gates distants du futur SHA. |
| PostgreSQL à deux API | **6/6 PASS, 0 FAIL, 0 SKIP** | Deux API réelles, 46 migrations sur une base tmpfs isolée ; refus HTTP503 du gate avant effets puis cas activés. Transport mail substitué, aucune base partagée utilisée. Source et métadonnées DI qualifiées avant/après le test ; arrêt ciblé vérifié. |
| E2E API synthétique sans base | **9/9 PASS** | Refus503 sans autorité persistante, corrélation et absence de consommation du token mémoire ; pas de faux202 ou de fallback HTTP. |
| Gmail réel / réception | **Non prouvé pour la récupération** | Les preuves historiques d’invitation ne valident pas ce nouveau mail. Aucune livraison réelle déclenchée par les tests. |
| Responsive / navigateur | **10 nouveaux cas exécutés avec succès sur 6b82d7e** | CI Playwright job111648170346 : 51PASS/1SKIP global, les10cas récupération exécutés (1440/1280/1024/768/390px). Labels, clavier, absence de débordement, retrait du fragment et absence de token SSR ; réponses `202`/`204` simulées, aucun mail ni effet PostgreSQL. Pas d'acceptation visuelle personnelle ; renouvellement sur le nouveau HEAD après correctif E2E. |
| CI, scans, Sonar, politique | **À obtenir sur le SHA publié** | Aucun ancien résultat ne couvre automatiquement le patch courant. |

Les tests Web ont d’abord exposé six échecs réels sur les erreurs de demande,
les deux routes anonymes et les cookies `204`, puis sont passés après correction.
Exécution Web depuis `apps/web` avec le runtime officiel Node **22.23.3** :

```text
node --import tsx --test --test-timeout=12000 test/access-recovery.test.ts test/recovery-completion.test.ts test/api-proxy.test.ts test/proxy-json.test.ts test/login-form.test.ts test/invitation.test.ts test/first-login.test.ts test/app-shell.test.ts
```

Exécution API depuis `apps/api`, même runtime officiel (23 PASS, 0 FAIL, 0 SKIP) :

```text
node --import tsx --test --test-concurrency=1 test/access-recovery.test.ts test/access-recovery-persistence.test.ts test/gmail-invitation.sender.test.ts test/permission-transaction-routes.test.ts
```

L’annotation du double de test OAuth a ensuite été normalisée pour ESLint
(`Promise.reject`, sans changement de comportement). Typage et lint finaux PASS.

Sur le premier HEAD publié `6b82d7e2dcaaf1d30d3ea35033d846c12bd972bb`,
l'intégration CI job111648170186 a réellement échoué à la dernière étape E2E :
le harness historique sans `DATABASE_URL` attendait encore202. Les quatre
runners PostgreSQL, dont récupération, avaient réussi. L'attente était fausse :
le contrôleur HTTP ne doit jamais utiliser le magasin mémoire comme autorité.
Correction du seul test :503 disabled sans opt-in,503 store-unavailable avec
opt-in mais sans PostgreSQL, réponses identiques connu/inconnu, corrélation et
token/secret mémoire inchangés. Exécution directe sans génération Prisma :9PASS,
0FAIL,0SKIP, typage API et lint ciblé PASS. Aucun changement production : la
preuve PG6 ci-dessus reste applicable ; CI renouvelée sur le nouveau SHA.

## Preuve PostgreSQL acquise et réserve du quota

Le runner `scripts/ci/access-recovery-postgres.mjs` compile les sources API et
le test courant en CJS avec métadonnées DI vérifiées. Il exige une base fraîche
`crmy161_recovery_synthetic`, un marqueur nonce, une image PostgreSQL locale,
un port loopback dynamique et un conteneur tmpfs identifié. Aucun seed, reset,
volume de recette ou base DEV partagée ; arrêt ciblé du seul conteneur possédé.
La base tmpfs arrêtée n’est pas une sauvegarde.

Le test a prouvé deux API réelles, complétion concurrente unique, révocation,
rejeu refusé, rollback sur échec d’audit, quota durable partagé et incertitude
de livraison. Le délai commun de réponse de 15 secondes n’a pas été accéléré.
Seul le transport mail était substitué avant l’écoute HTTP ; la concurrence des
complétions était simultanée, les demandes de quota espacées de 150 ms.

Première preuve, avant ajout du gate, conservée historiquement : 5 PASS le
5 octobre 2026, Node 22.23.3, environ 120 s ; image PostgreSQL locale
`sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`.
Manifeste compilé : 180 sources / 350 fichiers émis, SHA-256
`2afa1248b098a2a56aaed89d18d85f02657652667223ac675efe6fc795e2405c`.
Sortie TAP : SHA-256
`ad2de1601675a883d2d2306f8d2e809c27f7142e0219f572885adf4410caaac5`.
Les références privées exactes sont conservées au checkpoint, pas les tokens,
profils ou sorties Terraform dans Git. La lisibilité du manifeste n’est pas une
restauration testée. Le conteneur tmpfs est conservé arrêté et n’est pas un dump.

Preuve renouvelée après le risque de transition identifié : 6 PASS, 0 FAIL,
0 SKIP ; départ 06:44:43 UTC, test HTTP environ 110 s, même image PostgreSQL.
Manifeste compilé courant : 180 sources / 350 fichiers émis, SHA-256
`ad1ab82af148f42a837eef7151eb7897d9d980bb8ee758d0fc481a1c5914f168`.
Sortie TAP : SHA-256
`401c748aa47351ca61cb642d25beaf5e1d6dc550f7d2a604d6fff12df1632ad8`.
Le refus HTTP503 absent/false a laissé audits, quotas, challenges, identités,
sessions et transports inchangés ; activation explicite dans le seul runner.
L'arrêt ciblé et la conservation du conteneur possédé ont été relus après sortie0.

La revue indépendante a levé le défaut de timeout OAuth : `retryConfig.retry=0`
survit aux options injectées par OAuth/Gaxios ; le signal borne aussi OAuth et
la lecture JSON. Les tests hors réseau traversent la fusion réelle des options
et vérifient une seule tentative sur `TimeoutError`. L’invalidation PostgreSQL
peut prolonger la réponse : pas de garantie de durée HTTP absolue revendiquée.

Le quota client porte sur l’IP du pair observée par l’API, sans confiance en un
en-tête transféré arbitraire. Derrière un proxy mutualisé, plusieurs personnes
peuvent donc partager ce quota. La discrimination réelle Web/Cloud Run des
clients reste à qualifier avant diffusion ; le test loopback ne la prouve pas.

## Livraison et retour arrière

Avant fusion : lecture du diff final, preuve PostgreSQL, gates requis sur le
SHA exact, audit Jira et décision déléguée distincte, puis politique protégée.
Après fusion : relever le SHA réellement intégré ; déployer des images API/Web
compatibles et vérifiées, puis contrôler santé, cookies/headers réellement
servis et parcours synthétique sans exposer de secret. La réception réelle du
mail et la première connexion avec le nouveau secret restent des preuves
séparées. Aucun changement PROD implicite, Sheets ou téléphonie activée.

Transition obligatoire : API nouvelle image avec gate false, puis Web compatible,
puis seule activation API true après convergence et preuve de refus des deux
endpoints avant activation. L'ancien Web envoyait déjà le chemin de complétion,
mais ne le servait pas : il ne doit pas déclencher de nouveau lien entre étapes.
Le gate serveur est la protection effective, pas un simple bandeau. Chaque plan
DEV doit refuser toute autre mutation ; Gmail/IAM/SQL/jobs/Scheduler conservés.

Rollback : privilégier un correctif en avant ou un retour Web borné rendant la
récupération temporairement inaccessible. L’ancienne API de récupération ne
vérifie pas l’audit/version et ne révoque pas les sessions de façon équivalente :
le seul inverse d’image API n’est pas un retour arrière de sécurité qualifié.
Avant tout inverse API, qualifier le refus des endpoints legacy et le traitement
des challenges ouverts. Ne pas restaurer une base pour annuler ce lot, réactiver
les sessions révoquées, réouvrir les challenges consommés ou modifier
artificiellement l’historique. Un rollback n’annule pas une révocation persistée.
Pour suspendre la récupération, requalifier d'abord un plan image-constant/gate
true vers false. Une ancienne image API peut ignorer ce gate : false dans son
environnement ne constitue pas une protection legacy suffisante.

Une fusion fonctionnelle ou un déploiement DEV ne suffit pas pour passer le
ticket Done : appliquer le [contrat de release](../runbooks/release-process.md),
avec manifeste vérifié, release protégée et contrôles du commit exact publié.
Le critère de récupération complète de CRMY-161 demeure non clôturé tant que
ses preuves et ce contrat ne sont pas satisfaits.
