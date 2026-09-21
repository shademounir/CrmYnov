# Rollback — élargissement de l’état Téléphonie

Le rollback applicatif rétablit la version précédente du code tout en conservant la colonne en `VARCHAR(40)`. Cette largeur reste compatible avec toutes les valeurs historiques limitées à 24 caractères.

Une réduction en `VARCHAR(24)` n’est pas automatisée : elle exigerait d’abord une preuve que `MAX(char_length(state)) <= 24`, l’arrêt des écritures concurrentes et une migration destructive distincte. Le changement initial prend un verrou `ACCESS EXCLUSIVE` pendant la modification de métadonnées ; son acquisition doit être surveillée sur une base peuplée.
