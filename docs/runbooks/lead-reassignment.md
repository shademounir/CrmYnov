# Réaffectation contrôlée d’un lead — CRMY-94

Le propriétaire courant crée une demande avec cible, motif, clé d’idempotence et décision explicite sur les tâches ouvertes. La propriété reste inchangée tant qu’un `MANAGER`, `ADMIN` ou `SUPER_ADMIN` distinct n’a pas approuvé. Un rejet est historisé sans mutation de propriété.

L’API refuse les accès hors ownership, l’auto-approbation, les demandes concurrentes, une cible inéligible et toute évolution du propriétaire entre demande et décision. L’ancien et le nouveau propriétaire figurent dans la timeline append-only et l’audit expurgé.

La migration est additive et testée uniquement sur PostgreSQL éphémère. Le rollback applicatif conserve les décisions historiques ; aucune base persistante, notification externe, donnée réelle ou opération cloud n’est utilisée.

## Raccordement du parcours persistant — CRMY-94, octobre 2026

Le parcours utilise la création canonique de Lead, la fiche `/leads/:id/collaborators` et la file Manager `/manager/assignment`. `GET /reassignment-requests` expose au maximum les 100 premières demandes en attente **autorisées**, après filtrage du campus canonique et des permissions. La lecture examine au maximum 1 000 demandes du périmètre, avec une ligne de détection supplémentaire ; si cette limite empêche de déterminer la file, une erreur explicite remplace tout faux état vide. Ce lot n'ajoute pas de pagination : une file dépassant le plafond affiché demeure une réserve, pas un total complet.

La création de demande et la décision ont chacune une intention idempotente : acteur, Lead, cible, motif normalisé et option de transfert pour la demande ; acteur, demande, choix, motif, version attendue et clé pour la décision. Une intention différente sous la même clé est refusée. Les permissions et l'activation actuelles sont vérifiées avant de relire un reçu historique. Le navigateur conserve la clé en cas de résultat incertain et ne renvoie aucune décision automatiquement.

La décision exige un Manager ou Administrateur autorisé **distinct du demandeur**. Le propriétaire ne change pas à la demande, ni au rejet. Une approbation compare le propriétaire et les versions courants, puis enregistre dans la même transaction PostgreSQL la décision, le propriétaire, l'activité, l'audit, le reçu, l'outbox et les notifications internes des destinataires concernés. Un refus d'audit annule ces effets ensemble. Les notifications internes persistées ne constituent pas une preuve de réception d'un e-mail.

`moveOpenTasks=true` signifie ici uniquement : transférer les relances `SCHEDULED` du propriétaire précédent, avec comparaison de l'état/propriétaire/version et incrément de version. Les relances `DUE`, `COMPLETED`, `CANCELLED`, celles d'un autre propriétaire, les auteurs historiques, rendez-vous, réservations Admissions, appels et autres tâches restent inchangés. L'interface précise cette limite ; le critère global de transfert de toutes les tâches ouvertes n'est pas déclaré satisfait. La fenêtre historique entre changement d'échéance et émission de notification par le worker n'est pas corrigée par ce lot.

La preuve automatisée dédiée doit être exécutée par `node scripts/ci/assignment-flow-postgres.mjs` : nouvelle base PostgreSQL isolée, boucle locale, marqueur nonce vérifié, 46 migrations existantes et deux producteurs API authentifiés. Aucun nouveau schéma métier n'est nécessaire. Les tests navigateur simulés doivent être rapportés séparément de cette preuve persistante et d'une acceptation esthétique.

Retour arrière applicatif : conserver les données, reçus, historiques, audits et notifications ; suspendre les producteurs concernés si la version précédente ne respecte pas ce contrat. Ne pas effacer une décision ni réaffecter automatiquement un dossier pour revenir au code antérieur. Le déploiement éventuel exige un ensemble Web/API compatible et une sauvegarde distincte ; une archive lisible n'est pas une restauration testée.
