import type { MailSendingLimits } from "./business-mail-journal.js";

export const BUSINESS_MAIL_CONFIGURATION_ID = "internal-business-v1";
export interface BusinessMailSettings extends MailSendingLimits {
  campusId: string; campaignIds: string[]; memberUserIds: string[];
  warningCadenceHours: number; maximumWarnings: number;
}
export const mailUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const fields = ["campusId", "campaignIds", "memberUserIds", "warningCadenceHours", "maximumWarnings", "messagesPerHour", "messagesPerDay", "recipientsPerHour", "recipientsPerDay", "warningIntervalHours"];
function uuidList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum || !value.every(mailUuid) || new Set(value).size !== value.length) throw new Error("business_mail_settings_invalid");
  return [...value].sort((a, b) => a.localeCompare(b, "en"));
}
function bounded(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error("business_mail_settings_invalid");
  return value;
}
export function parseBusinessMailSettings(value: unknown): BusinessMailSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("business_mail_settings_invalid");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some(key => !Object.hasOwn(row, key)) || !mailUuid(row.campusId)) throw new Error("business_mail_settings_invalid");
  const result: BusinessMailSettings = { campusId: row.campusId, campaignIds: uuidList(row.campaignIds, 10), memberUserIds: uuidList(row.memberUserIds, 30),
    warningCadenceHours: bounded(row.warningCadenceHours, 720), maximumWarnings: bounded(row.maximumWarnings, 30),
    messagesPerHour: bounded(row.messagesPerHour, 1000), messagesPerDay: bounded(row.messagesPerDay, 24000),
    recipientsPerHour: bounded(row.recipientsPerHour, 10000), recipientsPerDay: bounded(row.recipientsPerDay, 240000), warningIntervalHours: bounded(row.warningIntervalHours, 720) };
  if (result.messagesPerHour > result.messagesPerDay || result.recipientsPerHour > result.recipientsPerDay || result.warningIntervalHours < result.warningCadenceHours) throw new Error("business_mail_settings_invalid");
  return result;
}
