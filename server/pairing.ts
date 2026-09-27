import { resolve } from "node:path";
import { openStore } from "./store.js";
const directory = resolve(process.env.VESPER_DATA_DIR ?? ".vesper");
const store = openStore(directory);
try {
  const { file } = store.publishPairingCode();
  console.info(
    `One-time device pairing code written to ${file}. Expires in 10 minutes.`,
  );
} finally {
  store.close();
}
