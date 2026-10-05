# CRMY-162 — correctif ciblé des graphiques mobiles

## Défaut réellement observé

Le contrôle connecté DEV du source `09a7e4970a93d79b05b4b237f92b5f92da511dbd`
avec le Commercial synthétique a révélé un débordement sur sa vue personnelle :
viewport 390 px, document 421 px, bord droit du quatrième indicateur 421,14 px.
Les cinq largeurs précédemment qualifiées portaient sur la vue Manager et les
blocs secondaires ; elles ne prouvaient pas ce rendu Commercial.

À 768 px et moins, `.dashboard-page button` remplaçait le `display: grid` de
`.reporting-chart` par `inline-flex`. Les quatre indicateurs devenaient des
éléments Flex côte à côte. La cause de cascade a été confirmée indépendamment.

## Correction et périmètre

- Rétablir la grille mobile avec un sélecteur Dashboard de priorité suffisante,
  sans `!important`, changement global des boutons ou dépendance supplémentaire.
- Borner les enfants, textes et jauges de la primitive graphique partagée.
- Donner aux deux graphiques personnels un wrapper local : deux colonnes mobiles,
  labels et valeurs lisibles, jauges sur la seconde ligne et marges de figures
  adaptées. Le rendu desktop est conservé.
- Préserver intégralement les blocs Derniers leads / Points d’attention acceptés
  personnellement par l’utilisateur, les filtres, données, calculs, API, droits,
  migrations et préférences.

## Preuves avant publication

- Deux tests DOM ajoutés pour les quatre labels, valeurs, jauges, tableau alternatif
  et description ARIA, avec comptes zéro et non nuls. Ils ont échoué sur la
  structure antérieure, puis la suite ciblée a obtenu 69 PASS / 0 FAIL / 0 SKIP.
  Cette preuve DOM ne mesure pas la disposition CSS.
- ESLint des trois fichiers TypeScript ciblés : PASS, zéro avertissement.
- TypeScript Web sans émission et sans cache incremental : PASS.
- Collection des six tests Playwright : PASS. Aucun navigateur n’a été exécuté
  par cette seule collection.
- Le test responsive Manager examine maintenant aussi la primitive graphique
  partagée. Deux tests Commercial examinent les comptes zéro/non nuls à
  1440 / 1280 / 1024 / 768 / 390 px, le bornage de chaque indicateur, le clavier,
  les deux colonnes mobiles, le tableau alternatif et l’absence de KPI globaux.
  Les réponses interceptées sont synthétiques et ne prouvent pas PostgreSQL.

La CI du nouveau SHA, le build production et le rendu DEV après déploiement
restent à acquérir au moment de la rédaction. Aucun ancien résultat CI n’est
transféré à ce correctif. Le contrôle de la persistance n’est pas rejoué pour
une modification exclusivement UI ; les contrats API/backend sont inchangés.

## Livraison, réserves et retour arrière

Exécutant Codex sous `crm-ynov-po-delegation-20261001`. La validation personnelle
existante demeure limitée aux deux blocs présentés ; elle n’est pas étendue à
toute l’UI ou à la production. Publication et fusion protégées exigent les
gates et la décision déléguée du nouveau SHA exact. La prérelease rc.3 n’a pas
encore été publiée et son manifeste devra désigner le vrai source intégré.

Conserver les réserves CSV natif, retour explicite fiche → Dashboard,
ReadCommitted, qualité source durable, files legacy, WIF, alertes et pilote
Windows non signé/audio/licence. Aucun mail, appel, import, seed, reset,
restauration ou activation Sheets n’est nécessaire à cette correction.

Retour arrière par revert protégé ou plans image-only frais et revus vers la
paire compatible précédente, en préservant Gmail/récupération et les réservations
Admissions. Aucune restauration automatique ni passage STAGING/PROD.
