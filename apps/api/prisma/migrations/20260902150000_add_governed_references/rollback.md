# CRMY-44 — rollback applicatif

Migration uniquement additive, sans réécriture de lead ni backfill SQL. Les quatre
tables sont nouvelles et vides : les contraintes uniques ne rencontrent aucune
donnée préexistante. La validation s'exécute uniquement sur PostgreSQL éphémère.

Revenir à la version applicative précédente par un commit de revert revu, sans
supprimer les tables ni l'audit. Les anciens champs texte Lead restent inchangés
et l'ancienne application ignore les nouvelles tables. Aucun rollback SQL
destructif automatique : conserver références, aliases et tags pour une reprise.

Dans un test jetable, vérifier les chaînes Lead avant/après puis relire ces
champs avec l'ancien contrat. La destruction du conteneur de test ne vise que
l'instance nommée créée pour ce test, jamais un volume de recette persistant.
