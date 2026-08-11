## Contexte Jira

- Ticket : CRMY-XXX
- Lien :

## Périmètre

Décrire le résultat attendu et le périmètre strict de la PR.

## Changements

Décrire les fichiers et comportements modifiés.

## Critères d’acceptation

- [ ] Les critères du ticket sont couverts.
- [ ] Aucun élément hors périmètre n’est inclus.

## Preuves de tests

Indiquer les commandes exécutées et leurs résultats.

## Analyse de sécurité

- [ ] Aucun secret, identifiant ou donnée personnelle.
- [ ] Valeurs d’exemple fictives uniquement.
- [ ] Impacts RBAC, données, dépendances et infrastructure analysés.

## Impact

Décrire l’impact utilisateur, technique et opérationnel.

## Risques

Décrire les risques résiduels et leurs mesures de réduction.

## Rollback

Décrire la procédure de retour arrière sans réécriture d’historique.

## Éléments exclus

Lister explicitement ce qui n’est pas traité dans cette PR.

## Mode de gouvernance

- [ ] `automated-policy` : audit Codex lié au SHA, label `policy-approved`,
      checks verts et fusion sans bypass.
- [ ] `manual-po` : opération sensible ou PROD nécessitant une décision humaine.

`policy-approved` constitue uniquement une preuve technique automatisée et ne
doit jamais être présenté comme une approbation humaine.

## Validation Product Owner — manual-po uniquement

- [ ] Revue manuelle effectuée par le Product Owner.
- [ ] Label `po-approved` ajouté manuellement par le Product Owner.
- [ ] Toutes les conversations sont résolues.
- [ ] La branche est à jour.
- [ ] Les contrôles obligatoires sont verts.
- [ ] Auto-merge désactivé.
- [ ] Merge exclusivement manuel.

> Codex et les automatisations ne sont jamais autorisés à cocher les validations
> Product Owner ou à ajouter `po-approved`. En mode `automated-policy`, Codex
> peut ajouter `policy-approved`, passer Ready et fusionner uniquement lorsque
> tous les contrôles vérifiables sont satisfaits sans bypass.
