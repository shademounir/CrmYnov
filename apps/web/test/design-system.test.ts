import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState, ErrorState, FormField, PageHeader, Pagination, PermissionGate, Skeleton, StatCard, StatusBadge } from "../app/_components/ui/index.js";

test("renders the Ynov foundational components with accessible semantics", () => {
  const tree = createElement(Fragment, null,
    createElement(PageHeader, { eyebrow: "Base prospects", title: "Tous les leads", description: "Centralisez les opportunités.", actions: createElement("button", { type: "button" }, "Nouveau lead") }),
    createElement(StatCard, { label: "Nouveaux leads", value: "12", hint: "Données synthétiques" }),
    createElement(StatusBadge, { tone: "success", children: "Inscrit" }),
    createElement(EmptyState, { title: "Aucun lead", description: "Modifiez les filtres." }),
    createElement(ErrorState, { description: "Réessayez plus tard." }),
    createElement(Skeleton),
    createElement(FormField, { id: "search", label: "Rechercher", hint: "Nom ou identifiant", error: "Valeur invalide", children: createElement("input", { name: "search" }) }),
    createElement(Pagination, { page: 2, pageCount: 3, hrefForPage: (page: number) => `/leads?page=${page}` }),
  );
  const html = renderToStaticMarkup(tree);
  for (const expected of ["Base prospects", "ui-stat-card", "ui-badge--success", "role=\"alert\"", "aria-invalid=\"true\"", "aria-current=\"page\"", "aria-label=\"Chargement en cours\""]) assert.match(html, new RegExp(expected));
});

test("permission gate fails closed without authorization", () => {
  const denied = renderToStaticMarkup(createElement(PermissionGate, { allowed: false, fallback: createElement("p", null, "Accès refusé"), children: createElement("button", { type: "button" }, "Action sensible") }));
  assert.match(denied, /Accès refusé/);
  assert.doesNotMatch(denied, /Action sensible/);
  const allowed = renderToStaticMarkup(createElement(PermissionGate, { allowed: true, children: createElement("button", { type: "button" }, "Action autorisée") }));
  assert.match(allowed, /Action autorisée/);
});

test("pagination clamps unsafe page values", () => {
  const html = renderToStaticMarkup(createElement(Pagination, { page: 99, pageCount: 2, hrefForPage: (page: number) => `?page=${page}` }));
  assert.match(html, /Page 2 sur 2/);
});
