import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const target = join(root, "src-tauri/gen/android/app/src/main/java/se/gitbsidian/mobile");
await mkdir(target, { recursive: true });
for (const file of await readdir(join(root, "android/src"))) if (file.endsWith(".kt")) await copyFile(join(root, "android/src", file), join(target, file));
const manifestPath = join(root, "src-tauri/gen/android/app/src/main/AndroidManifest.xml");
let manifest = await readFile(manifestPath, "utf8");
// Credentials and WebView cache must not be backed up onto a different device/profile.
manifest = manifest.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
if (!manifest.includes('android:allowBackup=')) manifest = manifest.replace("<application", '<application android:allowBackup="false"');
manifest = manifest.replace(/android:fullBackupContent="[^"]*"/, 'android:fullBackupContent="false"');
manifest = manifest.replace(/android:windowSoftInputMode="[^"]*"/, 'android:windowSoftInputMode="adjustResize"');
if (!manifest.includes('android:windowSoftInputMode=')) manifest = manifest.replace("<activity", '<activity android:windowSoftInputMode="adjustResize"');
await writeFile(manifestPath, manifest);
console.log("Android-adaptern klar. Ingen Node-sidecar, Git eller inloggningsuppgift paketeras.");
