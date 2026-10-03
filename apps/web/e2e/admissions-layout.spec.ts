import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Geometry proof only: the actual React components and CSS, without a web
// server, API requests, simulated persistence or any business mutation.
const webRoot = existsSync(resolve(process.cwd(), "app/appointments/admissions/admissions.css")) ? process.cwd() : resolve(process.cwd(), "apps/web");
const styles = ["styles.css", "ynov-v2.css", "appointments/admissions/admissions.css"].map((path) => readFileSync(resolve(webRoot, "app", path), "utf8")).join("\n");
const markup = execFileSync(process.execPath, ["--import", "tsx", "-e", `
  const { createElement: h } = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
  const { AdmissionsWindowForm, AdmissionsResponsibilities } = require('./app/appointments/admissions/agenda-forms.tsx');
  const { AdmissionsBookingActions } = require('./app/appointments/admissions/booking-actions.tsx');
  const { AdmissionsSlotPicker } = require('./app/appointments/admissions/slot-picker.tsx');
  const { AdmissionsReportForm } = require('./app/appointments/admissions/report-form.tsx');
  const responsible = {id:'responsible-profile',userId:'responsible',label:'Responsable synthétique des Admissions',campus:'SYNTHETIC',campusLabel:'Campus synthétique de recette',active:true,version:1};
  const booking = {id:'booking-synthetic',leadId:'lead-synthetic',responsibilityId:responsible.id,leadIdentifier:'LD-SYNTHETIC',leadLabel:'Lead synthétique',responsibleLabel:responsible.label,state:'PENDING',appointmentState:'PLANIFIE',campus:'SYNTHETIC',startsAt:'2099-10-04T09:00:00.000Z',durationMinutes:30,version:1,canDecide:true,canCancel:true,canReschedule:true};
  const context = {timezone:'Africa/Casablanca',ownResponsibilities:[responsible],canManageResponsibilities:true,canUseAgenda:true,campuses:[{id:'campus',code:'SYNTHETIC',label:'Campus synthétique de recette'}],eligibleUsers:[{id:'responsible',label:responsible.label,campus:'SYNTHETIC'}]};
  const onUpdated = async () => {}; const onChange = () => {};
  process.stdout.write(renderToStaticMarkup(h('main',{className:'admissions-page'},
    h('h1',null,'Disponibilités et rendez-vous'),
    h('div',{className:'admissions-agenda-grid'}, h(AdmissionsWindowForm,{responsibilities:[responsible],onUpdated}), h(AdmissionsResponsibilities,{context,items:[responsible],onUpdated})),
    h('section',{className:'panel admissions-panel'},h(AdmissionsSlotPicker,{leadId:booking.leadId,responsibilityId:responsible.id,durationMinutes:30,value:'',onChange}),h(AdmissionsBookingActions,{booking,onUpdated})),
    h('section',{className:'panel admissions-panel'},h(AdmissionsReportForm,{booking:{...booking,state:'ACCEPTED',appointmentState:'REALISE',canWriteReport:true},onUpdated}))
  )));
`], { cwd: webRoot, encoding: "utf8" });

for (const width of [1440, 1280, 1024, 768, 390]) {
  test(`actual Admissions forms remain contained and usable at ${width}px without a server`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.setContent(`<style>${styles}body{margin:0;padding:16px}</style><div style="width:calc(100% - ${width > 1024 ? 168 : 0}px);margin:auto">${markup}</div>`);
    await expect(page.getByRole("heading", { name: "Déclarer une plage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accepter le rendez-vous" })).toBeVisible();
    const controls = page.locator("main :is(button,select,input:not([type=radio]),textarea)");
    const geometry = await controls.evaluateAll((elements) => {
      const parent = elements[0]!.closest("main")!.getBoundingClientRect();
      return elements.map((element) => { const rect = element.getBoundingClientRect(); return { label: element.textContent, outside: rect.left < parent.left - 1 || rect.right > parent.right + 1, height: rect.height }; }).filter((result) => result.outside || result.height < 44);
    });
    expect(geometry).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    const focus = page.getByLabel("Responsable et campus"); await focus.focus(); await expect(focus).toBeFocused();
  });
}
