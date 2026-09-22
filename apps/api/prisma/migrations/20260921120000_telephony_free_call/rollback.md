# Rollback — appel libre contrôlé

Le rollback applicatif retire le pavé numérique du parcours et ignore les colonnes additives `purpose_code` et `purpose_comment`. Les valeurs éventuellement enregistrées restent conservées.

Sur une base PostgreSQL éphémère exclusivement et sans donnée utile, une migration de test distincte peut supprimer `purpose_comment` puis `purpose_code`. Aucune suppression physique n’est prévue sur une base persistante.
