# Alertes opérationnelles

`GET /reports/operational-risks` calcule le contrat `operational-risk-v1` dans le fuseau `Africa/Casablanca`.

Les seuils sont explicites et bornés : première interaction (1–720 heures), capacité (50–100 %), écart de charge (1–100 leads), risque source (1–100 %) et volume source minimal (1–1000). Le rapport couvre les leads actifs non affectés, sans interaction, les relances échues, les décisions de clôture/réaffectation en attente, la capacité configurée et les rejets/revues d’ingestion structurés.

Les rôles Manager/Admin/Super Admin seuls accèdent à la vue globale ; le périmètre campus est appliqué avant agrégation et les demandes sont recoupées avec les leads visibles. Les alertes sont descriptives : aucun score disciplinaire, décision RH, prime, commission ou calcul financier.

L’audit conserve uniquement la version, les seuils et le nombre d’alertes. Rollback : retirer le service, le contrôleur et la page ; aucune migration n’est concernée.
