# Dossier candidat documentaire code-only

CRMY-147 livre le modèle de checklist, les métadonnées, le workflow de vérification et un contrat `DocumentStorageAdapter`. Les seuls contenus acceptés sont synthétiques ; l’adaptateur local écrit dans un répertoire aléatoire du dossier temporaire du système, génère le nom serveur, calcule SHA-256 et le supprime via `cleanup()`.

## Mapping initial

| Pièce | Code | Déclencheur |
| --- | --- | --- |
| Baccalauréat | `BACCALAUREAT` | toujours |
| Diplôme | `DIPLOME` | niveau supérieur/diplômé |
| Relevé de notes | `RELEVE_NOTES` | toujours |
| Pièce d’identité | `PIECE_IDENTITE` | toujours |
| Situation professionnelle | `SITUATION_PROFESSIONNELLE` | salarié/emploi/alternance |
| Bourse ou éligibilité | `BOURSE_ELIGIBILITE` | demande de bourse |
| Autre pièce contrôlée | `AUTRE_CONTROLE` | configuration ultérieure explicite |

Les états sont `MANQUANT`, `ATTENDU`, `REÇU`, `À_VÉRIFIER`, `VALIDÉ`, `REFUSÉ`, `EXPIRÉ` et `REMPLACÉ`. Le remplacement crée une nouvelle version et un événement compensatoire ; aucune suppression physique n’est exposée.

Le tableau de bord applique côté serveur la pagination déterministe et les filtres d’état, type de pièce, formation, niveau, campus et commercial. La vue Conseiller est limitée à ses affectations ou collaborations ; la vue globale est réservée aux rôles Manager/Admin. L’export exposé par le contrat reste strictement agrégé et sans PII.

## Sécurité et limites

L’allowlist locale est PDF/PNG/JPEG, avec contrôle croisé extension/MIME/signature, limite de 5 Mio, protection contre la traversée et détection synthétique EICAR. Ce contrôle n’est **pas** un antivirus de production. En l’absence d’un scanner explicitement disponible, le contrat échoue fermé. Le contenu binaire n’entre jamais dans PostgreSQL, l’audit ne contient ni nom original, ni hash, ni référence de stockage, et l’export reste agrégé.

GCS, bucket privé, URL signée, antivirus externe, rétention/purge, Cloud SQL persistant, IAM/WIF, STAGING et PROD restent gelés. Une future intégration devra fournir un adaptateur séparé, une quarantaine réelle, un scanner externe, une promotion atomique, des règles CNDP et des tests de reprise, dans une PR sensible distincte.
