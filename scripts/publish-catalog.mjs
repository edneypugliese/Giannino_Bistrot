import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { connectCatalog } from "./firebase-client.mjs";
import { Timestamp } from "@google-cloud/firestore";
import { publicCatalogDocument, SECTION_LABELS } from "../public/assets/catalog-model.js";

// Inicializa ou reconstrói as projeções públicas a partir dos dados remotos.
// Não modifica produtos, categorias, seções nem registros de importação.
export async function publishCatalog(db, { dryRun = false, now = Timestamp.now() } = {}) {
  return db.runTransaction(async transaction => {
    const revision = await transaction.get(db.doc("_catalog/revision"));
    const data = {};
    for (const table of ["sections", "categories", "products"]) {
      const snapshot = await transaction.execute(db.pipeline().collection(table));
      data[table] = snapshot.results.map(row => ({ ...row.data(), id: row.id }));
    }
    const publications = Object.keys(SECTION_LABELS).map(section => ({ section, value: publicCatalogDocument(data, section, now) }));
    const result = publications.map(({ section, value }) => ({ section, ...Object.fromEntries(Object.entries(JSON.parse(value.payload)).map(([table, rows]) => [table, rows.length])) }));
    if (!dryRun) {
      for (const { section, value } of publications) transaction.set(db.doc(`public_catalogs/${section}`), value);
      transaction.set(db.doc("_catalog/revision"), { revision: (revision.exists ? revision.data().revision || 0 : 0) + 1, updated_at: now });
    }
    return result;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const connection = await connectCatalog(process.argv.includes("--auth-adc") ? "adc" : "cli");
  try {
    const dryRun = process.argv.includes("--dry-run");
    const result = await publishCatalog(connection.db, { dryRun });
    console.log(JSON.stringify({ project: connection.project, database: connection.database, dryRun, sections: result }, null, 2));
  } finally { await connection.db.terminate(); }
}
