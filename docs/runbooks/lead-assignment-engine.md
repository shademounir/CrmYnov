# Moteur local d’affectation des leads — CRMY-130

Le moteur sélectionne exclusivement des collaborateurs actifs, non suspendus, non exclus et sous leur capacité déclarée. Une règle globale est obligatoire ; une surcharge peut cibler une source ou une campagne. Si les deux surcharges correspondent simultanément, le moteur refuse l’affectation avec `assignment_rule_ambiguous` jusqu’à arbitrage explicite.

`ROUND_ROBIN` utilise un curseur versionné. `CONTROLLED_RANDOM` dérive un index reproductible de l’identifiant de règle et de la clé d’événement avec SHA-256. La clé d’événement garantit l’idempotence. La simulation retourne `mutated=false` et ne crée aucune décision.

La configuration et son historique sont réservés à `MANAGER`, `ADMIN` et `SUPER_ADMIN`. Les événements d’audit ne contiennent ni coordonnées de candidat, ni secret, ni URL de base. Les adaptateurs Forminator/Zapier futurs doivent fournir une clé d’événement synthétique ou minimisée et appeler le même contrat `assign`.

La migration est additive et ne doit être appliquée que par le contrôle CI sur PostgreSQL éphémère. Le rollback applicatif revient au commit précédent et conserve les tables inutilisées ; aucune base persistante n’est contactée par cette livraison.
