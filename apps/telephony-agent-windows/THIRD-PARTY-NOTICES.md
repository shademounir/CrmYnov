# Notices tierces — paquet pilote Téléphonie CRM Ynov

Le paquet pilote utilise l’archive officielle `linphone-sdk-win64-5.5.21.zip`
(SHA-256 `1C31D2FF9782DCF8732790AAFAC12D56526CD69B6B8A79498D11802DCAC56095`).
L’agent lie dynamiquement le wrapper C# et les bibliothèques natives de cette
archive. Liblinphone est proposé par son éditeur sous double licence
AGPL-3.0-or-later / commerciale. Les composants transitifs conservent leurs
propres licences.

Le script de paquetage copie, sans les modifier, les notices disponibles dans
l’archive pour `linphone-sdk`, `mediastreamer2` et `oRTP`. Cet inventaire est une
preuve technique du pilote, pas une conclusion juridique ni un inventaire de
distribution exhaustif.

Avant toute diffusion au-delà du poste pilote, il reste obligatoire de :

- valider la licence retenue pour le code source de l’agent ;
- produire l’inventaire exhaustif des bibliothèques effectivement distribuées ;
- fournir les textes de licence et les sources correspondantes exigées ;
- documenter la durée et le canal de mise à disposition des sources ;
- signer le binaire avec un certificat approuvé ou documenter explicitement
  l’absence de signature.

La licence du reste du CRM n’est pas modifiée automatiquement par ce pilote.
La séparation en processus n’est pas, à elle seule, une exemption.
