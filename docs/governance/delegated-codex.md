# Approbation Codex par délégation — CRMY-174

## Fondement et identité

Le PO a donné une délégation opérationnelle explicite le 1 octobre 2026 dans
la conversation CRM Ynov. Elle remplace les confirmations personnelles
systématiques dans le périmètre et les budgets convenus. L'exécutant est **Codex** ;
`shademounir` est uniquement l'identité GitHub authentifiée disponible pour
transporter ses opérations. Aucun commentaire Codex ne représente une rédaction
personnelle du PO. Une validation technique ne vaut pas acceptation esthétique.

`delegated-codex` est un troisième mode, distinct de `manual-po` et de
`automated-policy`. Les deux modes historiques gardent leurs contrats.
La délégation est versionnée dans `codex-delegation.json` : révocation par
`status: revoked`, modifications par PR protégée. Le validateur charge l'autorité
depuis le SHA de la branche protégée develop, jamais depuis le checkout de la PR.
Pour une release vers main, develop doit être inclus dans le HEAD examiné ; la
promotion de son fichier d'autorité est permise seulement à contenu identique.

## Activation initiale, sans auto-autorisation

La première PR contenant cette autorité reste sous le contrat existant. Son
propre fichier ne peut la rendre approuvable par délégation. Les protections
GitHub, y compris `enforce_admins`, restent inchangées. Aucun bypass, faux
`manual-po-decision` ou case « revue personnelle du PO » cochée par Codex.
Si ce bootstrap exige une action personnelle, présenter une seule intervention
regroupée après réussite des contrôles, puis constater sa fusion réelle.

Après cette intégration seulement, les variables `PR_APPROVAL_MODE` et
`RELEASE_APPROVAL_MODE` peuvent être explicitement positionnées à
`delegated-codex`. Un retour à `manual-po` désactive ce mode sans réécrire
l'historique. Les modifications ultérieures de l'autorité elle-même restent
soumises à une revue personnelle : la délégation ne peut étendre sa propre portée.

## Décision et procédure

1. Lire Jira, conserver les dépendances et vérifier la préparation effective.
2. Examiner le diff, le HEAD publié et la branche de base actuelle. Vérifier les
   migrations isolées, les permissions, la sécurité et les preuves applicables.
   Passer Ready pour lancer les checks définitifs, sans attester une acceptation.
3. Attendre les checks obligatoires API/Web, PostgreSQL/migrations, Sonar avec
   couverture, CodeQL, dépendances, secrets, conteneurs et IaC sur ce HEAD exact.
4. Publier un commentaire identifié **Décision automatisée par délégation — Codex**
   avec un unique marqueur `codex-delegated-decision`, schéma 1 : `executor: Codex`,
   `decision: approved`, `grantId`, `grantDigest`, numéro PR, SHA complet,
   `scopeDigest` (SHA-256 de la liste triée des chemins uniques), `checks` contenant
   le nom et l'id des derniers runs examinés, liens HTTPS de preuves, tableau
   `reservations` et texte `rollback`. `personalVisualAcceptance` et
   `productionDeploymentAuthorized` doivent être `false` : cette décision de PR
   ne vaut ni jugement visuel personnel ni apply PROD.
5. Ajouter `codex-delegated-approved` et relancer uniquement la politique read-only.
   Ne pas utiliser `po-approved`, `policy-approved` ni un marqueur humain.
6. Après politique réussie et tous les autres gates satisfaits, fusion contrôlée
   avec vérification du SHA attendu. Pas d'auto-merge natif, force-push ou bypass.

La dernière décision autorisée prévaut, y compris une révocation ou un marqueur
malformé. Un nouveau SHA, diff ou nouveau run technique exige une nouvelle
décision. Les auteurs et dates viennent de GitHub, pas du contenu déclaratif.
Une décision éditée après fusion est refusée par la preuve release.
Si un passage Ready, une relance globale ou une nouvelle exécution remplace les
ids des checks, examiner ses résultats puis publier une nouvelle décision avant
de relancer uniquement `pr-policy`. Ne jamais approuver des runs encore en cours.

Les checks de release sont activés aussi sur les PR main et les commits fusionnés
sur main pour vérifier le SHA réellement tagué, sans nouveau déploiement.
Le profil application
utilise les noms réels `container-scan (api)` et `container-scan (web)` ; aucune
réussite ancienne d'un autre SHA ne remplace ces scans. Les validateurs restent
read-only et Jira Sync reste en dry-run. `approvalValidated: true` est séparé de
`humanApproved: false` dans la preuve de release déléguée.

## Contraintes et livraison

Cette PR ne déploie rien, ne crée aucune ressource et ne change aucune permission
IAM/WIF, donnée, droit utilisateur, licence, association Windows ou connecteur.
La prérelease interne vers main n'active pas PROD : les workflows déploiement
existants restent sur dispatch explicite. Aucune nouvelle activation automatique.

Pour déployer : dossier objectif séparé (SHA/digests compatibles, environnements
et données séparés, coût autorisé, sauvegarde/restauration et rollback, accès et
alertes réellement éprouvés). Budget DEV convenu 150 USD/mois. Le pilote Windows
non signé et sa réserve audio restent distincts d'une distribution générale.
Pas de contournement IAM/WIF, clé longue durée alternative, exposition de secret,
suppression utile, réception ni capture audio, appel réel non autorisé. L'import
Sheets nouveau-seulement reste un lot séparé et désactivé avant bascule autorisée.

## Retour arrière

Avant fusion : conserver la Draft PR et les sources. Après fusion : changer le
mode vers `manual-po`, révoquer l'autorité par PR protégée ou publier un revert
protégé. Ne jamais effacer décisions, preuves, checkpoints ou données. Une
révocation bloque les nouvelles décisions et la publication des releases encore
non validées ; elle ne réécrit pas les acceptations historiques.
