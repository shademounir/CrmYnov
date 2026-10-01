# CRMY-169 — rollback applicatif

Migration additive : quatre tables nouvelles et contraintes sur tables vides,
aucune reprise ni suppression des données existantes. L'unicité est garantie
sur les nouvelles tables (configuration/version et version/permission).

Tester uniquement sur PostgreSQL éphémère avec des identités synthétiques.
Une restauration de configuration crée une nouvelle version, sans modifier
les versions ou audits antérieurs. Ne pas supprimer les tables en rollback.

Un retour au fournisseur statique pourrait réaccorder un droit retiré : il est
donc interdit comme rollback automatique. En incident, fermer les accès
protégés et corriger en avant, ou restaurer une version sous les règles en
vigueur avec validation humaine et audit. Aucun rollback SQL destructif.
