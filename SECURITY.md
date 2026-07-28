# Politique de sécurité

## Versions supportées

Le projet est en initialisation Gate -1. Aucune version applicative n’est encore supportée en production.

## Signaler une vulnérabilité

Ne pas publier de vulnérabilité, secret ou donnée personnelle dans une issue publique.

Utiliser le canal privé de signalement de vulnérabilité GitHub lorsqu’il est activé. À défaut, contacter le responsable sécurité du projet par un canal interne approuvé.

Le signalement doit contenir uniquement :

- le composant concerné ;
- les étapes de reproduction minimales ;
- l’impact estimé ;
- une preuve utilisant des données fictives ;
- une proposition de réduction du risque, si disponible.

## Règles obligatoires

- Aucun secret ou identifiant réel dans le dépôt, les logs, les PR ou Jira.
- Aucun échantillon contenant des données personnelles.
- Aucune clé de service Google Cloud persistante.
- WIF/OIDC pour GitHub Actions vers Google Cloud.
- Moindre privilège et identités séparées pour DEV, STAGING et PROD.
- Contrôles négatifs RBAC/IDOR avant toute fonctionnalité exposant des données.
- Analyse des dépendances, du code, de l’IaC, des images et des secrets dans la CI.

## Gestion d’incident

En cas de secret détecté :

1. arrêter la publication ;
2. révoquer ou faire tourner le secret hors du dépôt ;
3. préserver les preuves sans recopier la valeur ;
4. analyser l’exposition ;
5. corriger par une PR dédiée ;
6. documenter le rollback et les actions préventives.

Ne jamais tenter de « nettoyer » un secret en réécrivant l’historique sans décision explicite du Product Owner et du responsable sécurité.
