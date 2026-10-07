# Reprise historique Excel — CRMY-61

Le parcours `/imports/bootstrap` prépare une reprise durable, distincte du
profiler et de l'ingestion générique. Il ne déclenche ni invitation, ni connexion
Sheets, ni répartition automatique du portefeuille.

## Périmètre et données

La décision PO du 7 octobre 2026 autorise les seules feuilles
`VISITES ET APPELS`, `LEADS YNOV.COM`, `LEADS YNOV.MA` et `JOBINTECH REACT`, avec
leur en-tête physique à la ligne 6. Les autres parties restent une preuve source,
jamais de nouvelles lignes Lead. Cette décision remplace, pour cette reprise
dédiée seulement, l'ancien profil canonique à une seule feuille décrit dans
`source-mapping.md` ; le comportement du profiler générique ne change pas.

L'import réel et les sept invitations nominatives sont réservés au futur pilote
PROD, après qualification synthétique ou anonymisée et résolution des accès,
du transport e-mail, du périmètre et du budget. Aucun classeur réel, jeton,
profil privé ou export de données ne doit être versionné. Les références privées
du snapshot figé, des 2 944 occurrences avant rapprochement et du mapping R8
restent dans le checkpoint privé, pas dans Git.

## Parcours opérateur

1. Choisir un campus réellement autorisé. Les campagnes sont des regroupements
   explicites de reprise ; sélectionner ou créer via le référentiel autorisé
   leurs équivalents, sans inventer des identifiants marketing historiques.
2. Transférer un fichier `.xlsx` d'au plus 5 MiB, par segments décodés d'au plus
   48 KiB. Chaque segment et le fichier final ont une empreinte SHA-256. Conserver
   l'identifiant du paquet dans l'URL pour reprendre sans retransfert aveugle.
3. Sceller le snapshot. Les archives et leur inflation sont bornées ; les
   formules, macros et liens ne sont jamais exécutés. Une valeur issue d'une
   formule ne vaut pas un fait métier confirmé.
4. Déclarer le mapping des quatre feuilles et les aliases des responsables
   existants, en conservant la provenance. En cas de réaffectation explicite,
   utiliser la nouvelle valeur avant l'ancienne ; une nouvelle valeur inconnue
   ne permet pas un retour silencieux à l'ancien responsable. Déclarer avant le
   mapping immuable les colonnes non reprises, avec un motif d'exclusion explicite.
   Ne jamais exclure automatiquement une colonne pour faire disparaître une anomalie.
5. Examiner chaque ligne : créer un dossier, rattacher sa provenance à un dossier
   explicitement choisi dans le campus, ou l'ignorer avec motif. Une ressemblance
   de nom, d'email ou de téléphone n'autorise pas une fusion aveugle. Les champs
   obligatoires non résolus restent en revue. Un statut terminal historique
   exige une résolution explicite, pas une nouvelle approbation de clôture.
6. Confirmer explicitement les lignes décidées par lots bornés. Une décision
   sauvegardée n'est pas encore un import effectué. Après une réponse perdue,
   relire le paquet et les reçus ; ne créer ni nouvelle clé ni nouveau paquet
   pour forcer la progression.
7. Consulter le rapport durable, les exceptions et les notes de provenance dans
   la fiche du Lead. Une revue ou une ligne invalide restante bloque la bascule,
   même si d'autres lignes ont déjà un reçu. Le rapport rapproche les candidats,
   cellules littérales, formules, commentaires et annotations de l'inventaire
   source ; la somme des seuls dossiers acceptés n'est pas cette preuve.

## Histoire, température et indicateurs

Le texte des commentaires est conservé exactement, notamment espaces,
multilignes et valeurs numériques. Une note historique possède une clé de
cellule et une provenance ; son auteur et sa date peuvent être inconnus. La date
d'import est distincte de la date d'interaction. Aucune activité commerciale,
qualification humaine, inscription contemporaine ou relance n'est fabriquée
pour combler ces absences.

Une température historique résolue est un fallback identifié
`HISTORICAL_BASELINE`. La première vraie qualification garde sa version 1 et
son auteur réel, et prend ensuite priorité. Les indications de cycle certaines
sont de la provenance ; les autres restent « cycle à préciser ». Une ancienne
inscription ne constitue pas à elle seule une nouvelle candidature.
Une date civile source conserve sa valeur brute, son style et l'époque du classeur.
Elle ne devient pas automatiquement un instant UTC ni la date de création du Lead.
Les cellules source doivent être relisibles avant de prendre une décision immuable.

Les créations historiques sont `BASELINE` ; le défaut compatible des anciennes
créations applicatives est `NEW`. Le stock du portefeuille conserve les deux.
Les acquisitions par date et les volumes reçus excluent `BASELINE`. Une nouvelle
action commerciale réelle sur un dossier repris reste observable, mais la date
d'import n'est pas utilisée comme sa réception historique ou son premier
traitement. Les définitions et partitions du reporting doivent accompagner
les compteurs ; ne pas comparer sans distinction stock et nouvelles acquisitions.

## Sécurité, concurrence et persistance

Les lectures, mutations et rejeux réévaluent la session serveur, le campus et
les permissions effectives. Les créations et rattachements vérifient aussi les
droits du dossier et les propriétaires réellement éligibles. Le premier lot
ne permet pas de confirmer la décision d'un autre opérateur.

Paquet scellé, mapping, lignes, décisions, provenance, notes, reçus et audits
sont persistants. La confirmation partage une transaction PostgreSQL avec ses
effets ; une erreur ne doit laisser ni demi-Lead ni demi-note. Un reçu ne
dispense jamais d'une nouvelle vérification des droits. Une nouvelle version
du fichier, un changement de coordonnées ou de mapping exige une réconciliation
explicite : ce n'est pas un rejeu identique garanti.

## Qualification et limites de retour arrière

Avant livraison, obtenir sur le SHA exact : contrôles parser/transfert,
UI/API connectées, refus des rôles/campus, révocation, concurrence,
transaction interrompue avant et après commit, rejeu sans effet supplémentaire,
migration sur base vide et peuplée isolée, contraintes d'unicité, rapports et
absence d'inflation des indicateurs. Les contrôles locaux ne sont pas des gates
distants et une archive lisible ne prouve pas sa restauration.
La preuve PostgreSQL isolée est raccordée à `integration-tests` et à la commande
de couverture canonique par `scripts/ci/bootstrap-import-postgres.mjs`. Elle
compile les fournisseurs de production, vérifie leurs métadonnées et utilise
une base tmpfs neuve, loopback et marquée par nonce ; aucun URL métier n'est hérité.
Un test marqué ignoré ne satisfait pas cette preuve.

La migration doit rester additive ; ne jamais réécrire une migration appliquée
ou `_prisma_migrations`. Le retour arrière normal conserve le schéma et les
données, désactive le parcours et passe par un revert protégé compatible.
Après reprise, une ancienne application non consciente de `BASELINE` peut
surestimer les acquisitions : ce rollback fonctionnel n'est donc pas qualifié
sans un adaptateur compatible ou une suspension du reporting concerné. Ne pas
supprimer les dossiers, notes, reçus ou le snapshot pour obtenir un retour vert.

Sheets reste désactivé. Sa future activation est séparée : T0 documenté après
amorçage, identité stable de soumission, historique exclu durablement et
réconciliation des arrivées entre gel Excel et ouverture. Modifier une ancienne
ligne n'est pas une nouvelle soumission.
