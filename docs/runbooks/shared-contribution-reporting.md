# Contributions partagées

`GET /reports/shared-contributions` distingue les leads et actions du responsable principal des actions d’un collaborateur autorisé. Une action secondaire exige que son auteur figure dans `collaboratorIds` et soit différent du responsable principal. Les auteurs non autorisés sont ignorés.

Les leads sont distincts par cohorte et les conversions restent exclusivement attribuées au responsable principal. Aucun calcul de prime, commission, rémunération ou classement RH. RBAC et périmètre campus sont appliqués avant agrégation ; le Conseiller ne voit que sa ligne.

Rollback : retirer le service, le contrôleur et la page. Aucune migration n’est concernée.
