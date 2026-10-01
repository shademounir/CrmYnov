# Assistant d’import code-only

Le parcours assemble profilage, mapping, prévisualisation, contrôle qualité, affectation, dry-run, confirmation explicite et rapport. Le fichier brut n’est jamais conservé par la session. La confirmation échoue tant qu’un compteur, une collision, un champ obligatoire ou une affectation n’est pas réconcilié.

Les tests utilisent exclusivement des CSV/XLSX synthétiques et une éventuelle base PostgreSQL éphémère. L’activation Forminator/Zapier, les secrets, les fichiers réels et toute base persistante restent gelés.
