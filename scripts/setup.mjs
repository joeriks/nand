import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
try {
  const template = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  await writeFile(new URL("../.env.local", import.meta.url), template.replace(/^SESSION_SECRET=$/m, `SESSION_SECRET=${randomBytes(32).toString("hex")}`), { flag: "wx", mode: 0o600 });
  console.log("Skapade .env.local med en slumpmässig sessionsnyckel. Fyll i GitHub-appens inställningar lokalt och starta om servern. Nyckeln skrivs inte ut.");
} catch (error) {
  if (error.code === "EEXIST") console.log(".env.local finns redan och har inte ändrats.");
  else throw error;
}
