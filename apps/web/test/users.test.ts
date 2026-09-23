import assert from "node:assert/strict";
import test from "node:test";
import UsersPage from "../app/admin/users/page";
import { TemporarySecretForm } from "../app/admin/users/temporary-secret-form";
test("renders persistent Super Admin collaborator and one-time access forms", () => { const page = UsersPage(); const rendered = JSON.stringify(page.props); assert.equal(page.type, "main"); assert.match(rendered, /Email professionnel/); assert.match(rendered, /Rôles, séparés/); assert.match(rendered, /Créer via l’API/); assert.equal(page.props.children[4].type, TemporarySecretForm); });
