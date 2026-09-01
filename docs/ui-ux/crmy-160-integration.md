# Intégration UI/UX CRMY-160

CRMY-160 intègre la direction V2 validée dans l’application Next.js réelle. Les captures de référence et de QA restent hors du dépôt conformément à la décision Product Owner.

## Inventaire livré

| Zone | Intégration | Source de données |
| --- | --- | --- |
| Shell | sidebar onyx, topbar, campus, session, notifications | navigation locale et droits contrôlés par l’API |
| Recherche globale | résultats bornés et états session/interdit/erreur | `GET /api/crm/leads` |
| Connexion | logo officiel, visibilité du mot de passe, Verr. Maj., préremplissage email local uniquement | proxy d’authentification local |
| Dashboard | période globale, fraîcheur, cinq KPI, files, priorités, pipeline, derniers leads, activité | reporting Manager et leads PostgreSQL |
| Leads | vues enregistrées, recherche, filtres combinables, provenance, pagination | `GET /api/crm/leads` |
| Fiche | actions collantes, données masquées selon rôle, liens ID-bound | `GET /api/crm/leads/:leadId` |
| Timeline | filtre par type et correction compensatoire documentée | `GET /api/crm/leads/:leadId/timeline` |

## Matrice responsive

| Contrôle | 1440 × 1024 | 1024 × 768 | 390 × 844 |
| --- | --- | --- | --- |
| Shell | complet | sidebar compacte | tiroir accessible |
| Priorités | tableau | tableau fluide | cartes verticales |
| Leads | tableau | tableau compact | cartes verticales |
| Actions | visibles | visibles | cibles ≥ 44 px |
| Débordement de page | aucun | aucun | aucun |

## Sécurité et données

- Aucune valeur statique ne remplace une réponse API dans le parcours normal.
- Les contrôles RBAC, campus et anti-IDOR restent exécutés côté NestJS.
- Les preuves locales utilisent uniquement PostgreSQL local et le seed synthétique idempotent.
- Aucun secret, mot de passe, PII, fichier candidat, endpoint cloud ou base distante n’est versionné.
