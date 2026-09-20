import { ZodError } from "zod";
import { AppError } from "./errors";
import { appUrl } from "./config";

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store, private", "Vary": "Cookie" } });
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(appUrl()).origin || request.headers.get("x-gitbsidian") !== "1") {
    throw new AppError(403, "origin", "Anropet har fel ursprung. Öppna appen på dess konfigurerade adress.");
  }
}
export async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError(415, "content-type", "JSON krävs.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "body", "Anropet saknar innehåll.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new AppError(413, "size", "Anropet är för stort."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError(400, "body", "Ogiltig JSON."); }
}
export async function route(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error) {
    if (error instanceof ZodError) return json({ code: "validation", error: error.issues[0]?.message || "Ogiltig inmatning." }, 400);
    if (error instanceof AppError) {
      const response = json({ code: error.code, error: error.message, details: error.details, retryAfter: error.retryAfter }, error.status);
      if (error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
      return response;
    }
    // Never log payloads, tokens, user content, or unfiltered provider exceptions.
    console.error("nand: unexpected server error");
    return json({ code: "server", error: "Servern kunde inte slutföra anropet. Utkastet finns kvar." }, 500);
  }
}
