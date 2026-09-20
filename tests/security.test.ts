import { afterEach, describe, expect, it, vi } from "vitest";
import { pathSchema, repositoryPath, saveSchema } from "@/lib/validation";
import { checkOrigin } from "@/lib/server/http";
import { seal, unseal } from "@/lib/server/session";
import { configuration } from "@/lib/server/config";
afterEach(() => vi.unstubAllEnvs());
describe("workspace validation", () => {
  it.each(["../secret.md", "/note.md", "folder/../note.md", "a\\note.md", "a//note.md", ".git/config.md", "%2e%2e/note.md", "note.md?ref=main", "note.md#fragment", "note\u0000.md", "note.txt"])("rejects unsafe path %s", path => {
    expect(pathSchema.safeParse(path).success).toBe(false);
  });
  it("supports Swedish names and spaces inside the selected root", () => { expect(repositoryPath("anteckningar", "Odling/Årets idéer.md")).toBe("anteckningar/Odling/Årets idéer.md"); });
  it("checks size in UTF-8 bytes", () => { expect(saveSchema.safeParse({ path: "a.md", baseSha: null, text: "å".repeat(600_000) }).success).toBe(false); });
});
describe("session and request boundaries", () => {
  it("requires same configured Origin and the custom header on writes", () => {
    vi.stubEnv("APP_URL", "https://notes.example");
    expect(() => checkOrigin(new Request("https://notes.example/api/notes", { headers: { Origin: "https://attacker.example", "X-Gitbsidian": "1" } }))).toThrow();
    expect(() => checkOrigin(new Request("https://notes.example/api/notes", { headers: { Origin: "https://notes.example" } }))).toThrow();
    expect(() => checkOrigin(new Request("https://notes.example/api/notes", { headers: { Origin: "https://notes.example", "X-Gitbsidian": "1" } }))).not.toThrow();
  });
  it("encrypts server data and detects tampering", () => {
    vi.stubEnv("SESSION_SECRET", "d".repeat(64));
    const content = { token: "test-token-not-real", user: 1 };
    const encrypted = seal(content);
    expect(encrypted).not.toContain(content.token); expect(unseal(encrypted)).toEqual(content);
    const bytes = Buffer.from(encrypted, "base64url"); bytes[30] ^= 1;
    expect(() => unseal(bytes.toString("base64url"))).toThrow();
  });
  it("does not treat an invalid secret as configured", () => { vi.stubEnv("SESSION_SECRET", "short"); expect(configuration().ready).toBe(false); });
});
