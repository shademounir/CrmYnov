# CRMY-170 — rollback applicatif

Schéma additif : archived_at nullable et deux tables nouvelles, initialement vides.
Les deux index uniques portent exclusivement sur ces tables vides : aucune
collision historique possible, aucun changement de ligne existante requis.
Clé étrangère NO ACTION (défaut PostgreSQL), aucune cascade.

Validation exclusivement sur PostgreSQL éphémère synthétique, schéma vierge et
N-1. Rejeu de migration sans nouvelle modification et tests transactionnels.
Les vues privées et l'historique des grants existants restent inchangés.

Révocation et archivage sont des mutations auditables conservant les lignes.
En incident, bloquer les nouveaux endpoints de partage et corriger en avant.
Ne pas restaurer un code qui ignorerait archived_at ou des accès révoqués.
Conserver tables, reçus et audits ; aucun retour arrière destructif automatique.
