# Rendez-vous et entretiens code-only

CRMY-149 fournit un agenda local en `Africa/Casablanca`, des transitions contrôlées, des disponibilités expurgées, des notifications internes et des comptes rendus humains immuables. Les données de test sont entièrement synthétiques.

## Contrôles

- Durée de 15 à 480 minutes ; campus du lead obligatoire pour `SUR_SITE`.
- Conflits calculés sur les participants internes et surcharge signalée à partir de huit rendez-vous ouverts par jour.
- Report, annulation, refus et absence exigent un motif. Une correction ajoute un événement compensatoire.
- Le rapport d'entretien ne change jamais le statut du lead et ne décide ni admission ni bourse.
- Les KPI sont descriptifs : présence = réalisés / (réalisés + absents) ; délai = moyenne entre création technique et premier créneau valide ; rendez-vous ouverts, annulations et dates invalides sont exclus selon la mesure.

## Limites gelées

Google Calendar, Outlook, visioconférence, email, SMS, WhatsApp, appels externes, GCP, secrets, base persistante, STAGING et PROD nécessitent une autorisation distincte. Le rollback consiste à reverter la PR ; une base éphémère peut être entièrement jetée.
