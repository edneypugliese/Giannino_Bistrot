// Modelo compartilhado pela tela e pela persistência do catálogo.
export const EMPTY_CATALOG = { sections: [], categories: [], products: [] };
export const SECTION_LABELS = { menu: "Menù", caffetteria: "Caffetteria", drink: "Drink List", vini: "Carta dei Vini" };

export function sorted(rows) {
  return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""), "it"));
}

export function categoryPath(category, categories) {
  const names = [];
  const visited = new Set();
  while (category && !visited.has(category.id)) {
    visited.add(category.id);
    names.unshift(category.name);
    category = categories.find(row => row.id === category.parent_id);
  }
  return names.join(" › ");
}

export function isPublished(product, categories, sections = []) {
  if (!product.visible || !product.available) return false;
  let category = categories.find(row => row.id === product.category_id);
  if (!category) return false;
  if (sections.find(section => (section.section_key || section.id) === category.section)?.visible === false) return false;
  const visited = new Set();
  while (category) {
    if (!category.visible || visited.has(category.id)) return false;
    visited.add(category.id);
    category = categories.find(row => row.id === category.parent_id);
  }
  return true;
}

function publicCategory(category, catalog, section) {
  const visited = new Set();
  while (category) {
    if (!category.visible || category.section !== section || visited.has(category.id)) return false;
    visited.add(category.id);
    category = catalog.categories.find(row => row.id === category.parent_id);
  }
  return true;
}

// Nunca publica campos extras, metadados internos ou registros ocultos.
export function publicCatalog(catalog, section) {
  const definition = catalog.sections.find(row => (row.section_key || row.id) === section);
  if (!definition || !definition.visible) return { categories: [], products: [] };
  const pick = (row, fields) => Object.fromEntries(fields.filter(key => key in row).map(key => [key, row[key]]));
  const categories = sorted(catalog.categories.filter(row => row.section === section && publicCategory(row, catalog, section)));
  const ids = new Set(categories.map(row => row.id));
  return {
    categories: categories.map(row => pick(row, ["id", "section", "name", "description", "schedule", "parent_id", "sort_order", "visible"])),
    products: sorted(catalog.products.filter(row => ids.has(row.category_id) && row.visible && row.available))
      .map(row => pick(row, ["id", "category_id", "name", "description", "price", "sort_order", "visible", "available"])),
  };
}

export function publicCatalogDocument(catalog, section, updatedAt = new Date().toISOString()) {
  const payload = JSON.stringify(publicCatalog(catalog, section));
  if (payload.length > 500000) throw new Error("Il catalogo supera il limite di pubblicazione. Riduci le descrizioni prima di salvare.");
  return { schema_version: 1, payload, updated_at: updatedAt };
}

export function filterCatalog(catalog, { section = "", category = "", status = "", search = "", view = "products" } = {}) {
  const term = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it");
  const matches = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").includes(term);
  return sorted(catalog[view]).filter(row => {
    const parent = view === "products" ? catalog.categories.find(item => item.id === row.category_id) : row;
    if (section && parent?.section !== section) return false;
    if (category && (view === "products" ? row.category_id !== category : row.id !== category && row.parent_id !== category)) return false;
    if (status === "hidden" && row.visible) return false;
    if (status === "visible" && !row.visible) return false;
    if (view === "products" && status === "unavailable" && row.available) return false;
    if (view === "products" && status === "published" && !isPublished(row, catalog.categories, catalog.sections)) return false;
    return !term || [row.name, row.description, row.price, row.schedule, row.id, categoryPath(parent, catalog.categories), SECTION_LABELS[parent?.section] || parent?.section].some(matches);
  });
}

function text(value, label, { required = false, max = 4000 } = {}) {
  if (value != null && typeof value !== "string") throw new Error(`${label}: valore non valido.`);
  const clean = (value || "").trim();
  if (required && !clean) throw new Error(`${label} è obbligatorio.`);
  if (clean.length > max) throw new Error(`${label}: massimo ${max} caratteri.`);
  return clean || null;
}

function order(value) {
  if (value === "" || value == null) throw new Error("Inserisci un ordine valido.");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 1000000) throw new Error("L'ordine deve essere un numero intero tra 0 e 1000000.");
  return number;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label}: valore non valido.`);
  return value;
}

export function euroCents(price) {
  if (!price) return null;
  const clean = price.replace(/^€\s*/, "").replace(/\s*€$/, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(clean)) return null;
  const [whole, decimal = ""] = clean.replaceAll(".", "").split(",");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Prezzo troppo grande.");
  return cents;
}

export function productValues(input, catalog) {
  const category = catalog.categories.find(row => row.id === input.category_id);
  if (!category) throw new Error("Seleziona una categoria valida.");
  const price = text(input.price, "Prezzo", { max: 100 });
  return {
    name: text(input.name, "Il nome", { required: true, max: 200 }),
    description: text(input.description, "Descrizione"),
    category_id: category.id,
    section: category.section,
    price,
    price_cents: euroCents(price),
    currency: "EUR",
    sort_order: order(input.sort_order),
    visible: boolean(input.visible, "Visibilità"),
    available: boolean(input.available, "Disponibilità"),
  };
}

export function categoryValues(input, catalog) {
  if (!catalog.sections.some(row => (row.section_key || row.id) === input.section)) throw new Error("Seleziona una sezione valida.");
  const parentId = input.parent_id || null;
  let parent = parentId && catalog.categories.find(row => row.id === parentId);
  if (parentId && (!parent || parent.section !== input.section)) throw new Error("La categoria superiore deve appartenere alla stessa sezione.");
  const visited = new Set(input.id ? [input.id] : []);
  while (parent) {
    if (visited.has(parent.id)) throw new Error("Una categoria non può contenere se stessa.");
    visited.add(parent.id);
    parent = catalog.categories.find(row => row.id === parent.parent_id);
  }
  const existing = catalog.categories.find(row => row.id === input.id);
  if (existing && existing.section !== input.section) throw new Error("La sezione di una categoria esistente non può essere cambiata. Crea una categoria nella sezione desiderata e sposta i prodotti.");
  return {
    section: input.section,
    name: text(input.name, "Il nome", { required: true, max: 200 }),
    description: text(input.description, "Descrizione"),
    schedule: text(input.schedule, "Orario", { max: 200 }),
    parent_id: parentId,
    sort_order: order(input.sort_order),
    visible: boolean(input.visible, "Visibilità"),
  };
}
