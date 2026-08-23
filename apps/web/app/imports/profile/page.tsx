"use client";

import { useState } from "react";

interface ProfileSummary { profileId: string; fileType: string; accepted: boolean; mutated: false; reasons: string[]; sheets: Array<{ name: string; rowCount: number; columns: Array<{ name: string; inferredType: string }> }> }

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (): void => reject(new Error("file_read_failed"));
    reader.onload = (): void => { const result = reader.result; if (typeof result !== "string") { reject(new Error("file_read_failed")); return; }
      const comma = result.indexOf(","); if (comma < 0) { reject(new Error("file_read_failed")); return; } resolve(result.slice(comma + 1)); };
    reader.readAsDataURL(file);
  });
}

export default function ImportProfilePage(): React.JSX.Element {
  const [profile, setProfile] = useState<ProfileSummary | null>(null); const [error, setError] = useState("");
  async function submit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setError(""); setProfile(null);
    const data = new FormData(event.currentTarget); const file = data.get("file"); const profileEntry = data.get("expectedProfile");
    const expectedProfile = typeof profileEntry === "string" ? profileEntry : "CUSTOM";
    if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024) { setError("Sélectionnez un fichier CSV ou XLSX de 5 Mio maximum."); return; }
    let contentBase64: string;
    try { contentBase64 = await readBase64(file); } catch { setError("Lecture locale du fichier impossible."); return; }
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/lead-import/profiles`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size, contentBase64, expectedProfile }),
    });
    if (!response.ok) { setError("Le fichier a été refusé sans être importé."); return; }
    setProfile(await response.json() as ProfileSummary);
  }
  return <main><h1>Profiler un fichier d’import</h1><p>Le profilage vérifie uniquement la structure. Il ne crée et ne modifie aucun lead.</p>
    <form onSubmit={(event) => void submit(event)}><label>Profil attendu <select name="expectedProfile" defaultValue="FORMINATOR_ZAPIER">
      <option value="FORMINATOR_ZAPIER">Forminator / Zapier</option><option value="LEGACY_CRM">CRM historique</option><option value="CUSTOM">Mapping à définir</option>
    </select></label><label>Fichier <input name="file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label>
      <button type="submit">Analyser sans importer</button></form>
    {error ? <p role="alert">{error}</p> : null}{profile ? <section aria-live="polite"><h2>Profil expurgé</h2><p>{profile.accepted ? "Structure acceptée" : `Revue requise : ${profile.reasons.join(", ")}`}</p>
      <p>Identifiant : {profile.profileId} — Type : {profile.fileType} — Mutation : non</p>{profile.sheets.map((sheet) => <article key={sheet.name}><h3>{sheet.name}</h3><p>{sheet.rowCount} lignes</p>
        <ul>{sheet.columns.map((column) => <li key={`${sheet.name}-${column.name}`}>{column.name} — {column.inferredType}</li>)}</ul></article>)}</section> : null}
  </main>;
}
