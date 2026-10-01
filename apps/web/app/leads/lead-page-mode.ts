export type LeadPageMode = "directory" | "follow-up";

export function leadPageMode(view: string | null | undefined): LeadPageMode {
  return view?.trim().toUpperCase() === "FOLLOW_UP" ? "follow-up" : "directory";
}
