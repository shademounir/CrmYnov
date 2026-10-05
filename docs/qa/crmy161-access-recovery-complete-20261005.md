# CRMY-161 — QA récupération d’accès complète

État du dossier au 5 octobre 2026 : préparation technique, pas une preuve de
release ni de déploiement. Branche `feature/CRMY-161-recovery-complete-20261005`,
base `5f27db1c776294d63e1443215d5befdb2b70dff8`. Les preuves ci-dessous portent
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

## Preuves acquises et limites

| Contrôle | Résultat obtenu | Portée / limite |
| --- | --- | --- |
| Web ciblé | **77/77 PASS** | DOM/SSR, récupération, fragments, concurrence, erreurs réseau, proxy anonyme, cookies `204`, régressions login/premier accès/invitation/shell ; pas une recette navigateur connectée. |
| API ciblée | **22/22 PASS** | Contrats locaux, persistance simulée et transport Gmail substitué ; pas une preuve PostgreSQL réelle ni d’envoi Gmail. |
| Runner / couverture | **7/7 PASS** | 5 contrats du nouveau runner et 2 contrats de couverture existants, hors Docker ; filtres et seuils canoniques inchangés. |
| Qualité locale Web | **PASS** | ESLint ciblé, TypeScript `--noEmit --incremental false`, `git diff --check` ; ne remplace pas les gates distants du futur SHA. |
| PostgreSQL à deux API | **5/5 PASS, 0 FAIL, 0 SKIP** | Deux API réelles, 46 migrations sur une base tmpfs isolée ; transport mail substitué, aucune base partagée utilisée. Source et métadonnées DI qualifiées avant/après le test ; arrêt ciblé vérifié. |
| Gmail réel / réception | **Non prouvé pour la récupération** | Les preuves historiques d’invitation ne valident pas ce nouveau mail. Aucune livraison réelle déclenchée par les tests. |
| Responsive / navigateur | **Non prouvé pour ce patch** | Pas de captures qualifiées à 1440/1280/1024/768/390 px ni d’acceptation visuelle personnelle déduite des tests. |
| CI, scans, Sonar, politique | **À obtenir sur le SHA publié** | Aucun ancien résultat ne couvre automatiquement le patch courant. |

Les tests Web ont d’abord exposé six échecs réels sur les erreurs de demande,
les deux routes anonymes et les cookies `204`, puis sont passés après correction.
Exécution Web depuis `apps/web` avec le runtime officiel Node **22.23.3** :

```text
node --import tsx --test --test-timeout=12000 test/access-recovery.test.ts test/recovery-completion.test.ts test/api-proxy.test.ts test/proxy-json.test.ts test/login-form.test.ts test/invitation.test.ts test/first-login.test.ts test/app-shell.test.ts
```

Exécution API depuis `apps/api`, même runtime officiel (22 PASS, 0 FAIL, 0 SKIP) :

```text
node --import tsx --test --test-concurrency=1 test/access-recovery.test.ts test/access-recovery-persistence.test.ts test/gmail-invitation.sender.test.ts test/permission-transaction-routes.test.ts
```

L’annotation du double de test OAuth a ensuite été normalisée pour ESLint
(`Promise.reject`, sans changement de comportement). Typage et lint finaux PASS.

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

Exécution le 5 octobre 2026, Node 22.23.3, environ 120 s ; image PostgreSQL locale
`sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`.
Manifeste compilé : 180 sources / 350 fichiers émis, SHA-256
`2afa1248b098a2a56aaed89d18d85f02657652667223ac675efe6fc795e2405c`.
Sortie TAP : SHA-256
`ad2de1601675a883d2d2306f8d2e809c27f7142e0219f572885adf4410caaac5`.
Les références privées exactes sont conservées au checkpoint, pas les tokens,
profils ou sorties Terraform dans Git. La lisibilité du manifeste n’est pas une
restauration testée. Le conteneur tmpfs est conservé arrêté et n’est pas un dump.

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

Rollback : revert protégé du code et retour à la paire d’images compatible
précédemment vérifiée. Ne pas restaurer une base pour annuler ce lot, réactiver
les sessions révoquées, réouvrir les challenges consommés ou modifier
artificiellement l’historique. Les demandes en cours doivent être prises en
compte ; un rollback applicatif n’annule pas une révocation déjà persistée.

Une fusion fonctionnelle ou un déploiement DEV ne suffit pas pour passer le
ticket Done : appliquer le [contrat de release](../runbooks/release-process.md),
avec manifeste vérifié, release protégée et contrôles du commit exact publié.
Le critère de récupération complète de CRMY-161 demeure non clôturé tant que
ses preuves et ce contrat ne sont pas satisfaits.
