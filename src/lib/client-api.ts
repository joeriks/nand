export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public retryAfter?: number) { super(message); }
}
export const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  if (isDesktop()) {
    let response: { status: number; data: { code?: string; error?: string; details?: unknown; retryAfter?: number } };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      response = await invoke("backend_request", { request: { url, method, body: body ?? null } });
    } catch (error) { throw new ApiError(0, "desktop", typeof error === "string" ? error : "Synkningen avbröts. Ditt utkast finns kvar."); }
    if (response.status >= 400) throw new ApiError(response.status, response.data.code || "desktop", response.data.error || "Anropet misslyckades.", response.data.details, response.data.retryAfter);
    return response.data as T;
  }
  let response: Response;
  try {
    response = await fetch(url, { method, cache: "no-store", headers: { "Content-Type": "application/json", "X-Gitbsidian": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError(0, "network", "Anslutningen avbröts. Ditt utkast finns kvar på den här enheten."); }
  const data = await response.json().catch(() => ({ code: "response", error: "Serverns svar kunde inte läsas. Kontrollera sparningen innan du försöker igen." }));
  if (!response.ok || data.code === "response") throw new ApiError(response.status, data.code, data.error, data.details, data.retryAfter);
  return data as T;
}
