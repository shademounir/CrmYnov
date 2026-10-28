# Composition de captures READ ONLY réellement acquises

Ce module hors ligne complète les vérifications existantes ; il ne construit aucun
client, job, SQL, transport, compte, droit ou image. Les 38 inputs du pilote260 et
les octets RC47 restent inchangés. Il ne remplace pas une preuve native par un JSON.

Avant de fournir une capacité locale de lecture de la clé, l'exécuteur doit vérifier
les empreintes des reçus réels dans le checkpoint scellé, les sources qualifiées et
leur protection. Le module refuse une phase de sortie initiale échouée, une exécution
non FIN, un écart de source/objectif/réseau/métadonnées/chiffrement ou une capture déjà
périmée à son heure réelle d'acquisition. La clé existante ne doit jamais être copiée,
imprimée, hachée ou exportée. Les données déchiffrées restent en mémoire ; seules les
comparaisons minimisées et leurs références doivent être conservées.

Il n'y a ni paramètre d'horloge ni appel du vérificateur natif avec une heure passée.
L'inspection d'une ancienne capture acquise fraîche ne la rend pas courante. Une
capture pool initialement périmée ou une sortie ledger échouée n'est pas admissible.
Leur job ou phase de sortie consommés ne doivent pas être rejoués. Un nouveau besoin
de preuve fraîche exige un objectif explicite qualifié et une autorité opérationnelle
fraîche ; cela ne crée ni nouveau baseline, ni cohorte, ni réimport historique.

La comparaison générale porte sur les invariants mail et droits liés aux empreintes
historiques indépendantes, les 32 appartenances actives, huit membres, quatre campagnes,
les deux Leads protégés, leur relance/rendez-vous, le journal mail et les compteurs
observés. Elle ne couvre pas à elle seule l'intégralité du portefeuille et ne récupère
pas l'ancien hash brut du pool. Le pool conserve sa réconciliation séparée avec
l'intention et l'acteur/fenêtre indépendants. Aucun resauvetage du pool n'est autorisé.

Le ledger doit correspondre exactement aux 56 migrations des octets Git RC48 protégés.
La surface métier colonnes/index/contraintes/flags RLS doit correspondre à l'inventaire
RC48 évalué dans PostgreSQL17 LOCAL. La relation `_prisma_migrations` réelle est
distinguée du ledger de fixture exclu de la surface métier attendue. Les fonctions,
triggers et politiques non observés ne sont pas déclarés compatibles.

Les transactions pool, général et ledger restent distinctes, jamais une même snapshot.
La validation PRE/POST préserve les lignes observées et l'évolution monotone permise ;
toute divergence est conservée, pas réparée automatiquement. Les résultats restent
explicitement sans acceptation native autonome, signature cryptographique du fournisseur,
préflight complet ou autorisation d'activation. Backup frais, plan image-only qualifié,
préservation de toutes les écritures, apply unique et recette réelle restent requis.
