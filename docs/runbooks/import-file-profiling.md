# Profilage fail-closed des fichiers d'import

`POST /lead-import/profiles` accepte uniquement un CSV UTF-8 ou un XLSX Open XML de 5 Mio maximum. L'appel est réservé aux rôles Manager, Admin et Super Admin et ne crée aucun lead : la réponse porte toujours `mutated: false`.

## Contrôles

- cohérence extension/MIME/signature ;
- nom de fichier simple, sans chemin ni caractère NUL ;
- base64 canonique et taille déclarée exacte ;
- classeur ZIP limité à 200 entrées et 25 Mio décompressés ;
- archive chiffrée, macro, contrôle ActiveX ou lien externe refusés ;
- formule CSV/XLSX refusée et jamais évaluée ;
- encodage CSV UTF-8 strict, guillemets et en-têtes valides ;
- 50 000 lignes maximum par feuille ;
- colonne inconnue, manquante ou désordonnée refusée pour les profils connus ;
- profil `CUSTOM` systématiquement soumis à un mapping humain.

La réponse expose seulement les noms de feuilles et colonnes, les types probables, les compteurs de lignes/cellules vides et les motifs stables. Elle n'expose aucune valeur de cellule et le journal d'audit ne contient que des compteurs.

## Séquence opérateur

1. Choisir le profil attendu et déposer le fichier dans `/imports/profile`.
2. Vérifier le profil expurgé et les éventuels motifs de refus.
3. Résoudre toute colonne inconnue dans la matrice versionnée avant ingestion.
4. Lancer ultérieurement un lot confirmé via l'API d'ingestion ; le profilage seul n'autorise jamais l'import.

Les fichiers sources anonymisés utilisés pour définir les canevas restent hors du dépôt. Les tests utilisent exclusivement des valeurs et classeurs générés synthétiquement en mémoire.

## Rollback

Le profilage ne persiste ni octet source ni état métier. Un rollback applicatif consiste à retirer la route et son interface ; aucun rollback de données n'est requis.
