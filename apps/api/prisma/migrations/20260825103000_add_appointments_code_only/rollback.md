# Rollback local code-only

Revert the protected CRMY-149 change before any persistent environment exists. For ephemeral test databases only, discard the whole database. Do not run `DROP` statements against persistent data.
