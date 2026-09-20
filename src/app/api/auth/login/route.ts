import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { appUrl, configuration } from "@/lib/server/config";
import { cookieOptions, seal } from "@/lib/server/session";
export const runtime = "nodejs";
export async function GET() {
  if (!configuration().ready) return Response.redirect(`${appUrl()}/?auth=configuration`);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  (await cookies()).set("gitbsidian_oauth", seal({ state, verifier, expires: Date.now() + 600_000 }), { ...cookieOptions(), maxAge: 600 });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID!, redirect_uri: `${appUrl()}/api/auth/callback`, state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return Response.redirect(url);
}
