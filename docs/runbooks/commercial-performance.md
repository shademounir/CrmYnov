# Performance et activité commerciales

La route `GET /reports/commercial-performance` expose une photographie `commercial-performance-v1` calculée dans le fuseau `Africa/Casablanca`. Les rôles Manager, Admin et Super Admin voient leur périmètre autorisé. Un Conseiller ne reçoit que ses propres indicateurs et contributions.

## Contrat des indicateurs

- `contactRate` : leads principaux distincts ayant atteint `CONTACTED` ou au-delà, divisés par les leads principaux distincts du commercial. Un lead `CLOSED_LOST` est considéré contacté selon le pipeline contrôlé.
- `qualificationRate` : leads principaux distincts ayant atteint `QUALIFIED` ou `ENROLLED`, divisés par les leads principaux distincts.
- `enrollmentRate` : leads principaux distincts actuellement `ENROLLED`, divisés par les leads principaux distincts.
- `lossRate` : leads principaux distincts actuellement `CLOSED_LOST`, divisés par les leads principaux distincts.
- `activeLoad` : leads principaux distincts dans les états `PROSPECT`, `CONTACTED` ou `QUALIFIED`.
- Les contributions secondaires sont comptées séparément. Elles ne sont jamais ajoutées aux volumes ou taux principaux.
- Les médianes sont calculées en minutes sur les événements structurés existants. Une étape absente reste non calculable ; aucune date n’est fabriquée.
- Les relances futures, terminées, échues et annulées proviennent de leur état courant. Le seuil d’inactivité est explicite, borné de 1 à 2160 heures et vaut 72 heures par défaut.
- Les divisions par zéro retournent `null`. Le tri des commerciaux et les liens de drill-down sont déterministes.

## Sécurité et exploitation

Le filtrage de périmètre et l’anti-IDOR sont appliqués côté API. L’audit conserve la version, les noms des filtres et les volumes agrégés, jamais les valeurs des filtres ni l’identité d’un lead. Les tests utilisent uniquement des identités et données synthétiques.

Rollback applicatif : retirer le contrôleur, le service et la page. Aucune migration ou donnée persistante n’est concernée.
