import { packager } from "@electron/packager";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const staging = await mkdtemp(join(tmpdir(), "vesper-package-"));
try {
  // Only application code and its production dependencies enter the app bundle.
  // Never copy a checkout wholesale, runtime profiles, or workspace databases.
  await cp(join(root, "desktop"), join(staging, "desktop"), {
    recursive: true,
  });
  await cp(join(root, "dist"), join(staging, "dist"), { recursive: true });
  await cp(join(root, "LICENSE"), join(staging, "LICENSE"));
  await cp(join(root, "package-lock.json"), join(staging, "package-lock.json"));
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify({ ...manifest, main: "desktop/main.cjs" }, null, 2),
  );
  execFileSync(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: staging, stdio: "inherit" },
  );
  const output = join(root, "release");
  await mkdir(output, { recursive: true });
  const bundles = await packager({
    dir: staging,
    out: output,
    name: "Vesper",
    appBundleId: "app.vesper.desktop",
    appVersion: manifest.version,
    platform: "darwin",
    arch: process.arch,
    electronVersion: manifest.devDependencies.electron,
    asar: true,
    prune: false,
    overwrite: true,
  });
  for (const bundle of bundles)
    console.info(`Local Mac app: ${join(bundle, "Vesper.app")}`);
  console.info(
    "This local build is unsigned and not notarized. Public distribution remains a release task.",
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
