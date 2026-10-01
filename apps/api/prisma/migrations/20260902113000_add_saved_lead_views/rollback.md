# Rollback applicatif — saved lead views

Revenir au commit applicatif antérieur désactive les routes et l’interface des vues enregistrées. La table additive `saved_lead_views` est alors inutilisée et ne contient aucun lead ni résultat de recherche.

Une suppression de table n’est pas automatisée : elle requiert une procédure de migration distincte, explicitement autorisée et validée sur une base PostgreSQL éphémère avant tout environnement persistant.
