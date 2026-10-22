/** Canonical acquisition sources, shared without importing the ingestion runtime. */
export const ingestionSources = ["WEB_FORM", "PHONE_CALL", "PHYSICAL_VISIT", "WEBSITE", "EVENT", "PARTNER", "JOBINTECH", "LEGACY_IMPORT", "MANUAL_ENTRY", "OTHER_CONTROLLED"] as const;
export type IngestionSource = typeof ingestionSources[number];
