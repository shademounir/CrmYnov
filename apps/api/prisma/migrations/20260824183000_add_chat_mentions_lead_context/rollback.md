# Rollback CRMY-86

La migration ajoute uniquement deux colonnes nullables, deux tables, des index et des clés étrangères sur les nouvelles tables. Elle ne modifie aucune donnée existante. Sur PostgreSQL éphémère, revenir au commit précédent puis recréer la base vide constitue le rollback.

Après une future activation persistante, le rollback applicatif désactive mentions, contexte lead et conversion sans supprimer leur traçabilité. Toute suppression physique nécessitera une migration destructive `manual-po` séparée.
