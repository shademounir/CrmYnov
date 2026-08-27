import assert from "node:assert/strict";
import test from "node:test";
import UsersPage from "../app/admin/users/page";
test("renders the persistent Super Admin collaborator form", () => { const page = UsersPage(); const rendered = JSON.stringify(page.props); assert.equal(page.type, "main"); assert.match(rendered, /Email professionnel/); assert.match(rendered, /Rôles, séparés/); assert.match(rendered, /Créer via l’API/); });
