# Création locale d'un lead

`POST /leads` exige un rôle Admissions ou administrateur. L'API normalise l'email et le téléphone, génère un `leadCode` immuable, initialise le statut `PROSPECT`, signale les doublons probables sans perdre la saisie, puis ajoute les preuves `LEAD_CREATED` à la timeline et à l'audit.

Les tests utilisent exclusivement des identités synthétiques. Le rollback applicatif consiste à revenir au commit précédent ; aucune migration ni base persistante n'est concernée.
