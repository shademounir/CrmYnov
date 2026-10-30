# RC48 : raccordement opérationnel additif V2

Cette version étend les composants image-only et READ ONLY existants. Elle ne
reconstruit ni le connecteur Sheets, ni les collecteurs SQL, ni les images RC48.
Les qualifications locales ne constituent pas une protection de source, un PRE,
un déploiement, une preuve complète par rôle ou une activation Sheets.

## Ordre fermé

1. Qualifier et protéger les sources. Protéger ensuite des objectifs concrets,
   leurs ressources, fichiers, empreintes et fenêtres réelles. Le catalogue IMAGE
   existant et le catalogue READ ONLY existant restent les seules origines ; les
   sept entrées historiques READ ONLY sont conservées à l'identique.
2. `image-only inventory-v2` réalise l'inventaire et les tests de droits sous sa
   seule portée READ ONLY. Il n'établit ni nouveau baseline métier ni PRE SQL.
3. `image-only post-create-v2` prépare le job POST distinct, sous son propre
   objectif. CREATE est unique et journalisé. Il ne lance aucun job. Un test IAM
   au niveau du projet ne prouve pas toutes les conditions sur les ressources
   enfants ou le téléchargement de l'image par l'identité d'exécution.
4. Qualifier/protéger le plan image-only, les six familles indépendantes, la
   règle de retour et le contrat statique de recette POST. Ce contrat ne contient
   aucun identifiant futur d'exécution et n'est pas une observation fraîche.
5. `image-only forward-v2` vérifie les inputs et la gouvernance, acquiert le jeton
   par le SDK officiel, puis vérifie les droits et le job POST encore inutilisé.
   Le GET POST frais est distinct du CREATE déjà FIN. Seuls les dates et la
   référence d'observation live sont renouvelées ; le contrat statique protégé
   ne change pas. Aucune collecte PRE n'est effectuée pendant une attente de CI.
6. BACKUP_READY exige les six familles réellement vérifiées et la préparation
   POST live. Il autorise uniquement la sauvegarde utile, pas les PATCHes.
   Après son succès natif, une seule nouvelle invocation prospective du même job
   GENERAL est possible sous l'autorité additive spécifique.
7. FORWARD_FINAL lie localement les véritables reçus GENERAL aux six familles
   indépendantes. Chaque PATCH API puis Web est précédé de la revalidation de
   l'identité, de la configuration, des jobs/Schedulers et du PRE SQL de moins
   de 300000 ms. La limite part de la fin SQL réelle, jamais du reçu hôte.
8. Réconcilier les opérations connues, les deux images réellement servies et la
   préservation POST distincte. Les GET publics et les réponses authentifiées du
   navigateur constituent des observations séparées. Sheets reste OFF à ce
   stade : son activation utile et ses affectations requièrent leur recette.

Le contrôleur n'effectue aucune relance mutative, aucun fallback Terraform,
aucune restauration SQL et aucun retour d'image implicite. Il peut seulement
observer une opération déjà connue dans les bornes restantes. Un INTENT ambigu
reste consommé. Toute interruption conserve les opérations et écritures acquises.

## Authentification et bornes

Les futures acquisitions SDK sont opérationnelles, distinctes de l'ancien essai
AUTH_ONLY terminé. Sous Windows : 5000 ms pour la première configuration,
3000 ms pour la configuration épinglée, 6000 ms pour le jeton, dans une enveloppe
absolue commune de 15000 ms. Les temps réellement restants priment. Aucun retry,
fallback ou réglage automatique du délai n'est permis. Le cache standard du SDK
reste le seul cache autorisé ; notre code ne persiste ni jeton ni sortie brute.

Le budget natif durable est commun : 900 s, 200 requêtes, 15 s par requête,
1 MiB par réponse, 20 MiB au total, pagination bornée. Il ne repart pas à zéro
entre sauvegarde, GENERAL, images et POST. Le dossier de session est dérivé du
journal de l'objectif protégé ; un répertoire alternatif ne permet pas de
rouvrir une session arrêtée. Les seules extensions HTTP publiques sont les GET
exacts `/health/ready` API et `/` Web sur les deux origines natives épinglées.

La gouvernance est vérifiée avant le SDK et les mutations. Le cache local
conserve la date d'observation, les restrictions et l'expiration du marqueur
effectivement vérifié ; il ne renouvelle aucune autorité pendant le PRE.
Une configuration ou un jeton réussi ne prouve pas les droits d'exécution.

## Portée des preuves

- GENERAL conserve son ancien UNKNOWN et ses journaux. La nouvelle capacité est
  séparée, définitivement consommée avant son unique POST RUN. Ledger FIN n'est
  ni renouvelé ni rejoué. Les transactions distinctes ne sont pas une snapshot.
- La récupérabilité compose les métadonnées natives complètes de sauvegarde/PITR,
  leurs dates et leur source N02, avec la preuve de restauration logique locale
  déjà acquise. Elle ne prétend pas démontrer un drill Cloud SQL :
  `nativeRecoveryProcedureQualified=false`, `nativeCloudSqlRestoreDrill=false`.
  Le backup utile reste à créer juste avant GENERAL. Aucun restore PROD n'est
  autorisé ou effectué. Un éventuel essai natif de restauration exige un périmètre
  isolé distinct ; il ne doit pas être fabriqué à partir de SUCCESSFUL seul.
- La règle de retour conserve la compatibilité historique RC44/RC48, mais lie
  également les nouvelles règles de complétion et la fermeture de source V2.
  Le retour exige un état forward connu, un nouvel inventaire et sa propre
  autorité. Il préserve les écritures ; il n'est pas implicitement autorisé après
  l'activation Sheets.
- Le POST SQL réutilise exactement les treize SELECTs GENERAL qualifiés, dans un
  job distinct. Sa comparaison prévoit uniquement les changements de catalogue
  de permissions effectivement établis par les sources RC48. Elle ne couvre pas
  tous les audits/epochs ou toutes les données métier.
- La préparation POST V2 planifie les rôles sans inventer de login avant PRE.
  Une étiquette Super Admin dans le DOM n'est pas un GET authentifié attesté.
  La réponse réelle du BFF `/api/crm/sessions/current`, ses rôles, périmètres et
  empreinte d'identité sont vérifiés séparément après le runtime. Une recette de
  session/rôle/périmètre ne prouve ni la matrice de permissions des endpoints ni
  l'acceptation visuelle/interaction de toutes les pages.

Les reçus publics restent expurgés, append-only et liés à leurs sources. Les
capacités privées PRE/POST ne sont que des références mémoire à usage unique ;
elles sont libérées sur succès comme sur refus. Aucun secret, cookie, token ou
snapshot SQL déchiffré n'est copié dans les preuves publiques.
