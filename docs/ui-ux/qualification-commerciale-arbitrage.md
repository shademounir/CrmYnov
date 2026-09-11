# Qualification commerciale — constat et arbitrage PO

Date de l’analyse : 10 septembre 2026.

Cette note consolide uniquement la structure du cahier des charges V1.4.2, les catégories de l’Excel anonymisé et les contrats actuellement présents dans le dépôt. Le classeur source a été lu sans modification et aucune donnée de contact n’est reproduite ici.

## Éléments déjà établis

### Étape commerciale

Le contrat applicatif canonique est déjà cohérent et persistant :

- `PROSPECT` — Prospect ;
- `CONTACTED` — Contacté ;
- `QUALIFIED` — Qualifié ;
- `ENROLLED` — Inscrit ;
- `CLOSED_LOST` — Sans suite.

Le libellé « À contacter » affiché pour un Lead `PROSPECT` décrit la prochaine intention de travail. Il ne crée pas un sixième statut.

### Signaux observables dans l’Excel anonymisé

L’Excel ne contient pas une température Froid/Tiède/Chaud déjà définie. Il contient des signaux distincts :

- intérêt : `À qualifier`, `Moyen`, `Fort` ;
- recommandation commerciale : `Non prioritaire`, `À relancer`, `Prioritaire` ;
- prochaine action ou relance ;
- réponse à un contact ;
- statut de suivi.

Ces valeurs ne permettent pas une conversion historique automatique fiable. En particulier, l’absence de réponse n’établit ni un intérêt faible ni une température froide.

### Complétude documentaire

Le cahier des charges exige une checklist applicable et versionnée, des pièces manquantes et leur état. Le schéma Prisma possède déjà les tables de checklist et de documents. En revanche, le service métier actuellement exposé conserve encore ses checklists et événements en mémoire et construit un `requirementCode` à partir de critères sans version de catalogue explicite.

Le calcul actuel `complete = toutes les pièces VALIDÉES` est valable uniquement lorsqu’une checklist applicable existe. En l’absence de checklist, l’état doit être « Non évalué », jamais « Complet » ni « Incomplet ». Aucun pourcentage ne doit être affiché tant que le catalogue applicable et sa version ne sont pas identifiables.

### Permissions

Les mutations Lead existantes réévaluent déjà rôle, campus, propriétaire et collaboration. Le registre dynamique ne contient toutefois aucun droit spécifique à la qualification commerciale. Réutiliser silencieusement un droit d’administration de référentiel ou un rôle large rendrait la politique illisible.

## Contrat température validé par le PO

### Température

Valeurs persistantes : `UNEVALUATED`, `COLD`, `WARM`, `HOT`. La valeur initiale et celle des Leads historiques est `UNEVALUATED`.

La qualification reste manuelle. Chaque changement enregistre valeur, auteur, date, motif normalisé, commentaire facultatif et version attendue de la qualification. L’historique est append-only et le rejeu idempotent ne crée pas une seconde version.

Définitions manuelles retenues par le PO :

- Froid : faible intérêt explicitement déclaré ou projet sans échéance exploitable, avec motif saisi. Une absence de réponse seule ne suffit pas.
- Tiède : intérêt déclaré mais projet, échéance ou prochaine étape encore à préciser.
- Chaud : intérêt explicite, projet ou rentrée identifié et prochaine étape convenue et datée.
- Non évalué : aucune qualification humaine valable enregistrée.

Ces définitions guident la saisie ; elles ne déclenchent aucune classification automatique.

Le droit `lead.qualification.update` est ajouté au catalogue fermé et reste borné par les plafonds et le périmètre existants. La matrice finalement validée l’attribue à l’Admin en portée `CAMPUS` et au Super Admin en portée `GLOBAL`; les autres rôles restent inchangés et l’Auditeur demeure structurellement en lecture seule. Une configuration persistée avec l’ancien catalogue est complétée par une nouvelle version append-only, sous fence PostgreSQL, avec un audit unique de l’évolution. Cette évolution ciblée ne réinitialise aucun grant existant et n’autorise aucune capacité future par défaut.

### Complétude

États proposés :

- `NOT_EVALUATED` : aucune checklist applicable et versionnée ;
- `INCOMPLETE` : checklist applicable, au moins une pièce manquante, attendue, refusée ou expirée ;
- `TO_REVIEW` : checklist applicable, au moins une pièce reçue ou à vérifier, sans pièce bloquante ;
- `COMPLETE` : toutes les pièces exigées par la version applicable sont validées.

Le pourcentage éventuel est `pièces exigées validées / pièces exigées`, calculé seulement pour une checklist versionnée non vide. « Complet » ne signifie ni admis, ni accepté, ni inscrit.

Le catalogue doit sélectionner une version par campus, programme, niveau d’entrée, campagne/rentrée et, si nécessaire, type de candidature. Une modification crée une nouvelle version et ne recalcule pas silencieusement l’historique.

Contrat proposé, encore soumis à arbitrage :

- la sélection produit un `catalogVersionId` exact et persistant ; aucun catalogue unique, multiple ou non applicable ne peut être remplacé par une checklist générique ;
- une checklist vide, ou une checklist sans version de catalogue identifiable, reste `NOT_EVALUATED` et n’expose aucun pourcentage ;
- une pièce bloquante manquante, attendue, refusée ou expirée impose `INCOMPLETE`, même si d’autres pièces sont `TO_REVIEW` ; `TO_REVIEW` ne s’applique qu’en l’absence de pièce bloquante ;
- un dossier existant conserve son `catalogVersionId` lors de la publication d’une nouvelle version ; une réévaluation explicite crée une nouvelle version de checklist et un audit, sans réécrire l’ancienne évaluation ;
- le catalogue, ses priorités et la réévaluation doivent être raccordés à Prisma avant tout KPI réel de complétude.

### KPI

- Répartition par température : photographie des Leads distincts visibles à la date de lecture, ventilée dans les quatre valeurs, avec Non évalué visible. Les catégories totalisent la population.
- Leads chauds à relancer : Leads distincts `HOT`, non clôturés, dont la prochaine tâche ouverte est échue ou arrive dans la fenêtre choisie. Date utilisée : échéance de la tâche.
- Dossiers incomplets : Leads distincts possédant une checklist applicable en état `INCOMPLETE`. Les Leads `NOT_EVALUATED` sont publiés séparément.
- Pièces manquantes : nombre de lignes de checklist exigées en état `MANQUANT` ou `ATTENDU`, jamais présenté comme un nombre de Leads.
- Tentatives de contact : interactions de contact distinctes dans la période, séparées du nombre de Leads contactés. Un appel sans réponse ne change pas automatiquement l’étape commerciale.
- Motifs Sans suite : Leads distincts dont la clôture négative a été approuvée, groupés par motif de la décision persistée.

Chaque endpoint devra publier population, période, date utilisée, périmètre campus, numérateur, dénominateur, inconnus et règle de déduplication. Une tendance restera indisponible sans événements datés comparables.

## Réutilisation des stories UI

La matrice locale associe déjà :

- CRMY-163 à la liste, aux filtres et aux vues ;
- CRMY-164 à la fiche Lead ;
- CRMY-165 aux interactions, relances et travail quotidien ;
- CRMY-166 aux imports et documents ;
- CRMY-168 au reporting et à la qualité.

La lecture Jira authentifiée a confirmé CRMY-164 (« Refonte de la fiche lead, timeline et affectations »), rattachée à l’epic CRMY-158 et bloquée par CRMY-163, ainsi que CRMY-43 (« Modifier les informations autorisées d’un lead »), rattachée à l’epic CRMY-5. Une recherche ciblée n’a trouvé aucun doublon pour la qualification ou la température commerciale. La création de la story dédiée sous CRMY-5 et l’ajout de ses liens vers CRMY-43/CRMY-164 restent soumis à la confirmation immédiate de l’utilisateur dans l’interface Jira ; aucun lien existant n’a été supprimé ou réécrit.

## Arbitrage documentaire restant

Les définitions manuelles de température, le droit explicite et l’absence de conversion historique sont approuvés. Les quatre états de complétude, le catalogue applicable, l’ordre entre pièces bloquantes et pièces à vérifier, le traitement d’une checklist vide et l’effet d’une nouvelle version sur les dossiers existants ne le sont pas encore.

En attendant cet arbitrage, aucun état ni pourcentage documentaire réel ne doit être calculé depuis une checklist non identifiable ou un stockage uniquement en mémoire.
