import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openStore } from "./store.js";
const directory = resolve(process.env.VESPER_DATA_DIR ?? ".vesper");
const store = openStore(directory);
try {
  const { code } = store.createPairingCode();
  const file = resolve(directory, "pairing-code");
  writeFileSync(file, code + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  console.info(
    `One-time device pairing code written to ${file}. Expires in 10 minutes.`,
  );
} finally {
  store.close();
}
