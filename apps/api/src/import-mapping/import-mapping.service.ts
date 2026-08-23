import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import {
  IngestionService,
  type IngestionDryRunResult,
  type IngestionProfile,
  type IngestionRecordInput,
  type IngestionSource,
} from "../ingestion/ingestion.service.js";

export const crmImportTargets = [
  "firstName", "lastName", "email", "phone", "educationLevel", "program", "campus", "campaign",
  "externalId", "historicalStatus", "occurredAt", "comment",
] as const;
export type CrmImportTarget = (typeof crmImportTargets)[number];
export type MappingAction = "DIRECT" | "TRIM" | "LOWERCASE" | "PHONE" | "DATE" | "METADATA" | "IGNORE";

export interface ImportMappingColumnInput {
  sourceColumn: string;
  targetField?: CrmImportTarget;
  action: MappingAction;
  required?: boolean;
  reason?: string;
}

export interface SaveImportMappingInput {
  mappingKey: string;
  name: string;
  profile: IngestionProfile;
  expectedVersion: number;
  columns: ImportMappingColumnInput[];
}

export interface ImportMappingTemplate {
  id: string;
  mappingKey: string;
  name: string;
  profile: IngestionProfile;
  version: number;
  columns: ImportMappingColumnInput[];
  builtIn: boolean;
  createdAt: string;
  createdBy: string;
}

export interface ImportDryRunInput {
  idempotencyKey: string;
  mappingKey: string;
  mappingVersion: number;
  sourceColumns: string[];
  rows: Array<Record<string, string>>;
  context: {
    source: IngestionSource;
    technicalSystem: string;
    originalSource: string;
    recentSource?: string;
    campus?: string;
    campaign?: string;
    educationLevel?: string;
    program?: string;
  };
  assignment: { strategy: "UNASSIGNED" | "FIXED" | "ROUND_ROBIN" | "CONTROLLED_RANDOM"; targetUserId?: string };
}

const MAPPING_KEY = /^[a-z][a-z0-9-]{2,63}$/;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 4_000;

const FORM_COLUMNS: ImportMappingColumnInput[] = [
  { sourceColumn: "Submission ID", targetField: "externalId", action: "TRIM", required: true },
  { sourceColumn: "Submission Time", targetField: "occurredAt", action: "DATE", required: true },
  { sourceColumn: "Nom - Prénom", targetField: "firstName", action: "TRIM", required: true },
  { sourceColumn: "Nom - Nom", targetField: "lastName", action: "TRIM", required: true },
  { sourceColumn: "Adresse éléctronique", targetField: "email", action: "LOWERCASE" },
  { sourceColumn: "Numéro de téléphone", targetField: "phone", action: "PHONE" },
  { sourceColumn: "Niveau d'étude", targetField: "educationLevel", action: "TRIM", required: true },
  { sourceColumn: "Formation choisie", targetField: "program", action: "TRIM", required: true },
  { sourceColumn: "Webhook Info", action: "METADATA", reason: "technical_provenance_only" },
];

const LEGACY_COLUMNS: ImportMappingColumnInput[] = [
  { sourceColumn: "NOM", targetField: "lastName", action: "TRIM", required: true },
  { sourceColumn: "PRÉNOM", targetField: "firstName", action: "TRIM", required: true },
  { sourceColumn: "TÉLÉPHONE", targetField: "phone", action: "PHONE" },
  { sourceColumn: "EMAIL", targetField: "email", action: "LOWERCASE" },
  { sourceColumn: "NIVEAU", targetField: "educationLevel", action: "TRIM", required: true },
  { sourceColumn: "SPÉCIALITÉ", action: "METADATA", reason: "legacy_provenance_only" },
  { sourceColumn: "FORMATION SOUHAITÉE", targetField: "program", action: "TRIM", required: true },
  { sourceColumn: "DATE RÉCEPTION", targetField: "occurredAt", action: "DATE" },
  { sourceColumn: "DATE TRAITEMENT", action: "METADATA", reason: "legacy_provenance_only" },
  { sourceColumn: "DÉLAI (jours)", action: "METADATA", reason: "derived_legacy_value" },
  { sourceColumn: "SOURCE", action: "METADATA", reason: "raw_source_preserved_in_provenance" },
  { sourceColumn: "STATUT", targetField: "historicalStatus", action: "TRIM" },
  { sourceColumn: "COMMENTAIRE 1", targetField: "comment", action: "TRIM" },
  { sourceColumn: "QUALIFICATION", action: "METADATA", reason: "legacy_provenance_only" },
  { sourceColumn: "COMMENTAIRE 2", action: "METADATA", reason: "legacy_provenance_only" },
  { sourceColumn: "rdv", action: "METADATA", reason: "requires_structured_activity_date" },
  { sourceColumn: "PROCHAINE ACTION", action: "METADATA", reason: "legacy_provenance_only" },
  { sourceColumn: "RESPONSABLE", action: "METADATA", reason: "canonical_owner_must_not_be_overwritten" },
  { sourceColumn: "PAYS", action: "METADATA", reason: "legacy_provenance_only" },
  { sourceColumn: "Part 1er (%)", action: "METADATA", reason: "derived_legacy_value" },
  { sourceColumn: "Lien WhatsApp", action: "IGNORE", reason: "external_link_not_imported" },
  { sourceColumn: "VILLE", action: "METADATA", reason: "legacy_provenance_only" },
];

@Injectable()
export class ImportMappingService {
  private readonly mappings = new Map<string, Readonly<ImportMappingTemplate>[]>();

  constructor(private readonly ingestion: IngestionService, private readonly audit: AuditService) {
    this.mappings.set("forminator-zapier-v1", [this.builtIn("forminator-zapier-v1", "Forminator / Zapier", "FORMINATOR_ZAPIER", FORM_COLUMNS)]);
    this.mappings.set("legacy-crm-canonical-v1", [this.builtIn("legacy-crm-canonical-v1", "LEADS YNOV.MA canonique", "LEGACY_CRM", LEGACY_COLUMNS)]);
  }

  list(principal: Principal): ImportMappingTemplate[] {
    this.assertRole(principal);
    return [...this.mappings.values()].flatMap((versions) => versions.slice(-1)).map((item) => this.copy(item));
  }

  save(input: SaveImportMappingInput, principal: Principal, correlationId: string): ImportMappingTemplate {
    this.assertRole(principal);
    this.validateMapping(input);
    const versions = this.mappings.get(input.mappingKey) ?? [];
    if (versions.some((version) => version.builtIn)) throw new ConflictException({ code: "mapping_builtin_immutable" });
    const currentVersion = versions.at(-1)?.version ?? 0;
    if (input.expectedVersion !== currentVersion) throw new ConflictException({ code: "mapping_version_conflict" });
    const mapping: Readonly<ImportMappingTemplate> = Object.freeze({
      id: this.mappingId(input.mappingKey, currentVersion + 1, input.columns),
      mappingKey: input.mappingKey,
      name: input.name.trim(),
      profile: input.profile,
      version: currentVersion + 1,
      columns: input.columns.map((column) => Object.freeze({ ...column })),
      builtIn: false,
      createdAt: new Date().toISOString(),
      createdBy: principal.userId,
    });
    this.mappings.set(input.mappingKey, [...versions, mapping]);
    this.audit.record({
      eventType: "LEAD_IMPORT_MAPPING_VERSION_CREATED",
      actorId: principal.userId,
      actorRoles: principal.roles,
      sessionId: principal.sessionId,
      correlationId,
      after: { mappingId: mapping.id, mappingKey: mapping.mappingKey, version: mapping.version, profile: mapping.profile, columnCount: mapping.columns.length },
      result: "SUCCESS",
      idempotencyKey: `lead-import-mapping:${mapping.id}`,
    });
    return this.copy(mapping);
  }

  dryRun(input: ImportDryRunInput, principal: Principal, correlationId: string): IngestionDryRunResult & { mappingId: string; mappingVersion: number } {
    this.assertRole(principal);
    const mapping = this.getVersion(input.mappingKey, input.mappingVersion);
    this.validateDryRun(input, mapping);
    const records = input.rows.map((row, index) => this.toRecord(row, index + 1, mapping, input));
    const result = this.ingestion.dryRun({
      idempotencyKey: input.idempotencyKey,
      profile: mapping.profile,
      assignment: input.assignment,
      records,
    }, principal, correlationId);
    return { ...result, mappingId: mapping.id, mappingVersion: mapping.version };
  }

  describeVersion(mappingId: string, version: number): Pick<ImportMappingTemplate, "id" | "mappingKey" | "version" | "profile"> | undefined {
    const mapping = [...this.mappings.values()].flat().find((item) => item.id === mappingId && item.version === version);
    return mapping ? { id: mapping.id, mappingKey: mapping.mappingKey, version: mapping.version, profile: mapping.profile } : undefined;
  }

  private validateMapping(input: SaveImportMappingInput): void {
    if (!MAPPING_KEY.test(input.mappingKey) || !input.name?.trim() || input.name.trim().length > 100) throw new BadRequestException({ code: "mapping_identity_invalid" });
    if (!"LEGACY_CRM FORMINATOR_ZAPIER YNOV_COM JOBINTECH LEGACY_RELAUNCH OTHER_CAMPAIGN CUSTOM".split(" ").includes(input.profile)) throw new BadRequestException({ code: "mapping_profile_invalid" });
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new BadRequestException({ code: "mapping_expected_version_invalid" });
    if (!input.columns.length || input.columns.length > MAX_COLUMNS) throw new BadRequestException({ code: "mapping_columns_invalid" });
    const sources = input.columns.map((column) => column.sourceColumn.trim());
    if (sources.some((source) => !source || source.length > 200) || new Set(sources).size !== sources.length) throw new BadRequestException({ code: "mapping_source_column_invalid" });
    const targets = input.columns.flatMap((column) => column.targetField ? [column.targetField] : []);
    if (new Set(targets).size !== targets.length || targets.some((target) => !crmImportTargets.includes(target))) throw new BadRequestException({ code: "mapping_target_duplicate_or_invalid" });
    for (const column of input.columns) {
      if (!(["DIRECT", "TRIM", "LOWERCASE", "PHONE", "DATE", "METADATA", "IGNORE"] as const).includes(column.action)) throw new BadRequestException({ code: "mapping_action_invalid" });
      const nonImport = column.action === "IGNORE" || column.action === "METADATA";
      if (nonImport !== !column.targetField || (nonImport && !column.reason?.trim())) throw new BadRequestException({ code: "mapping_action_target_invalid" });
    }
    for (const required of ["firstName", "lastName"] as const) if (!targets.includes(required)) throw new BadRequestException({ code: "mapping_required_target_missing" });
    if (!["email", "phone", "externalId"].some((target) => targets.includes(target as CrmImportTarget))) throw new BadRequestException({ code: "mapping_identity_target_missing" });
  }

  private validateDryRun(input: ImportDryRunInput, mapping: Readonly<ImportMappingTemplate>): void {
    if (!input.rows.length || input.rows.length > 100) throw new BadRequestException({ code: "dry_run_rows_invalid" });
    const expected = mapping.columns.map((column) => column.sourceColumn);
    if (input.sourceColumns.length !== expected.length || input.sourceColumns.some((column, index) => column !== expected[index])) throw new BadRequestException({ code: "dry_run_columns_mismatch" });
    for (const row of input.rows) {
      const keys = Object.keys(row);
      if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) throw new BadRequestException({ code: "dry_run_unknown_column" });
      for (const column of mapping.columns) {
        const value = row[column.sourceColumn];
        const safePhone = column.action === "PHONE" && typeof value === "string" && /^\+?[\d\s().-]*$/.test(value);
        if (typeof value !== "string" || value.length > MAX_CELL_LENGTH || (this.looksLikeFormula(value) && !safePhone)) {
          throw new BadRequestException({ code: "dry_run_cell_refused" });
        }
      }
    }
  }

  private toRecord(row: Record<string, string>, lineNumber: number, mapping: Readonly<ImportMappingTemplate>, input: ImportDryRunInput): IngestionRecordInput {
    const values: Partial<Record<CrmImportTarget, string>> = {};
    for (const column of mapping.columns) {
      if (!column.targetField) continue;
      const raw = row[column.sourceColumn] ?? "";
      if (column.required && !raw.trim()) values[column.targetField] = "";
      else values[column.targetField] = this.transform(raw, column.action);
    }
    return {
      lineNumber,
      firstName: values.firstName ?? "",
      lastName: values.lastName ?? "",
      ...(values.email ? { email: values.email } : {}),
      ...(values.phone ? { phone: values.phone } : {}),
      campus: values.campus || input.context.campus,
      campaign: values.campaign || input.context.campaign,
      educationLevel: values.educationLevel || input.context.educationLevel,
      program: values.program || input.context.program,
      source: input.context.source,
      technicalSystem: input.context.technicalSystem,
      originalSource: input.context.originalSource,
      ...(input.context.recentSource ? { recentSource: input.context.recentSource } : {}),
      ...(values.externalId ? { externalId: values.externalId } : {}),
      ...(values.historicalStatus ? { historicalStatus: values.historicalStatus } : {}),
      ...(values.occurredAt ? { occurredAt: values.occurredAt } : {}),
    };
  }

  private transform(value: string, action: MappingAction): string {
    if (action === "LOWERCASE") return value.trim().toLowerCase();
    if (action === "PHONE") return value.replace(/[^+\d]/g, "");
    if (action === "DATE") {
      const date = new Date(value.trim());
      return Number.isNaN(date.valueOf()) ? value.trim() : date.toISOString();
    }
    return value.trim();
  }

  private getVersion(mappingKey: string, version: number): Readonly<ImportMappingTemplate> {
    const mapping = this.mappings.get(mappingKey)?.find((item) => item.version === version);
    if (!mapping) throw new NotFoundException({ code: "mapping_version_not_found" });
    return mapping;
  }

  private builtIn(mappingKey: string, name: string, profile: IngestionProfile, columns: ImportMappingColumnInput[]): Readonly<ImportMappingTemplate> {
    return Object.freeze({ id: this.mappingId(mappingKey, 1, columns), mappingKey, name, profile, version: 1,
      columns: columns.map((column) => Object.freeze({ ...column })), builtIn: true, createdAt: "2026-08-23T00:00:00.000Z", createdBy: "SYSTEM" });
  }

  private mappingId(mappingKey: string, version: number, columns: ImportMappingColumnInput[]): string {
    return `mapping-${createHash("sha256").update(JSON.stringify({ mappingKey, version, columns })).digest("hex").slice(0, 24)}`;
  }

  private looksLikeFormula(value: string): boolean {
    const trimmed = value.trimStart();
    return trimmed.startsWith("=") || trimmed.startsWith("+") || trimmed.startsWith("-") || trimmed.startsWith("@");
  }

  private assertRole(principal: Principal): void {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "import_mapping_role_forbidden" });
  }

  private copy(mapping: Readonly<ImportMappingTemplate>): ImportMappingTemplate {
    return { ...mapping, columns: mapping.columns.map((column) => ({ ...column })) };
  }
}
