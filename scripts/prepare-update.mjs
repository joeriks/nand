import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Stable release version required");
const source = `src-tauri/target/release/bundle/nsis/nand_${version}_x64-setup.exe`;
const name = `nand-${version}-windows-x64-setup.exe`;
const directory = `releases/v${version}`;
const signature = (await readFile(`${source}.sig`, "utf8")).trim();
if (!signature) throw new Error("Missing updater signature");
await mkdir(directory, { recursive: true });
await copyFile(source, `${directory}/${name}`);
await copyFile(`${source}.sig`, `${directory}/${name}.sig`);
const manifest = { version, notes: `nand ${version}`, pub_date: new Date().toISOString(), platforms: {
  "windows-x86_64": { signature, url: `https://github.com/joeriks/nand/releases/download/v${version}/${name}` },
} };
await writeFile(`${directory}/latest.json`, JSON.stringify(manifest, null, 2) + "\n");
const hashes = [];
for (const file of [name, `${name}.sig`, "latest.json"]) {
  hashes.push(`${createHash("sha256").update(await readFile(`${directory}/${file}`)).digest("hex")}  ${file}`);
}
await writeFile(`${directory}/SHA256SUMS.txt`, hashes.join("\n") + "\n");
console.log(`Signed update assets prepared in ${directory}`);
