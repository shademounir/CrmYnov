import assert from "node:assert/strict";
import test from "node:test";
import UsersPage from "../app/admin/users/page";
test("renders the synthetic Super Admin collaborator form", () => { const page = UsersPage(); assert.equal(page.type, "main"); assert.match(JSON.stringify(page.props), /Email professionnel/); });
