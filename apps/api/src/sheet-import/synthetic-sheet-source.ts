import { Injectable } from "@nestjs/common";
import { GoogleSheetsAdapter, SheetsSourceError, type SheetValues } from "./google-sheets-adapter.js";
import type { SheetConfiguration } from "./sheet-import-configuration.js";

export abstract class SheetSource {
  abstract read(workbookId: string, tab: string, configuration: SheetConfiguration): Promise<SheetValues>;
}

/** Deliberately no fetch, secret provider, arbitrary URL, or real Sheets activation path. */
@Injectable()
export class SyntheticSheetSource extends SheetSource {
  async read(workbookId: string, tab: string, configuration: SheetConfiguration): Promise<SheetValues> {
    if (!/^synthetic_[a-z0-9_-]{1,60}$/u.test(workbookId)) throw new SheetsSourceError("sheet_real_source_disabled", 403);
    const fields: Record<string, string> = { firstName: "Lead", lastName: "Synthétique", email: `${workbookId}@example.invalid`,
      externalId: `submission-${workbookId}`, occurredAt: "2026-09-05T12:00:00.000Z", educationLevel: configuration.context.educationLevel ?? "BAC",
      program: configuration.context.program ?? "Programme synthétique", campus: configuration.context.campus ?? "", campaign: configuration.context.campaign ?? "" };
    const columns = configuration.mapping.columns;
    const adapter = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => Promise.resolve("synthetic-not-a-credential") },
      (): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ values: [columns.map((column) => column.sourceColumn),
        columns.map((column) => column.targetField ? fields[column.targetField] ?? "" : "")] }), { status: 200 })));
    return adapter.values(workbookId, tab);
  }
}
