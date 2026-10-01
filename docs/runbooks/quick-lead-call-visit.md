# Création rapide après appel ou visite

Le parcours `/leads/quick-entry` commence toujours par une recherche normalisée sur l’email et le téléphone. Un nom seul n’est jamais une preuve de rapprochement. Si ces deux identifiants désignent des leads différents, l’API refuse `quick_lead_identity_collision`.

Une correspondance fiable ajoute une provenance `MANUAL_ENTRY` et une activité append-only `PHONE_CALL` ou `PHYSICAL_VISIT`. Elle ne modifie ni statut, ni affectataire, ni source canonique. Sans correspondance, un lead est créé avec le statut `PROSPECT`; les attributs facultatifs absents portent explicitement `À compléter`, sans valeur métier inventée.

Les stratégies disponibles sont `UNASSIGNED`, `FIXED`, `ROUND_ROBIN` et `CONTROLLED_RANDOM`. Une affectation exige le rôle Manager/Admin et l’éligibilité du conseiller. L’idempotency key empêche le double clic d’ajouter une seconde provenance ou activité.

Les tests utilisent uniquement des identités synthétiques. Le rollback est le revert protégé de la PR ; aucune suppression silencieuse de timeline ou provenance n’est autorisée.
