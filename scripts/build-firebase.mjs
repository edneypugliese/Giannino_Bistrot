import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function buildFirebase() {
  await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    entryPoints: ["src/firebase-client.js"],
    outfile: "public/assets/firebase-client.js",
    bundle: true, format: "esm", platform: "browser", target: ["es2022"],
    minify: true, legalComments: "eof", sourcemap: false,
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildFirebase();
  console.log("Firebase Authentication e Firestore preparados para GitHub Pages.");
}
