import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Geometry-only proof using the real component and styles. No API request,
// simulated business success, synthetic database write or actual call.
const lead = {
  id: "00000000-0000-4000-8000-000000000171", leadCode: "LD-LAYOUT-SYNTH",
  firstName: "Camille", lastName: "Essai", campus: "SYNTHETIC", campaign: "DEV-LAYOUT",
  educationLevel: "BAC", program: "Programme synthétique", source: "WEB_FORM",
  status: "PROSPECT", collaboratorIds: [], temperature: "UNEVALUATED",
  temperatureLabel: "Non évalué", qualificationVersion: 0,
};
const webRoot = existsSync(resolve(process.cwd(), "app/leads/lead-profile.css")) ? process.cwd() : resolve(process.cwd(), "apps/web");
const styles = ["ynov-v2.css", "leads/lead-profile.css"].map(path => readFileSync(resolve(webRoot, "app", path), "utf8")).join("\n");
// Render in the application's normal tsx runtime: Playwright's test compiler
// must not recompile the Next/Phosphor client component dependency graph.
const markup = execFileSync(process.execPath, ["--import", "tsx", "-e", `
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { LeadProfileView } = require('./app/leads/[leadId]/lead-profile.tsx');
  process.stdout.write(renderToStaticMarkup(createElement(LeadProfileView, {lead:${JSON.stringify(lead)}, events:[]})));
`], { cwd: webRoot, encoding: "utf8" });

for (const width of [1440, 1280, 1024, 768, 390, 1838, 1874, 1920, 2560]) {
  test(`all real Lead actions fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.setContent(`<style>${styles}</style><div style="max-width:1220px; margin:auto; padding:16px; width:calc(100% - ${width > 1024 ? 168 : 0}px)">${markup}</div>`);
    const actions = page.getByRole("navigation", { name: "Actions principales du lead" });
    await expect(actions).toBeVisible();
    const controls = actions.locator(":scope > button, :scope > a");
    await expect(controls).toHaveCount(8);
    const overflow = await controls.evaluateAll(elements => {
      const parent = elements[0]!.parentElement!.getBoundingClientRect();
      return elements.map(element => {
        const rect = element.getBoundingClientRect();
        const text = document.createRange(); text.selectNodeContents(element);
        const content = text.getBoundingClientRect();
        return { label: element.textContent, outside: rect.left < parent.left - 1 || rect.right > parent.right + 1,
          clipped: content.left < rect.left - 1 || content.right > rect.right + 1,
          height: rect.height, hidden: getComputedStyle(element).display === "none" };
      }).filter(result => result.outside || result.clipped || result.height < 44 || result.hidden);
    });
    expect(overflow).toEqual([]);
    await expect(actions.getByRole("link", { name: "Planifier un rendez-vous" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Planifier une relance", exact: true })).toBeVisible();
  });
}
