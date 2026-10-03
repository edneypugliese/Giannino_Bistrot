import { parseArgs } from "node:util";
import { readCatalog } from "./validate-catalog.mjs";
import { prepareCatalog, importCatalog, verifyCatalog } from "./firestore-catalog.mjs";

async function main() {
  const { values, positionals } = parseArgs({ options: { source: { type: "string" }, auth: { type: "string", default: "cli" } }, allowPositionals: true });
  const command = positionals[0] || "plan";
  if (!["plan", "import", "verify"].includes(command) || positionals.length > 1) throw new Error("Use plan, import ou verify, com --source e --auth opcionais.");
  const { source, site } = readCatalog(values.source);
  const prepared = prepareCatalog(site);
  if (command === "plan") {
    console.log(JSON.stringify({ source, documents: prepared.documents.length, sections: prepared.summary, fingerprint: prepared.fingerprint, warnings: prepared.warnings, products_without_price: site.products.filter(product => !product.price?.trim()).length }, null, 2));
    return;
  }
  const { connectCatalog } = await import("./firebase-client.mjs");
  const { Timestamp } = await import("@google-cloud/firestore");
  const { db, project, database, location } = await connectCatalog(values.auth);
  try {
    const imported = command === "import" ? await importCatalog(db, prepared, Timestamp.now()) : undefined;
    const verified = await verifyCatalog(db, prepared);
    console.log(JSON.stringify({ project, database, location, source, imported, ...verified }, null, 2));
  } finally {
    await db.terminate();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
