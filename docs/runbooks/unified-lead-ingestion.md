# Pipeline unifié d'ingestion des leads

## Contrat code-only

`POST /lead-ingestion/batches` accepte au plus 100 lignes, une clé d'idempotence, un profil explicite, une confirmation et un mode d'affectation. Seuls Manager, Admin et Super Admin peuvent lancer un lot. Le résultat ne contient que numéros de ligne, identifiants internes et codes de résultat ; aucune identité n'est journalisée.

Le pipeline suit : validation → normalisation → déduplication → création ou rattachement → provenance append-only → affectation des nouveaux leads → audit synthétique. La provenance sépare canal commercial, système technique, source originale, source récente, campagne, lot et identifiant externe.

Les modes d'affectation sont `UNASSIGNED`, `FIXED`, `ROUND_ROBIN` et `CONTROLLED_RANDOM`. Une affectation échouée laisse le nouveau lead non affecté et est comptabilisée ; elle ne supprime jamais le lead ni sa provenance. Un lead déjà présent conserve toujours son responsable.

## Codes fail-closed

- `identity_required`, `stable_identity_missing`, `email_invalid`, `phone_invalid`, `occurred_at_invalid` : ligne invalide ;
- `required_mapping_missing`, `historical_status_unknown`, `identity_collision`, `duplicate_without_reliable_match` : revue manuelle ;
- toute colonne ou valeur non prévue est bloquée dans l'adaptateur de profil avant cet endpoint.

## Sécurité et données

- aucune donnée réelle dans les fixtures ou la CI ;
- aucun accès à une base persistante ;
- migrations seulement sur PostgreSQL éphémère ;
- pas de lien, secret, valeur Webhook brute ou identifiant externe dans l'audit ;
- les statuts terminaux historiques sont enregistrés comme reprise et ne déclenchent pas le workflow de clôture courant.

## Rollback applicatif

Avant toute activation réelle, désactiver l'adaptateur d'entrée. Pour un lot code-only local, recréer la base éphémère et rejouer les fixtures. Toute correction d'un lot réel futur se fait par provenance compensatrice et audit, jamais par suppression silencieuse.
