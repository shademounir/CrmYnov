# Recette Google Sheets réelle, CRM local

## État et limite des preuves

Le transport serveur Google est disponible dans `google-sheet-source.ts` et
`google-sheets-auth.ts`. Son existence ne prouve pas un accès Google réussi.
Les tests du transport utilisent exclusivement des réponses et une paire RSA
éphémère synthétiques. Aucun credential réel ni contenu de classeur ne figure
dans ces tests. La lecture réelle, l'import local persistant, l'ordonnancement
constaté et la validation personnelle PO doivent être consignés séparément.

Le connecteur est simulé par défaut. L'activation du transport réel n'active
pas une configuration d'import ni l'affectation automatique. Les permissions
dynamiques, plafonds campus et exclusivité du canal automatique restent requis.

## Prérequis manuels, avant tout accès réel

1. Faire valider le classeur, l'onglet exact, son identifiant numérique, la plage
   rectangulaire comprenant les en-têtes, et un petit lot synthétique.
2. Utiliser un compte de service Google dédié et l'API Sheets. Toute création de
   projet, activation d'API, création de compte ou clé nécessite une autorisation
   ciblée préalable. Aucun recours implicite à un compte personnel.
3. Partager uniquement le classeur retenu avec cette identité, comme **Lecteur**.
   Google partage au niveau du classeur ; la restriction onglet/plage est aussi
   appliquée côté CRM. Ne pas publier le classeur sur Internet.
4. Conserver la liste de sources dans un chemin absolu **hors de tout worktree
   Git**, accessible uniquement aux opérateurs et au processus serveur
   nécessaires. Le chargement résout les liens et refuse un ancêtre `.git`, même
   pour un autre dépôt. Aucun secret dans les messages, logs, captures, variables
   frontend, fixtures ou rapports publiés.

Le mode recommandé utilise ADC avec impersonation explicite. Le fichier ADC est
sensible même s'il ne contient aucune clé privée de compte de service : il doit
rester hors Git, frontend, images, logs et rapports. L'identité finale est
contrôlée par le serveur et doit être le compte configuré.

Connexion locale interactive (à exécuter personnellement par l'opérateur) :

```powershell
gcloud auth application-default login casablancaynovcampus@gmail.com --scopes=https://www.googleapis.com/auth/cloud-platform --disable-quota-project
gcloud auth application-default set-quota-project crmynov-dev-n7x4q2
```

Le connecteur demande ensuite uniquement un jeton cible portant le scope
`spreadsheets.readonly`. Aucune clé JSON n'est créée. Le mode historique par clé
RSA reste compatible uniquement lorsqu'une politique explicitement approuvée
autorise déjà une clé dédiée ; il n'est pas utilisé pour cette recette.

## Configuration serveur explicite

Variables exclusivement serveur, à définir dans la procédure de lancement locale
contrôlable ; les deux chemins ne doivent pas contenir de secret dans leur nom :

```text
CRM_GOOGLE_SHEETS_ENABLED=true
CRM_GOOGLE_SHEETS_AUTH_MODE=ADC_IMPERSONATION
CRM_GOOGLE_SHEETS_IMPERSONATE_SERVICE_ACCOUNT=crm-sheets-reader@crmynov-dev-n7x4q2.iam.gserviceaccount.com
CRM_GOOGLE_SHEETS_ALLOWLIST_FILE=<chemin absolu privé hors Git>
```

Toute valeur autre que `true` pour l'opt-in laisse le transport réel désactivé.
La factory lit les fichiers au lancement, sans appel réseau. Une modification
de la liste autorisée nécessite un redémarrage contrôlé pour être prise en compte.
Exemple exclusivement synthétique du format de liste :

```json
{
  "sources": [
    {
      "workbookId": "synthetic_workbook",
      "sheetId": 0,
      "tab": "Recette synthétique",
      "range": "A1:K6"
    }
  ]
}
```

La sélection du CRM doit correspondre exactement aux quatre valeurs. Aucune
extension automatique de plage, wildcard, colonne entière ou URL arbitraire.
Le transport demande uniquement la plage autorisée par un GET Sheets et reçoit
l'identité numérique de l'onglet et ses cellules dans la même réponse. Une
identité ou un titre différents provoquent un refus contrôlé, pas un import.
Les réponses sont bornées, les redirects refusés et les erreurs expurgées.
Un échec Google ne déclenche jamais un repli vers des données simulées.
L'échange OAuth n'a pas de retry interne ; la reprise relève du mécanisme borné
d'exécution du connecteur, sans boucles de renouvellement agressives.

## Sélection de l'identité des lignes

- `EXTERNAL_ID` : conserver le contrat d'identifiant stable externe validé.
- `LOCAL_ROW` : conserver l'observation brute, y compris les positions vides ou
  invalides, pour le suivi persistant et la réconciliation. Une ligne ou un email
  ne sont pas transformés en identifiant externe. La projection métier relève du
  moteur de réconciliation ; les cellules brutes ne doivent pas être publiées.

Des en-têtes invalides restent observables en `LOCAL_ROW`, sans fabriquer des
colonnes ou des lignes métier. `EXTERNAL_ID` continue de les refuser strictement.

## Recette guidée et arrêt

Conserver les configurations historiques. Préparer une configuration distincte,
désactivée. Vérifier le canal automatique existant sans le désactiver en silence.
Après validation PO du périmètre : lecture réelle bornée, simulation sans Lead,
validation du mapping/référentiels, import du petit lot après accord, rejeu,
affectation indépendante, puis activation temporaire à 5 minutes après accord.
L'arbitrage du 7 septembre interdit toute écriture de recette dans le Sheet,
y compris l'ajout manuel d'une ligne. Observer uniquement les lignes présentes
dans le périmètre confirmé ; une nouvelle ligne ne peut provenir que du flux
source habituel, sans intervention du CRM. Les ajouts contrôlés des tests restent
exclusivement dans l'adaptateur synthétique. Ne pas utiliser un lancement manuel
pour prouver l'ordonnanceur.

À la fin, désactiver la configuration de recette et vérifier l'arrêt des nouveaux
traitements. Conserver les Leads, reçus et audits acquis. Aucun nettoyage ni
suppression de données automatique. Les modifications de code exigent de nouvelles
preuves sur le SHA publié ; PR92 reste Draft/manual-po jusqu'à décision du PO.

## Éligibilité des workers

La coordination PostgreSQL ne suffit pas à elle seule à choisir un transport :
chaque instance vérifie désormais sa capacité locale avant de prendre le bail.
Une instance simulée ignore une configuration `GOOGLE`, qui reste disponible
pour une instance portant le transport Google. La vérification et le claim sont
liés à la version courante du connecteur afin qu'une modification concurrente
ne soit pas exécutée sous une capacité périmée.

Cette vérification ne remplace aucune autorisation. L'instance capable applique
ensuite l'allowlist exacte, l'identité d'onglet, les permissions dynamiques, le
plafond campus, le fencing et les transactions habituelles. Une configuration
Google invalide est donc refusée par le moteur capable ; elle ne bascule jamais
vers le fournisseur synthétique.

## Passage en production non inclus

Avant déploiement, une décision PO/architecture reste nécessaire sur le point de
départ historique, l'étendue bornée des plages, le traitement des téléphones
ambigus et le mode de déclenchement compatible avec l'hébergement. Le chemin
recommandé utilise une identité d'exécution dédiée sans ADC personnel, un worker
toujours actif ou un déclencheur authentifié, des métriques sans données de
cellules et une restauration PostgreSQL effectivement testée. La désactivation
conserve toutes les écritures métier et d'audit ; aucun rollback ne supprime les
Leads déjà créés.

## Tests du transport

Depuis la racine du dépôt :

```text
node --import tsx --test apps/api/test/google-sheet-source.test.ts apps/api/test/google-sheets-adapter.test.ts
```

Cette commande ne prouve pas un accès au classeur Google. Les vérifications
complémentaires de sécurité, PostgreSQL, UI et couverture restent celles du diff
complet. Ne jamais réutiliser les résultats Sonar d'un ancien SHA.

## Références

- [OAuth serveur à serveur Google](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Lecture d'un classeur et restriction des champs](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get)
- [Scopes Sheets](https://developers.google.com/workspace/sheets/api/scopes)
