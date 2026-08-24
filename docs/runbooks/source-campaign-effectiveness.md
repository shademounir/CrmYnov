# Efficacité des sources et campagnes

`GET /reports/source-effectiveness` retourne le contrat `source-effectiveness-v1` dans le fuseau `Africa/Casablanca`. Les ventilations sont déterministes par source, canal, campagne, formation, campus et mode de provenance.

## Formules

- volume reçu : occurrences structurées d’ingestion ; à défaut, leads distincts de la cohorte avec le marqueur `lead-cohort` ;
- taux de doublons : provenances rattachées à un lead existant / occurrences structurées ; `null` sans cette preuve ;
- taux d’incomplétude : occurrences avec champ ou mapping obligatoire manquant / occurrences structurées ; `null` sans cette preuve ;
- taux de contact : leads distincts ayant atteint Contacté ou au-delà / leads distincts du groupe ;
- taux de qualification : leads distincts ayant atteint Qualifié ou Inscrit / leads distincts du groupe ;
- taux d’inscription et de sans-suite : état courant correspondant / leads distincts du groupe ;
- délai de traitement : médiane en minutes entre la création et la première interaction structurée ; aucune date absente n’est fabriquée ;
- non affectés : leads distincts sans responsable principal ; à vérifier : occurrences en revue manuelle.

Les divisions par zéro retournent `null`. Aucun ROI, coût d’acquisition, rentabilité, prime ou commission n’est calculé sans données financières validées.

L’API limite la vue globale aux rôles Manager, Admin et Super Admin et applique le périmètre campus avant agrégation. L’audit conserve uniquement la version, les noms des filtres et les volumes agrégés. Rollback : retirer le service, le contrôleur et la page ; aucune migration n’est concernée.
