# CRMY-94 — message d’accès du panneau d’affectation

Lot Web-only distinct de PR114, exécuté par Codex sous la délégation
`crm-ynov-po-delegation-20261001`. Base :
`develop / 5f27db1c776294d63e1443215d5befdb2b70dff8`.
Le SHA publié et les contrôles distants sont consignés dans la PR dédiée.

## Défaut observé et correction

Sur DEV, un Commercial synthétique authentifié peut lire un Lead non affecté.
Le GET des candidats retourne effectivement HTTP403 ; le panneau présentait
ce refus comme une indisponibilité des conseillers. Le corps de cette réponse
n’a pas été récupéré et n’est pas présenté comme une preuve de code d’erreur.

Le panneau distingue maintenant HTTP401 (reconnexion), HTTP403 (droits),
HTTP503/erreur réseau (service indisponible) et une liste200 vide. Les entrées
et confirmations ne sont pas proposées après401/403. Les libellés de gestion
sont neutres ; aucune nouvelle permission, possibilité d’affectation initiale
Commercial ou demande de réaffectation d’un Lead non affecté n’est inventée.
Les réponses périmées d’un ancien Lead sont ignorées ; le changement d’état
affecté/non affecté force une relecture des candidats.

Revue indépendante : le refus de l’historique pouvait masquer celui des
candidats sur un Lead affecté. L’ordre d’affichage a été corrigé et deux tests
supplémentaires couvrent les deux GET401/403. Une demande en attente déjà lue
avec autorisation conserve son affichage sans nouvelle mutation.

## Preuves locales

- Node officiel22.23.3, depuis `apps/web` :32 tests ciblés réussis,0 échec,
  0 ignoré (`assignment-permission-feedback-dom`, `lead-assignment-workflow-dom`,
  `reassignment-workflow-dom`, `lead-read`, `lead-profile-readback-dom`).
- Typage Web complet sans génération : `tsc --noEmit --incremental false` PASS.
- ESLint des cinq fichiers Web et `git diff --check` PASS.
- Historique Git :0 type de secret,0 chemin interdit ; cinq contrats de
  sécurité du dépôt PASS. Les noms/valeurs des tests sont synthétiques.
- Relecture indépendante du diff : aucun bloqueur restant identifié après
  correction de l’ordre401/403. Ce n’est pas une acceptation visuelle humaine.

Les contrôles distants, couverture/Sonar, Playwright, build et scans propres
au nouveau SHA restent à obtenir. Aucun build local, déploiement ou nouvelle
mutation métier n’est revendiqué par ces tests DOM.

## Limites et retour arrière

Pas de changement API, schéma, migration, dépendance, droits, configuration
Cloud ou agent Windows. Les critères globaux de CRMY-94, dont l’ensemble des
tâches transférables, restent ouverts. Aucun appel, mail, seed, Sheets ou PROD.

Retour arrière : revert protégé de ce lot, reconstruction et scan de l’image
Web compatible, puis plan DEV examiné. Aucun rollback SQL ou restauration
automatique nécessaire ; conserver l’API et les données existantes.
