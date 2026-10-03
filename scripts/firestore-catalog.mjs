import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { validateCatalog } from "./validate-catalog.mjs";

export function priceInCents(price) {
  if (price == null || !price.trim()) return null;
  const text = price.trim().replace(/^€\s*/, "").replace(/\s*€$/, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.replaceAll(".", "").split(",");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`Preço excede o limite numérico: ${price}.`);
  return cents;
}

export function prepareCatalog(site) {
  const { summary, warnings } = validateCatalog(site);
  const categories = new Map(site.categories.map(category => [category.id, category]));
  const documents = [
    ...site.pages.filter(page => page.kind === "catalog").map(page => ({
      path: `sections/${page.section_key}`,
      data: { ...page },
    })),
    ...site.categories.map(category => ({
      path: `categories/${category.id}`,
      data: category.parent_id && !categories.has(category.parent_id)
        ? { ...category, parent_id: null, source_parent_id: category.parent_id }
        : { ...category },
    })),
    ...site.products.map(product => ({
      path: `products/${product.id}`,
      data: {
        ...product,
        section: categories.get(product.category_id).section,
        currency: "EUR",
        price_cents: priceInCents(product.price),
      },
    })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const fingerprint = createHash("sha256").update(JSON.stringify(documents)).digest("hex");
  return { documents, fingerprint, summary, warnings };
}

export async function importCatalog(db, prepared, importedAt) {
  const { documents, fingerprint, summary, warnings } = prepared;
  // Uma transação evita importações parciais ou sobrescritas concorrentes.
  if (documents.length + 1 > 500) throw new Error("Este importador atômico suporta até 499 documentos de catálogo.");
  const references = documents.map(document => db.doc(document.path));
  const marker = db.doc(`_imports/${fingerprint}`);
  return db.runTransaction(async transaction => {
    const snapshots = await transaction.getAll(...references, marker);
    const conflicts = documents.filter((document, index) => snapshots[index].exists && !isDeepStrictEqual(snapshots[index].data(), document.data));
    if (conflicts.length) throw new Error(`Importação cancelada: documentos já editados no Firebase (${conflicts.map(document => document.path).join(", ")}).`);
    let created = 0;
    for (let index = 0; index < documents.length; index++) {
      if (!snapshots[index].exists) {
        transaction.create(references[index], documents[index].data);
        created++;
      }
    }
    if (!snapshots.at(-1).exists) {
      transaction.create(marker, { schema_version: 1, fingerprint, imported_at: importedAt, sections: summary, warnings, documents: documents.length });
    }
    return { created, unchanged: documents.length - created, fingerprint };
  });
}

export async function verifyCatalog(db, prepared) {
  const snapshots = await db.getAll(...prepared.documents.map(document => db.doc(document.path)));
  const missing = [];
  const different = [];
  prepared.documents.forEach((document, index) => {
    if (!snapshots[index].exists) missing.push(document.path);
    else if (!isDeepStrictEqual(snapshots[index].data(), document.data)) different.push(document.path);
  });
  if (missing.length || different.length) {
    throw new Error(`Verificação falhou. Ausentes: ${missing.join(", ") || "nenhum"}. Diferentes: ${different.join(", ") || "nenhum"}.`);
  }
  return { verified: snapshots.length, sections: prepared.summary, fingerprint: prepared.fingerprint };
}
