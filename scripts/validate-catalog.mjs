import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function catalogSource(file) {
  return file ? resolve(file) : resolve(ROOT, existsSync(resolve(ROOT, ".local/site.json")) ? ".local/site.json" : "data/site.json");
}

export function validateCatalog(site) {
  const sections = site.pages?.filter(page => page.kind === "catalog");
  if (!sections?.length || !Array.isArray(site.categories) || !Array.isArray(site.products)) {
    throw new Error("O arquivo precisa conter páginas de catálogo, categorias e produtos.");
  }
  const unique = (rows, key, label) => {
    const values = new Set();
    for (const row of rows) {
      const value = row[key];
      if (typeof value !== "string" || !value.trim() || value.includes("/") || values.has(value)) {
        throw new Error(`${label}: ${key} ausente, inválido ou duplicado (${value}).`);
      }
      values.add(value);
    }
    return values;
  };
  const sectionKeys = unique(sections, "section_key", "Seções");
  const categoryIds = unique(site.categories, "id", "Categorias");
  unique(site.products, "id", "Produtos");
  const categoryById = new Map(site.categories.map(row => [row.id, row]));
  const warnings = [];
  for (const category of site.categories) {
    if (!sectionKeys.has(category.section)) throw new Error(`Seção inexistente na categoria ${category.id}.`);
    const visited = new Set([category.id]);
    let current = category;
    while (current.parent_id) {
      const parent = categoryById.get(current.parent_id);
      if (!parent) {
        warnings.push({ category_id: category.id, missing_parent_id: current.parent_id });
        break;
      }
      if (parent.section !== category.section) throw new Error(`Categoria superior inválida em ${category.id}.`);
      if (visited.has(parent.id)) throw new Error(`Ciclo entre categorias em ${category.id}.`);
      visited.add(parent.id);
      current = parent;
    }
  }
  for (const row of [...site.categories, ...site.products]) {
    if (typeof row.name !== "string" || !row.name.trim()) throw new Error(`Nome inválido em ${row.id}.`);
    if (row.description != null && typeof row.description !== "string") throw new Error(`Descrição inválida em ${row.id}.`);
    if (!Number.isInteger(row.sort_order) || typeof row.visible !== "boolean") throw new Error(`Ordenação ou visibilidade inválida em ${row.id}.`);
  }
  for (const product of site.products) {
    if (!categoryIds.has(product.category_id)) throw new Error(`Categoria inexistente no produto ${product.id}.`);
    if (typeof product.available !== "boolean") throw new Error(`Disponibilidade inválida em ${product.id}.`);
    if (product.price != null && typeof product.price !== "string") throw new Error(`Preço inválido em ${product.id}.`);
  }
  const summary = sections.map(section => {
    const categories = site.categories.filter(row => row.section === section.section_key);
    const ids = new Set(categories.map(row => row.id));
    return { section: section.section_key, name: section.title, categories: categories.length, products: site.products.filter(row => ids.has(row.category_id)).length };
  });
  return { summary, warnings };
}

export function readCatalog(file) {
  const source = catalogSource(file);
  const site = JSON.parse(readFileSync(source, "utf8"));
  return { source, site, ...validateCatalog(site) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { source, site, summary, warnings } = readCatalog(process.argv[2]);
    console.log(JSON.stringify({ source, sections: summary, categories: site.categories.length, products: site.products.length, products_without_price: site.products.filter(product => !product.price?.trim()).length, warnings }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
