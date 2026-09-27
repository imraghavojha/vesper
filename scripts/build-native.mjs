import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
if (process.platform !== "darwin")
  throw new Error("The on-device speech helper requires the macOS SDK.");
const root = resolve(import.meta.dirname, "..");
mkdirSync(resolve(root, "dist/native"), { recursive: true });
execFileSync(
  "xcrun",
  [
    "swiftc",
    "-O",
    "-parse-as-library",
    "-framework",
    "Speech",
    "-framework",
    "AVFoundation",
    resolve(root, "native/SpeechBridge.swift"),
    "-o",
    resolve(root, "dist/native/speech-bridge"),
  ],
  { cwd: root, stdio: "inherit" },
);
