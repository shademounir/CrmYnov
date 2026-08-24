# Recette synthétique du parcours commercial

Le test E2E `commercial-journey.e2e.test.ts` assemble, dans un seul scénario lisible, les services de création rapide, déduplication, affectation, timeline, correction compensatoire, relance, notification, collaboration et clôture.

Toutes les identités utilisent le préfixe `synthetic` et l’adresse réservée `example.invalid`. Les stores sont recréés en mémoire pour chaque exécution et aucune connexion de base de données n’est ouverte. Si la persistance Prisma est introduite dans ce scénario à l’avenir, elle devra cibler exclusivement le service PostgreSQL éphémère de CI conformément à CRMY-126.

Le scénario prouve aussi l’absence de mutation au rejeu de la création, de la correction, du scan de relances et de la lecture de notification. Les refus d’auto-approbation et d’accès à une ressource non autorisée sont vérifiés.

## Rollback

Revert du test et de ce document par PR protégée. Aucun état métier ou cloud n’est créé par la recette.
