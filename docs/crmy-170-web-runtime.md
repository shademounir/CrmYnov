# CRMY-170 — runtime Web Distroless

## Périmètre

Seul le runtime final Web est remplacé. Les stages d'installation/build Node
22.21.1 Bookworm et le lockfile restent utilisés. La configuration Next.js possède
déjà `output: "standalone"` et la racine de tracing du monorepo ; elle ne change pas.
L'image API validée n'est ni reconstruite ni modifiée par cette remédiation.

Runtime linux/amd64 :
`gcr.io/distroless/nodejs22-debian13:nonroot@sha256:9a052c12c6501f1248b682bf6d022276220cb2a65416d215e0973527394d1552`.

Le serveur minimal `apps/web/server.js` est lancé directement par
`/nodejs/bin/node`, en UID/GID 65532. Les seules copies sont le standalone tracé,
les ressources `.next/static` et `public`. Aucun shell, npm, curl ou gestionnaire
de paquets n'est requis au démarrage. Aucun paquet système n'est ajouté au runtime.

## Santé et arrêt

Le healthcheck Dockerfile et Compose utilise Node avec un timeout HTTP de
2 secondes et un timeout Docker de 3 secondes. HTTP non-2xx, erreur réseau ou
expiration renvoient le code 1 ; un succès renvoie 0. L'endpoint est
`http://127.0.0.1:3000/api/health`.
`NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3000` sont explicites.
Le processus Node reçoit directement SIGTERM, sans shell intermédiaire.

## Vérification et preuves

Les tests `apps/web/test/runtime-packaging.test.ts` protègent le digest, les
copies minimales, les permissions non-root et les healthchecks bornés.
La validation réelle doit couvrir Sharp/Next Image, SSR, hydratation, CSS,
Montserrat, appels API, authentification et parcours synthétiques aux cinq
largeurs prévues. Aucun résultat de cette validation n'est remplacé par un mock.
Les tests visuels de réponses négatives peuvent intercepter des réponses
synthétiques ; ils sont distincts des preuves PostgreSQL réelles.

Les archives d'image, inventaires de couches, JSON Trivy natifs, SBOM et preuves
d'exécution sont conservés hors Git. Le scan reprend la base figée qualifiée,
sans VEX, ignore, filtre de sévérité ni mise à jour de la base. Toute CVE
High/Critical restante bloque la publication. Les 18 CVE historiques sont
qualifiées à partir de l'inventaire final et des preuves fournisseur conservées.

La racine du conteneur reste en lecture seule. Le test Next Image du logo public
a confirmé une écriture nécessaire dans `/workspace/apps/web/.next/cache`.
Compose monte uniquement ce répertoire en tmpfs borné à 64 Mio, UID/GID 65532,
mode 0700 ; `/tmp` possède également une limite de 64 Mio. Ce cache volatil
d'optimisation des ressources publiques ne constitue pas un stockage métier et
est perdu au redémarrage, sans affecter PostgreSQL. Aucun volume préexistant, aucune
sauvegarde Docker et aucune image de référence ne sont supprimés.

La publication reste conditionnée aux validations complètes et à la couverture
instrumentée sans régression. Une PR `manual-po` reste Draft, sans approbation
automatique ni fusion.
