import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { appUrl, configuration } from "@/lib/server/config";
import { createSession, unseal } from "@/lib/server/session";
import { GitHub } from "@/lib/server/github";
import type { User } from "@/lib/types";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const oauth = cookieStore.get("gitbsidian_oauth")?.value;
  cookieStore.delete("gitbsidian_oauth");
  try {
    if (!configuration().ready || !oauth) throw new Error("oauth");
    const pending = unseal<{ state: string; verifier: string; expires: number }>(oauth);
    const params = new URL(request.url).searchParams;
    const state = params.get("state") || "";
    const code = params.get("code");
    const a = Buffer.from(pending.state), b = Buffer.from(state);
    if (!code || a.length !== b.length || !timingSafeEqual(a, b) || pending.expires < Date.now()) throw new Error("state");
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, code_verifier: pending.verifier, redirect_uri: `${appUrl()}/api/auth/callback` }),
    });
    const data = await response.json();
    if (!response.ok || typeof data.access_token !== "string" || !data.access_token.startsWith("ghu_")) throw new Error("token");
    const user = await new GitHub(data.access_token).request<User>("/user");
    await createSession({ token: data.access_token, user: { id: user.id, login: user.login }, expiresAt: Date.now() + Math.min(data.expires_in || 28800, 28800) * 1000 });
    return Response.redirect(`${appUrl()}/?auth=success`);
  } catch { return Response.redirect(`${appUrl()}/?auth=failed`); }
}
