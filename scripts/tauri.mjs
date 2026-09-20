import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const localCargo = join(root, ".tools/cargo");
const env = { ...process.env };
const inheritedPath = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] || "";
for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
env.PATH = `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${inheritedPath}`;
// Optional project-local CRT libraries for an incomplete host Build Tools installation.
// A normal, complete C++ installation does not need these directories.
const extraLibraries = [".tools/msvc-crt/Contents/VC/Tools/MSVC/14.51.36231/lib/x64", ".tools/msvc-crt-onecore/Contents/VC/Tools/MSVC/14.51.36231/lib/onecore/x64"].map(path => join(root, path)).filter(existsSync);
if (extraLibraries.length) env.LIB = [...extraLibraries, env.LIB || ""].join(";");
if (existsSync(join(localCargo, "bin/cargo.exe"))) {
  env.CARGO_HOME = localCargo;
  env.RUSTUP_HOME = join(root, ".tools/rustup");
  env.PATH = `${join(localCargo, "bin")}${process.platform === "win32" ? ";" : ":"}${env.PATH}`;
}
if (process.argv.includes("android")) {
  const jdk = join(root, ".tools/jdk");
  if (!env.JAVA_HOME && existsSync(jdk)) env.JAVA_HOME = join(jdk, readdirSync(jdk)[0]);
  env.ANDROID_HOME ||= join(root, ".tools/android-sdk");
  env.ANDROID_USER_HOME ||= join(root, ".tools/android-user");
  env.ANDROID_AVD_HOME ||= join(root, ".tools/avd");
  env.GRADLE_USER_HOME ||= join(root, ".tools/gradle");
  const ndks = join(env.ANDROID_HOME, "ndk");
  if (!env.NDK_HOME && existsSync(ndks)) env.NDK_HOME = join(ndks, readdirSync(ndks).sort().at(-1));
  env.PATH = [env.JAVA_HOME && join(env.JAVA_HOME, "bin"), join(env.ANDROID_HOME, "platform-tools"), env.PATH].filter(Boolean).join(";");
}
// Invoke the JS CLI directly: no shell interpolation of arguments.
const child = spawn(process.execPath, [join(root, "node_modules/@tauri-apps/cli/tauri.js"), ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 1));
