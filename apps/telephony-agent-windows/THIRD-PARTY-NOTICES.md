# Notices tierces — paquet pilote Téléphonie CRM Ynov

Le paquet pilote utilise l’archive officielle `linphone-sdk-win64-5.5.21.zip`
(SHA-256 `1C31D2FF9782DCF8732790AAFAC12D56526CD69B6B8A79498D11802DCAC56095`).
L’agent lie dynamiquement le wrapper C# et les bibliothèques natives de cette
archive. Liblinphone est proposé par son éditeur sous double licence
AGPL-3.0-or-later / commerciale. Les composants transitifs conservent leurs
propres licences.

Le script copie les textes disponibles sans les modifier, dans des sous-dossiers
nommés : `libjpeg-turbo` (y compris `README.ijg`), `ortp` et les deux packs .NET
déclarés par le binaire publié et les assets restaurés, aux mêmes versions.
Le `LICENSE.md` rangé en amont sous `linphone-sdk` est un texte libjpeg-turbo,
pas une licence globale du SDK. La page HTML `mediastreamer2/COPYING-page.html`
est conservée comme document amont, pas comme preuve de licence : son fragment
COPYING est vide dans l'archive retenue. `notice-inventory.json` relie chaque
copie à son composant, sa version et son empreinte, sans chemin privé absolu.
Les textes .NET proviennent des packs runtime utilisés, pas d'une licence du
SDK .NET prise comme substitut. Une notice requise absente provoque un refus.
Cet inventaire n'est ni une conclusion juridique, ni un inventaire exhaustif
des licences transitives ou des sources correspondantes, ni un accord de diffusion.

Avant toute diffusion au-delà du poste pilote, il reste obligatoire de :

- valider la licence retenue pour le code source de l’agent ;
- produire l’inventaire exhaustif des bibliothèques effectivement distribuées ;
- fournir les textes de licence et les sources correspondantes exigées ;
- documenter la durée et le canal de mise à disposition des sources ;
- signer le binaire avec un certificat approuvé ou documenter explicitement
  l’absence de signature.

La licence du reste du CRM n’est pas modifiée automatiquement par ce pilote.
La séparation en processus n’est pas, à elle seule, une exemption.
