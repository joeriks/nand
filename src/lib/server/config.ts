export function configuration() {
  const values = {
    APP_URL: process.env.APP_URL,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (values.SESSION_SECRET && !/^[a-f\d]{64}$/i.test(values.SESSION_SECRET)) missing.push("SESSION_SECRET (64 hextecken)");
  if (values.APP_URL) {
    try {
      const url = new URL(values.APP_URL);
      if (url.origin !== values.APP_URL || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) missing.push("APP_URL (HTTPS eller localhost)");
    } catch { missing.push("APP_URL (ogiltig URL)"); }
  }
  return { ready: missing.length === 0, missing, installUrl: values.GITHUB_APP_SLUG ? `https://github.com/apps/${encodeURIComponent(values.GITHUB_APP_SLUG)}/installations/new` : null };
}
export function appUrl(): string { return process.env.APP_URL || "http://localhost:3000"; }
