import assert from "node:assert/strict";
import test from "node:test";
import UsersPage from "../app/admin/users/page";
import { UsersConsole } from "../app/admin/users/users-console";
test("presents the dedicated user administration workflow", () => { const page = UsersPage(); assert.equal(page.type, "main"); assert.match(JSON.stringify(page.props), /Utilisateurs et autorisations/); assert.equal(page.props.children[1].type, UsersConsole); });
