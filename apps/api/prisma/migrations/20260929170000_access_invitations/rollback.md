# Access invitations rollback

This additive table holds only short-lived first-access invitations. A code rollback may leave the table in place safely; do not delete it while any issued invitation could still be used. Revoke outstanding invitations through the application before retiring this flow. Keep the table and its audit evidence until retention review authorizes removal. No existing collaborator, password, session, or recovery-challenge row is rewritten by this migration.

The unique digest index ensures a link cannot identify two invitations. Check the migration on an empty and an isolated populated copy before rollout. A later, separately reviewed migration would remove the table after the invitation flow and retained evidence have been superseded.
