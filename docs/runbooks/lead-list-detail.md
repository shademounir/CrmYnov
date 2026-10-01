# Liste et fiche des leads

Les rôles autorisés consultent la liste globale via `GET /leads`, avec pagination bornée à 100 éléments et tri déterministe. `GET /leads/{leadId}` refuse les identifiants inconnus. Le rôle Auditor reçoit des contacts masqués, tandis que les lectures sont corrélées dans l'audit.

Les exemples sont synthétiques. Le rollback applicatif revient au commit précédent et ne touche ni schéma ni base persistante.
