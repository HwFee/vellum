import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = path.join(root, "src-tauri", "Cargo.toml");

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result.stdout;
}

const host = run("rustc", ["-vV"], true).match(/^host: (.+)$/m)?.[1]?.trim();
if (!host) throw new Error("Cannot determine the Rust host target");
const metadata = JSON.parse(run("cargo", [
  "metadata", "--manifest-path", manifest, "--format-version=1",
  "--offline", "--filter-platform", host,
], true));
run("cargo", ["build", "--manifest-path", manifest, "--release", "--lib"]);

const release = path.join(metadata.target_directory, "release");
const output = path.join(root, "outputs");
mkdirSync(output, { recursive: true });
const binary = path.join(output, process.platform === "win32"
  ? "bench-library-search.exe" : "bench-library-search");
const args = [
  "--edition=2021", "-C", "opt-level=3", "-C", "lto",
  path.join(root, "scripts", "bench-library-search.rs"),
  "--extern", `vellum_lib=${path.join(release, "libvellum_lib.rlib")}`,
  "-L", `dependency=${path.join(release, "deps")}`,
  "-o", binary,
];
if (host.endsWith("-pc-windows-msvc")) {
  const packageName = `windows_${host.split("-")[0]}_msvc`;
  const nativeDirs = new Set(metadata.packages
    .filter((pkg) => pkg.name === packageName)
    .map((pkg) => path.join(path.dirname(pkg.manifest_path), "lib")));
  for (const directory of nativeDirs) args.push("-L", `native=${directory}`);
}
run("rustc", args);
if (!process.argv.includes("--compile-only")) run(binary, []);
