# Clôtures commerciales contrôlées

Le Conseiller soumet une cible `ENROLLED` ou `CLOSED_LOST`, un motif allowlisté, un commentaire et des preuves métier non documentaires. Le statut reste inchangé tant qu'un Manager/Admin distinct n'a pas approuvé. Refus et annulation conservent le lead en traitement.

La version optimiste interdit la double décision. Chaque étape crée audit, timeline lors du changement effectif et notification interne dédupliquée. Les clôtures historiques importées ne passent pas par ce workflow. Aucun document candidat, message externe, donnée réelle, base persistante ou cloud n'est utilisé.
