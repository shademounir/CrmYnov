# Rollback applicatif

Revenir à la version applicative précédente. La table additive `audit_events` et ses index restent présents mais inutilisés afin de préserver la piste d'audit.

Toute suppression ultérieure de la table ou de ses données est destructive et requiert une PR `manual-po` distincte avec validation de la rétention CNDP.
