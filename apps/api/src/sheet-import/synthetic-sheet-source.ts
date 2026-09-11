import { Injectable } from "@nestjs/common";
import { GoogleSheetsAdapter, SheetsSourceError, type SheetValues } from "./google-sheets-adapter.js";
import type { SheetConfiguration } from "./sheet-import-configuration.js";

export abstract class SheetSource {
  /** Local worker capability only. Authorization and source validation still happen during read(). */
  canProcess?(configuration: SheetConfiguration): boolean;
  abstract read(workbookId: string, tab: string, configuration: SheetConfiguration): Promise<SheetValues>;
}

/** Deliberately no fetch, secret provider, arbitrary URL, or real Sheets activation path. */
@Injectable()
export class SyntheticSheetSource extends SheetSource {
  override canProcess(configuration: SheetConfiguration): boolean {
    return configuration.source?.mode !== "GOOGLE";
  }

  async read(workbookId: string, tab: string, configuration: SheetConfiguration): Promise<SheetValues> {
    if (!/^synthetic_[a-z0-9_-]{1,60}$/u.test(workbookId)) throw new SheetsSourceError("sheet_real_source_disabled", 403);
    const fields: Record<string, string> = { firstName: "Lead", lastName: "Synthétique", email: `${workbookId}@example.invalid`,
      externalId: `submission-${workbookId}`, occurredAt: "2026-09-05T12:00:00.000Z", educationLevel: configuration.context.educationLevel ?? "BAC",
      program: configuration.context.program ?? "Programme synthétique", campus: configuration.context.campus ?? "", campaign: configuration.context.campaign ?? "" };
    const columns = configuration.mapping.columns;
    const adapter = new GoogleSheetsAdapter({ accessToken: (): Promise<string> => Promise.resolve("synthetic-not-a-credential") },
      (): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ values: [columns.map((column) => column.sourceColumn),
        columns.map((column) => column.targetField ? fields[column.targetField] ?? "" : "")] }), { status: 200 })));
    const result = await adapter.values(workbookId, tab);
    if (configuration.source?.identityMode === "LOCAL_ROW" && configuration.source.sheetId !== undefined && configuration.source.range) {
      result.observation = { sheetId: configuration.source.sheetId, range: configuration.source.range,
        values: [result.columns, ...result.rows.map((row) => result.columns.map((column) => row[column] ?? ""))] };
    }
    return result;
  }
}
