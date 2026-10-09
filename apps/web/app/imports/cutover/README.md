# Volet des exceptions de bascule

La page conserve la distinction entre préparation, disposition d’un écart et
ingestion. Son ouverture ne lit pas la source et n’exécute aucune mutation.
« Lire les exceptions sans exécuter » relit uniquement le manifeste et son
journal d’exceptions, via le proxy authentifié de même origine.

Chaque décision concerne un UUID de cas et une empreinte de preuve exacts. Le
motif (8 à 500 caractères), la confirmation et les capacités serveur actuelles
sont obligatoires. En cas de résultat incertain, la version, le motif, la preuve
et la clé de la tentative restent figés dans la vue ; la relecture ne fabrique
pas une nouvelle décision. La confirmation affichée exige un reçu POST cohérent
puis une disposition persistée relue par GET. Une réponse HTTP 200 seule ne
suffit pas.

`QUARANTINE_PRESERVE` n’ingère pas la source, ne résout pas un reçu `REVIEW` et
ne retire aucun Lead. Les effets et lots antérieurs restent visibles comme tels.
L’observation requise après la disposition et la réconciliation sont deux
actions distinctes : aucune observation, consommation, qualification ou remise
en service automatique n’est déclenchée par ce volet. Les capacités effectives
du serveur, et non le rôle nominal, autorisent l’observation d’une suspension de
quarantaine. Les autres suspensions demeurent bloquées.

Le journal n’affiche ni payload source ni nom, adresse ou téléphone. Les longues
empreintes utilisent les mêmes cartes repliables et règles responsive que le
manifeste. Les contrats JSDOM couvrent les erreurs, la preuve et les tentatives ;
les scénarios Playwright utilisent exclusivement des routes simulées aux
largeurs 1440, 1280, 1024, 768 et 390 px. Ils ne constituent pas une ingestion ou
une qualification d’une source réelle.
