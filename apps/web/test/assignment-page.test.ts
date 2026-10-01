import assert from "node:assert/strict";
import test from "node:test";
import AssignmentConfigurationPage from "../app/admin/assignment/page.js";

test("renders manager assignment configuration and dry simulation controls", () => {
  const page = AssignmentConfigurationPage();
  const source = JSON.stringify(page);
  assert.match(source, /Configuration des affectations/);
  assert.match(source, /ROUND_ROBIN/);
  assert.match(source, /CONTROLLED_RANDOM/);
  assert.match(source, /Simuler sans modifier/);
});
