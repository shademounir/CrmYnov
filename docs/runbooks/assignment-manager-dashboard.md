# Dashboard Manager des affectations

La route UI `/manager/assignment` regroupe les indicateurs de charge, les leads non affectés et à relancer, les demandes de réaffectation en attente et les alertes du moteur. L’API `GET /assignment/dashboard` est réservée aux rôles Manager, Admin et Super Admin ; elle ne retourne ni identité de lead, ni coordonnées.

La configuration et la simulation restent dans `/admin/assignment`. Les affectations unitaires et par lot restent dans `/leads`. Une absence de règle active, un lead non affecté ou une demande en attente produit une alerte explicite ; aucun correctif automatique silencieux n’est appliqué.

Les tests utilisent exclusivement des identités et coordonnées synthétiques. Aucun connecteur, secret, environnement cloud ou stockage persistant n’est requis.
