import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
const root = resolve(import.meta.dirname, "..");
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Den här byggkonfigurationen stöder Windows x64. Lägg till en matchande sidecar och säkert inloggningslager innan andra plattformar byggs.");
const resources = join(root, "src-tauri/resources");
await mkdir(resources, { recursive: true }); await mkdir(join(root, "src-tauri/binaries"), { recursive: true });
await build({ entryPoints: [join(root, "desktop/backend.ts")], outfile: join(resources, "backend.cjs"), bundle: true, platform: "node", target: "node24", format: "cjs", legalComments: "eof", tsconfig: join(root, "tsconfig.json") });
await copyFile(process.execPath, join(root, "src-tauri/binaries/gitbsidian-node-x86_64-pc-windows-msvc.exe"));
const nodeLicense = join(resources, "NODE-LICENSE.txt");
if (!existsSync(nodeLicense)) {
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`);
  if (!response.ok) throw new Error("Kunde inte hämta Node-licensen. Installationspaketet byggs inte utan licenser.");
  await writeFile(nodeLicense, await response.text());
}
// Include licenses for both frontend packages and dependencies bundled into the sidecar.
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const notices = [];
for (const path of Object.keys(lock.packages || {}).filter(path => path.startsWith("node_modules/"))) {
  const directory = join(root, path);
  try {
    const names = await readdir(directory);
    const licenses = names.filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name));
    for (const name of licenses) { try { notices.push(`${path} / ${name}\n\n${await readFile(join(directory, name), "utf8")}\n`); } catch { /* License directory, not file. */ } }
  } catch { /* Optional packages for other platforms aren't installed. */ }
}
const cargoRoot = process.env.CARGO_HOME || (existsSync(join(root, ".tools/cargo")) ? join(root, ".tools/cargo") : join(homedir(), ".cargo"));
const registries = join(cargoRoot, "registry/src");
if (existsSync(registries)) {
  for (const registry of await readdir(registries)) {
    for (const crate of await readdir(join(registries, registry))) {
      const directory = join(registries, registry, crate);
      for (const name of (await readdir(directory)).filter(name => /^(license|licence|copying|notice)([-.]|$)/i.test(name))) {
        try { notices.push(`Rust: ${crate} / ${name}\n\n${await readFile(join(directory, name), "utf8")}\n`); } catch { /* Directory. */ }
      }
    }
  }
}
await writeFile(join(resources, "THIRD-PARTY-NOTICES.txt"), notices.join("\n\n"));
console.log("Skrivbordsresurser klara. Inga .env-filer eller inloggningsuppgifter paketeras.");
