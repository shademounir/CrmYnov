# Reprise historique Excel et réconciliation — CRMY-61 / CRMY-62

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
   Une colonne contenant des données après l'en-tête reste proposée même si son
   intitulé est vide ; sa lettre physique est la référence, pas un libellé inventé.
5. Examiner chaque ligne : créer un dossier, rattacher sa provenance à un dossier
   explicitement choisi dans le campus, ou l'ignorer avec motif. Une ressemblance
   de nom, d'email ou de téléphone n'autorise pas une fusion aveugle. Les champs
   réellement obligatoires non résolus restent en revue. Pour une création
   `BASELINE`, une formation ou un niveau littéralement absents restent inconnus
   (`""` dans la projection persistée), sans référence fictive. Cette exception
   ne concerne ni les nouvelles acquisitions `NEW`, ni l'effacement d'une
   information connue, ni une formule non résolue. Un statut terminal historique
   exige une résolution explicite, pas une nouvelle approbation de clôture.
   Un statut vide ou un jalon (« À qualifier », rendez-vous planifié/effectué,
   dossier ouvert) n'est pas converti silencieusement en statut CRM. Une création
   exige un statut explicitement choisi et une justification conservée. Cette
   garde s'applique aussi aux anciennes préparations non exécutées ; elle ne
   réécrit pas leur mapping ni une reprise historique déjà effectuée.
6. Confirmer explicitement les lignes décidées par lots bornés. Une décision
   sauvegardée n'est pas encore un import effectué. Après une réponse perdue,
   relire le paquet et les reçus ; ne créer ni nouvelle clé ni nouveau paquet
   pour forcer la progression.
7. Consulter le rapport durable, les exceptions et les notes de provenance dans
   la fiche du Lead. Une revue ou une ligne invalide restante bloque la bascule,
   même si d'autres lignes ont déjà un reçu. Le rapport rapproche les candidats,
   cellules littérales, formules, commentaires et annotations de l'inventaire
   source ; la somme des seuls dossiers acceptés n'est pas cette preuve.

## Avertissements, décisions et quarantaine

L'API distingue `warnings` et `blockingReasons` ; une ancienne réponse ne
fournissant que `reasons` reste en revue, sans qualification optimiste du client.
Les motifs peuvent se recouvrir : compter les dispositions exclusives des
occurrences, pas additionner les catégories d'anomalies.

| Situation | Disposition préparatoire | Condition avant confirmation |
| --- | --- | --- |
| Cycle, formation ou niveau absents littéralement | Import possible avec information inconnue | Décision explicite et autres contrôles satisfaits ; compléter ensuite par le métier |
| Responsable absent | Information inconnue, choix nécessaire | Choisir explicitement « À affecter » ou un compte éligible ; aucune redistribution automatique |
| Alias responsable inconnu ou ambigu, dont nouvelle affectation S | Rapprochement ou décision | Identité et droits vérifiés ; ne jamais revenir silencieusement à R |
| Contact invalide avec une autre coordonnée utilisable | Correction explicite ou revue | Conserver la source, justifier le champ corrigé ou retiré et rechercher les collisions |
| Aucun contact utilisable | Ligne à isoler | Motif durable ; aucune création aveugle |
| Identité en conflit, statut contradictoire, formule non confirmée | Revue ou rapprochement | Décision documentée ; une mention Doublon / ancienne inscription ne crée pas un nouvel inscrit |

Chaque occurrence conserve une disposition durable : création, rattachement
explicite, exclusion motivée ou revue. Les axes attendus/persistés du rapport
restent distincts par feuille, responsable, statut, température et cycle. Les
références et identités proposées dans une préparation privée ne sont pas des
UUID ou des droits de la cible PROD vérifiés.

## Contacts, révision d'une décision et preuve CRMY-62

Avant une création, puis à nouveau avant sa confirmation, le serveur recherche
les contacts identiques dans le campus canonique et les décisions de création
en attente. L'email est normalisé par espaces externes/casse ; le téléphone par
formatage d'un numéro unique. Aucun pays, indicatif, nom approchant ou candidature
n'est déduit. Les dossiers retirés restent concernés. Une collision impose une
réconciliation explicite ; l'erreur ne divulgue ni contact ni identifiant d'un
dossier que l'opérateur n'a pas le droit de consulter. Chaque surface est bornée
à 10 000 entrées ; un dépassement est refusé et non traité comme absence de contact.

Si un dossier apparaît après une décision sauvegardée, la confirmation refusée
ne produit aucun demi-effet. L'opérateur peut remettre **sa propre décision READY
non exécutée** en revue avec un motif et une clé de rejeu stable. La route
`POST /lead-import/bootstrap/packages/:id/rows/:rowId/reopen` réévalue session,
campus, version, `import.view` et `import.review.resolve`. Elle conserve la décision
antérieure entière, sa clé et son empreinte dans un reçu `REOPEN_ROW` et un audit
`BOOTSTRAP_ROW_REOPENED`. La nouvelle décision exige une nouvelle clé. Une ligne
acceptée, ignorée ou possédant déjà un reçu `COMMIT_ROW` n'est jamais réouverte.
Un rejeu d'une reprise déjà effectuée conserve ses droits et son reçu historiques ;
un contact légitimement partagé apparu plus tard ne déclenche pas une recomposition.

Le rapport lit dans une seule transaction les projections persistées : identité
et empreinte des occurrences source, décisions, reçus de ligne, provenances et
notes exactes (texte, espaces, colonne, auteur déclaré et cellule source). Il
vérifie le caractère `BASELINE` et la température historique des créations.
Il distingue créations, rattachements, exclusions, occurrences et dossiers cibles
distincts. Les groupes email/téléphone peuvent se chevaucher : leur somme n'est
ni un nombre de personnes uniques ni une autorisation de fusion.

Les axes source/mapping/résolution sont séparés des axes du dossier actuel.
Cycle et période restent explicites ; une vraie évolution ultérieure du statut
ou du responsable n'est pas considérée comme une altération de l'import.
L'accès aux axes actuels exige `lead.view` pour chaque dossier, en plus du droit
de lecture du paquet ; un retrait de droit les masque sans fabriquer un résultat.
Le rapport est borné à 10 000 occurrences/reçus/provenances/cibles et 100 000 notes.
Toute troncature, occurrence non résolue ou divergence bloque la bascule. Une API
ancienne ne fournissant pas la preuve détaillée n'est pas affichée comme qualifiée.

La préparation privée R9 et le comptage du classeur réel ne constituent pas une
qualification de son import. Les références, responsables et ambiguïtés restent
à rapprocher avant toute exécution PROD. Une preuve locale synthétique ne remplace
ni les gates distants du SHA livré, ni la recette raccordée, ni la qualification
STAGING. Les invitations nominatives et le classeur réel ne sont pas utilisés
pour combler ces preuves DEV/STAGING.

## Histoire, température et indicateurs

Le texte des commentaires non vides est conservé exactement, notamment espaces
significatifs, multilignes et valeurs numériques. Une cellule contenant
uniquement des espaces reste dans le snapshot et son inventaire, mais ne crée
ni note historique ni interaction. Les anciennes notes espaces-seuls ne sont
ni supprimées ni corrigées rétroactivement : le rapport les distingue comme
traces techniques préservées et vérifie leurs références et contenus exacts.
Une divergence ou un doublon n'est pas exempté de réconciliation. Une cellule
orpheline reste en quarantaine, jamais attachée à un Lead par supposition.
Une note historique possède une clé de
cellule et une provenance ; son auteur et sa date peuvent être inconnus. La date
d'import est distincte de la date d'interaction. Aucune activité commerciale,
qualification humaine, inscription contemporaine ou relance n'est fabriquée
pour combler ces absences.

La fiche affiche les notes importées séparément des événements contemporains.
La lecture est bornée à 1 000 notes et 100 provenances, avec troncature explicite ;
elle ne constitue pas une pagination exhaustive. La preuve exhaustive du paquet
reste son rapport durable borné décrit ci-dessus, et une troncature bloque la
bascule. L'édition métier peut compléter les inconnus `BASELINE` ; le serveur et
la transaction relisent le dossier courant pour refuser tout effacement d'une
valeur connue ou élargissement de cette exception aux acquisitions `NEW`.

Une température historique résolue est un fallback identifié
`HISTORICAL_BASELINE`. La première vraie qualification garde sa version 1 et
son auteur réel, et prend ensuite priorité. Les indications de cycle certaines
sont de la provenance ; les autres restent « cycle à préciser ». Une ancienne
inscription ne constitue pas à elle seule une nouvelle candidature.
Une date civile source conserve sa valeur brute, son style et l'époque du classeur.
Elle ne devient pas automatiquement un instant UTC ni la date de création du Lead.
Les cellules source doivent être relisibles avant de sauvegarder une décision.
Après confirmation, ses effets et reçus ne sont pas réécrits.

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
