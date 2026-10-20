import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const css = readFileSync(new URL("../app/ynov-v2.css", import.meta.url), "utf8");

test("dashboard priority explanations override legacy nowrap without clipping their content", () => {
  const text = "Prospects à contacter reçus depuis strictement plus de 24 heures consécutives sans traitement commercial connu";
  const dom = new JSDOM(`<style>${css}</style><main class="dashboard-page"><section class="priority-panel"><div class="priority-table"><article class="table-row"><span><small>${text}</small></span><span><small>${"REFERENCE_SYNTHETIQUE_".repeat(12)}</small></span></article></div></section></main><div class="table-row"><small>Autre tableau</small></div>`);
  try {
    const explanations = dom.window.document.querySelectorAll(".dashboard-page .priority-table small");
    assert.equal(explanations.length, 2);
    for (const explanation of explanations) {
      const style = dom.window.getComputedStyle(explanation);
      assert.equal(style.whiteSpace, "normal");
      assert.equal(style.overflowWrap, "anywhere");
      assert.equal(style.maxWidth, "100%");
      assert.equal(style.minWidth, "0");
      assert.notEqual(style.overflow, "hidden");
      assert.notEqual(style.textOverflow, "ellipsis");
    }
    assert.equal(explanations[0]?.textContent, text);
    const panel = dom.window.document.querySelector(".dashboard-page .priority-panel");
    const row = dom.window.document.querySelector(".dashboard-page .table-row");
    assert.ok(panel);
    assert.ok(row);
    assert.equal(dom.window.getComputedStyle(panel).height, "auto", "wrapped descriptions must not overlap the next panel");
    assert.equal(dom.window.getComputedStyle(row).minWidth, "0", "the legacy 620px row must fit a narrower dashboard column");
    const otherTable = dom.window.document.querySelector("body > .table-row small");
    assert.ok(otherTable);
    assert.equal(dom.window.getComputedStyle(otherTable).whiteSpace, "nowrap", "do not change unrelated table layouts");
  } finally {
    dom.window.close();
  }
});
