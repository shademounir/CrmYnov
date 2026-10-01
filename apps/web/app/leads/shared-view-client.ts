export interface SharedView {
  id: string; name: string; filters: Record<string, string>; version: number;
  ownerDisplayName: string; isOwner: boolean;
  visibleAudiences: { type: "TEAM" | "CAMPUS"; label: string }[];
  canEdit: boolean; canRevoke: boolean; canDuplicate: boolean;
}
export interface ViewAudience { id: string; kind: "TEAM" | "CAMPUS"; campusId: string; label: string }
export interface ViewShare { id: string; viewId: string; kind: string; audienceId: string; active: boolean; version: number; viewVersion: number; canRevoke: boolean }
export interface SharingSnapshot { owned: SharedView[]; received: SharedView[]; audiences: ViewAudience[]; history: ViewShare[] }

/** Per-mounted-screen coalescing only; no data cache or cross-session singleton. */
export function createPrivateViewReader<T extends { id: string }>(): { read: () => Promise<T[]>; invalidate: () => void } {
  let pending: Promise<T[]> | undefined;
  return {
    read: (): Promise<T[]> => {
      if (!pending) {
        const request = sharingRequest<T[]>("lead-views");
        pending = request;
        const clear = (): void => { if (pending === request) pending = undefined; };
        void request.then(clear, clear);
      }
      return pending;
    },
    invalidate: (): void => { pending = undefined; },
  };
}

export function sharingError(status: number): string {
  switch (status) {
    case 401: return "Votre session a expiré. Reconnectez-vous.";
    case 403: return "Accès refusé : votre rôle, votre grant ou votre périmètre ne permet pas cette action.";
    case 404: return "Cette vue n’est plus accessible. Son partage a pu être révoqué.";
    case 409: return "La vue a changé. Actualisez avant de confirmer à nouveau.";
    case 400: return "Vérifiez le nom, les filtres et le destinataire.";
    default: return "Service indisponible. Aucune réussite n’a été confirmée.";
  }
}
export async function sharingRequest<T>(path: string, method = "GET", body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/crm/${path}`, { method, credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json", accept: "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(sharingError(response.status));
  return response.json() as Promise<T>;
}
export async function sharingSnapshot(signal?: AbortSignal, readPrivateViews?: () => Promise<{ id: string }[]>): Promise<SharingSnapshot> {
  const [privateViews, received, audiences, history] = await Promise.all([
    readPrivateViews ? readPrivateViews() : sharingRequest<{ id: string }[]>("lead-views", "GET", undefined, signal), sharingRequest<SharedView[]>("view-sharing/received", "GET", undefined, signal),
    sharingRequest<ViewAudience[]>("view-sharing/audiences", "GET", undefined, signal), sharingRequest<ViewShare[]>("view-sharing/history", "GET", undefined, signal),
  ]);
  signal?.throwIfAborted();
  // Existing private-list contract is unchanged. Fetch capabilities from the
  // existing authorized read endpoint, sequentially (no parallel fence storm).
  const owned: SharedView[] = [];
  for (const view of privateViews) owned.push(await sharingRequest<SharedView>(`view-sharing/views/${encodeURIComponent(view.id)}`, "GET", undefined, signal));
  return { owned, received, audiences, history };
}
export function sharedViewLink(id: string): string { return `/leads?${new URLSearchParams({ sharedViewId: id, page: "1" }).toString()}`; }
export function versionedCommand(expectedVersion: number): { expectedVersion: number; idempotencyKey: string } {
  return { expectedVersion, idempotencyKey: crypto.randomUUID() };
}
