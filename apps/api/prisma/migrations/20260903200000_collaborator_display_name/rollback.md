# CRMY-170 — nom professionnel facultatif

Ajout nullable sans défaut, index, unicité ni backfill. Les collaborateurs
existants conservent NULL. Validation sur PostgreSQL éphémère : base vide et
schéma N-1 contenant un collaborateur synthétique, sans toucher aux autres champs.

Rollback applicatif : revenir au code précédent en conservant la colonne et ses
valeurs. Le code précédent ignore cette colonne nullable. Ne pas supprimer la
colonne sur une base contenant des valeurs utiles. Aucune restauration ni
suppression de données n'est exécutée par cette migration ou les tests.
