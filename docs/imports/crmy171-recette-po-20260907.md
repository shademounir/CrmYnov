# Recette CRMY-171 — observations PO du 7 septembre

Les observations ci-dessous sont celles rapportées par le Product Owner dans
la conversation et ses captures. Elles ne constituent pas une approbation de PR92.
Les changements locaux ne sont pas couverts par les checks du head
`aec30989721bc9f8cecec82e3f121cbb856b773d`.

| Scénario | Action PO réalisée / observation | Preuve technique distincte | Suite |
| --- | --- | --- | --- |
| Connexion | Identifiants saisis, premier refus, puis confirmation « connecté » | API initialement arrêtée ; après relance, santé 200 et connexion Web 201. Campus accessible dans le navigateur | Acquis, ne pas imposer une nouvelle connexion pour la recette |
| Configuration | Charger puis sélectionner Recette PO A ; captures v10, désactivé, intervalle 5, non affecté | PostgreSQL : v10 et connecteur désactivé | Conserver versions et données |
| Simulation | Clic Simuler ; succès affiché, quatre zéros, « Mode non renseigné », « Configuration v— » | PostgreSQL : 1 Lead, 1 soumission, 2 reçus, 15 audits, inchangés par rapport à la référence ; aucune exécution pour cette configuration | Sans écriture confirmé techniquement ; restitution incorrecte, correction dédiée |
| Ergonomie | Captures des six sections ; libellés de mapping tronqués, contenu sous topbar | Capture utilisateur, pas une mesure exhaustive de focus/contraste ou des trois largeurs | Revue responsive finale à compléter |
| Google réel — lecture et simulation | Le PO a autorisé la source et confirmé son partage au compte lecteur ; aucune cellule n'a été modifiée | Accès par identité dédiée impersonnée, scope lecture seule, plage bornée ; simulation : 5 lues, 5 admissibles, 0 à revoir, 0 mutation | Lecture réelle et simulation acquises, distinctes de l'import |
| Premier import Google borné | Le PO a ensuite constaté personnellement les cinq nouveaux Leads, soit six Leads visibles avec le Lead préexistant | Run terminé : 5 créés, 0 doublon/revue/ignoré ; cinq identités locales, provenances et audits métier ; tous UNASSIGNED | Acquis pour ce lot borné seulement |
| Rejeu Google borné | Le PO a constaté personnellement qu'aucun Lead supplémentaire n'était visible | Run terminé : 0 créé, 5 doublons ; delta métier nul sur Leads, identités, provenance et audit de traitement | Idempotence du lot acquise |
| Affectation automatique et ordonnancement continu | Aucun retour PO les validant personnellement dans cette recette Google | Les preuves synthétiques restent documentées séparément ; le lot réel est resté UNASSIGNED et le connecteur est désactivé | Non validés personnellement par le PO |
| Erreurs et désactivation | Le PO n'a pas rejoué un scénario d'erreur ; l'état final désactivé a été conservé | Une tentative sans capacité Google a échoué sans écriture ; la sélection de worker est corrigée et doit repasser les gates | Désactivation technique acquise ; UX d'erreur à revoir |

## Correction de la simulation

La page fabriquait une exécution d'import à partir de la réponse de simulation :
elle perdait `rows` et `mapped`, inventait des zéros pour des résultats non
calculés et omettait le déclencheur/version. Le panneau de simulation est désormais
distinct de l'historique : lignes lues, admissibles, à vérifier, version enregistrée
sélectionnée et indicateur simulé/réel retourné par le serveur. Il précise que
les doublons et affectations ne sont pas prédits par cette simulation.

Une réponse incomplète/incohérente est refusée, jamais convertie en succès à zéro.
Une nouvelle action efface la simulation précédente ; les garde-fous contre les
réponses tardives restent en place. Aucun contrat métier ou stockage historique
modifié pour cette correction. Les tests DOM/unitaires restent des preuves
techniques, pas une validation personnelle du PO.

## Limites de livraison

## Vérifications locales de la restitution

- Suite Web complète : 137 tests réussis, aucun ignoré, après correction des
  compteurs et maintien de l'historique lors d'une simulation.
- Les cas de simulation vide, admissible, à revoir, simulée ou réelle sont
  testés avec des réponses synthétiques. Une réponse incohérente est refusée.
- L'inférence du tableau de cas de test a été corrigée par des objets nommés,
  sans assertion forcée ni modification des valeurs métier.
- Ces résultats ne prouvent ni un accès Google réel ni une validation visuelle
  personnelle du PO. Les autres gates du diff final restent à renouveler.

## Publication

PR92 doit rester Draft/manual-po. La publication nécessite les gates locaux
sur le diff final, puis CI/Sonar et audits liés au nouveau SHA. La revue visuelle
des corrections reste à terminer sans rejouer les étapes PO acquises. Aucun
nouvel accès Sheets, accès Zapier réel, modification du Sheet ou approbation par l'agent.

## Recette Google bornée — limites explicites

La source est restée identique entre lecture, import et rejeu d'après ses
empreintes techniques ; aucune valeur de cellule n'est copiée dans ce document.
Les colonnes téléphoniques ambiguës restent hors du champ CRM : aucun numéro ni
préfixe n'est inventé. Cette recette ne prouve pas une arrivée naturelle future,
un cycle continu de cinq minutes ou une affectation automatique. Ces preuves
sont couvertes avec un fournisseur synthétique contrôlé jusqu'à ce qu'un nouveau
lot réel, borné et explicitement approuvé soit disponible.
