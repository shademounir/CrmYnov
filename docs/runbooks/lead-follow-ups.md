# Relances locales contrôlées

Une relance appartient à un lead et un responsable, possède une échéance UTC, un motif contrôlé et une version optimiste. Une seule relance active est admise par lead. Le passage à échéance crée une notification interne dédupliquée ; reporter, traiter ou annuler produit une activité et un audit append-only.

Le traitement refuse IDOR, double soumission et version périmée. Aucun ordonnanceur cloud, Pub/Sub, email, WhatsApp, SMS, secret, donnée réelle ou base persistante n'est utilisé. Les tests déclenchent explicitement le balayage avec une horloge synthétique.
