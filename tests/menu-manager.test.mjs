import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { categoryPath, filterCatalog, groupProducts, productValues, categoryValues, publicCatalog, publicCatalogDocument, euroCents } from "../public/assets/catalog-model.js";
import { createCatalogClient } from "../src/catalog-store.js";

const catalog = () => ({
  sections: [{ id: "menu", section_key: "menu", title: "Menù", visible: true }, { id: "drink", section_key: "drink", title: "Drink List", visible: true }],
  categories: [
    { id: "main", section: "menu", name: "Piatti", parent_id: null, visible: true, sort_order: 0 },
    { id: "child", section: "menu", name: "Specialità", parent_id: "main", visible: true, sort_order: 1 },
    { id: "bar", section: "drink", name: "Cocktail", parent_id: null, visible: true, sort_order: 0 },
  ],
  products: [
    { id: "one", name: "Caffè speciale", description: "Descrizione", category_id: "child", price: "15,00", visible: true, available: true, sort_order: 0 },
    { id: "two", name: "Spritz", category_id: "bar", price: "9,00", visible: false, available: true, sort_order: 0 },
    { id: "three", name: "Pasta", category_id: "main", price: null, visible: true, available: false, sort_order: 1 },
  ],
});

test("a busca combina seção, categoria e texto sem excluir registros legados", () => {
  const data = catalog();
  assert.equal(filterCatalog(data).length, 3);
  assert.deepEqual(filterCatalog(data, { section: "menu", category: "child", search: "caffe" }).map(row => row.id), ["one"]);
  assert.deepEqual(filterCatalog(data, { section: "drink", search: "spritz" }).map(row => row.id), ["two"]);
  assert.deepEqual(filterCatalog(data, { section: "menu", search: "spritz" }), []);
  assert.equal(filterCatalog(data, { search: "specialita" }).length, 1);
  assert.equal(categoryPath(data.categories[1], data.categories), "Piatti › Specialità");
});

test("grupos preservam ordem e hierarquia de categorias, sem dividir ou perder produtos", () => {
  const data = catalog();
  data.categories[1].sort_order = 0;
  data.categories[0].sort_order = 5;
  data.products.push({ ...data.products[0], id: "four", sort_order: 2 });
  const groups = groupProducts(data.products, data.categories);
  assert.deepEqual(groups.map(group => group.category.id), ["bar", "main", "child"]);
  assert.deepEqual(groups.find(group => group.category.id === "child").products.map(row => row.id), ["one", "four"]);
  assert.equal(groups.flatMap(group => group.products).length, data.products.length);
  const matches = filterCatalog(data, { section: "menu", search: "specialita" });
  assert.deepEqual(groupProducts(matches, data.categories).map(group => group.category.id), ["child"]);
  assert.equal(groupProducts([{ id: "orphan", category_id: "missing" }], data.categories)[0].category, null);
});

test("preços aceitam euros italianos, ausência de preço e notas sem perder centavos", () => {
  assert.equal(euroCents("€ 1.250,50"), 125050);
  assert.equal(euroCents("15,5"), 1550);
  assert.equal(euroCents("al calice"), null);
  assert.equal(euroCents(null), null);
  const row = productValues({ ...catalog().products[0], price: " 15,50 ", name: " Teste " }, catalog());
  assert.equal(row.name, "Teste");
  assert.equal(row.price_cents, 1550);
  assert.equal(row.section, "menu");
  assert.equal(row.currency, "EUR");
  assert.equal(productValues({ ...row, price: "" }, catalog()).price, null);
  assert.throws(() => productValues({ ...row, name: " " }, catalog()), /obbligatorio/);
  assert.throws(() => productValues({ ...row, category_id: "missing" }, catalog()), /categoria/);
  const published = productValues({ ...row, visible: false, available: false }, catalog());
  assert.equal(published.visible, true);
  assert.equal(published.available, true);
  assert.equal(categoryValues({ ...catalog().categories[0], visible: false }, catalog()).visible, true);
  assert.throws(() => productValues({ ...row, sort_order: -1 }, catalog()), /ordine/);
  assert.throws(() => productValues({ ...row, description: "a".repeat(4001) }, catalog()), /4000/);
});

test("categorias rejeitam ciclos, pais de outra seção e mudanças de seção", () => {
  const data = catalog();
  assert.throws(() => categoryValues({ ...data.categories[0], parent_id: "child" }, data), /se stessa/);
  assert.throws(() => categoryValues({ ...data.categories[0], parent_id: "bar" }, data), /stessa sezione/);
  assert.throws(() => categoryValues({ ...data.categories[0], section: "drink" }, data), /non può essere cambiata/);
  assert.equal(categoryValues({ ...data.categories[1], parent_id: "" }, data).parent_id, null);
});

test("projeção pública inclui todo o cardápio mesmo com flags antigas e mantém metadados privados", () => {
  const data = catalog();
  data.products[0].private_note = "Nunca publicar";
  data.products[0].created_at = "2026-10-03";
  let result = publicCatalog(data, "menu");
  assert.deepEqual(result.products.map(row => row.id), ["one", "three"]);
  assert.ok(!JSON.stringify(result).includes("Nunca publicar"));
  assert.ok(!JSON.stringify(result).includes("created_at"));
  data.categories[0].visible = false;
  result = publicCatalog(data, "menu");
  assert.equal(result.categories.length, 2);
  assert.equal(result.products.length, 2);
  data.sections[0].visible = false;
  assert.equal(publicCatalog(data, "menu").products.length, 2);
  assert.ok(publicCatalog(data, "menu").categories.every(row => row.visible === true));
  assert.ok(publicCatalog(data, "menu").products.every(row => row.visible === true && row.available === true));
  assert.equal(publicCatalog(data, "drink").products[0].visible, true);
  assert.equal(publicCatalogDocument(data, "menu").schema_version, 1);
});

function database() {
  const values = catalog();
  const documents = new Map(Object.entries(values).flatMap(([table, rows]) => rows.map(row => [`${table}/${row.id}`, structuredClone(row)])));
  let sequence = 0;
  const snapshots = path => ({ id: path.split("/").at(-1), exists: () => documents.has(path), data: () => structuredClone(documents.get(path)) });
  const sdk = {
    serverTimestamp: () => new Date().toISOString(),
    collection: (_db, name) => ({ path: name }),
    doc: (base, table, id) => base?.path ? { id: `new-${++sequence}`, path: `${base.path}/new-${sequence}` } : { id, path: `${table}/${id}` },
    field: name => ({ ascending: () => ({ name }) }),
    execute: async pipeline => ({ results: [...documents.entries()].filter(([path]) => path.startsWith(pipeline.table + "/")).map(([path, row]) => ({ id: path.split("/").at(-1), data: () => structuredClone(row) })) }),
    runTransaction: async (_db, callback) => {
      const changes = [];
      const result = await callback({
        get: async reference => snapshots(reference.path),
        set: (reference, row) => changes.push(() => documents.set(reference.path, structuredClone(row))),
        update: (reference, row) => changes.push(() => documents.set(reference.path, { ...documents.get(reference.path), ...structuredClone(row) })),
        delete: reference => changes.push(() => documents.delete(reference.path)),
      });
      changes.forEach(change => change());
      return result;
    },
  };
  const db = { pipeline: () => ({ collection: table => ({ table, sort() { return this; } }) }) };
  return { documents, sdk, db, client: createCatalogClient(db, { sdk }) };
}

test("CRUD de produto preserva campos extras, calcula preço e persiste remoção com revisão", async () => {
  const { client, documents } = database();
  const draft = { ...catalog().products[0], id: undefined, name: "Produto novo", price: "12,50" };
  const created = await client.saveProduct(draft);
  const saved = documents.get(`products/${created.id}`);
  assert.equal(saved.price_cents, 1250);
  assert.equal(saved.currency, "EUR");
  assert.equal(saved.section, "menu");
  let publicMenu = JSON.parse(documents.get("public_catalogs/menu").payload);
  assert.ok(publicMenu.products.some(row => row.id === created.id && row.price === "12,50"));
  assert.ok(saved.created_at && saved.updated_at);
  documents.set(`products/${created.id}`, { ...saved, nota_original: "Preservar" });
  const before = documents.get(`products/${created.id}`);
  await client.saveProduct({ ...before, category_id: "bar", price: null, available: false }, before);
  const changed = documents.get(`products/${created.id}`);
  assert.equal(changed.section, "drink");
  assert.equal(changed.price_cents, null);
  assert.equal(changed.nota_original, "Preservar");
  assert.equal(changed.created_at, saved.created_at);
  publicMenu = JSON.parse(documents.get("public_catalogs/menu").payload);
  const publicDrinks = JSON.parse(documents.get("public_catalogs/drink").payload);
  assert.ok(!publicMenu.products.some(row => row.id === created.id));
  assert.ok(publicDrinks.products.some(row => row.id === created.id));
  assert.equal(changed.visible, true);
  assert.equal(changed.available, true);
  await client.deleteProduct(changed);
  assert.equal(documents.has(`products/${created.id}`), false);
  assert.equal(documents.get("_catalog/revision").revision, 3);
});

test("uma edição concorrente ou exclusão remota não é sobrescrita", async () => {
  const { client, documents } = database();
  const stale = documents.get("products/one");
  documents.set("products/one", { ...stale, name: "Alterado no outro editor" });
  await assert.rejects(client.saveProduct({ ...stale, price: "99,00" }, stale), /un'altra finestra/);
  await assert.rejects(client.deleteProduct(stale), /un'altra finestra/);
  assert.equal(documents.get("products/one").name, "Alterado no outro editor");
  assert.equal(documents.has("_catalog/revision"), false);
  documents.delete("products/one");
  await assert.rejects(client.saveProduct(stale, stale), /eliminato/);
});

test("categorias só podem ser removidas quando vazias e validações não gravam dados parciais", async () => {
  const { client, documents } = database();
  const main = documents.get("categories/main");
  await assert.rejects(client.deleteCategory(main), /contiene prodotti/);
  await assert.rejects(client.saveCategory({ ...main, parent_id: "child" }, main), /se stessa/);
  assert.equal(documents.has("_catalog/revision"), false);
  assert.equal(documents.get("categories/main").parent_id, null);
  const created = await client.saveCategory({ section: "menu", name: "Vuota", parent_id: null, description: null, schedule: null, sort_order: 4, visible: false });
  assert.equal(documents.get(`categories/${created.id}`).visible, true);
  await client.deleteCategory(documents.get(`categories/${created.id}`));
  assert.equal(documents.has(`categories/${created.id}`), false);
  assert.equal(documents.has("categories/main"), true);
  await assert.rejects(client.saveProduct({ ...catalog().products[0], category_id: "../main" }, catalog().products[0]), /ID non valido/);
});

test("alterações de categoria republicam os filhos e falhas de publicação são atômicas", async () => {
  const { client, documents } = database();
  const main = documents.get("categories/main");
  await client.saveCategory({ ...main, visible: false }, main);
  assert.equal(documents.get("categories/main").visible, true);
  assert.equal(JSON.parse(documents.get("public_catalogs/menu").payload).products.length, 2);
  await client.saveCategory({ ...main, visible: true }, documents.get("categories/main"));
  assert.equal(JSON.parse(documents.get("public_catalogs/menu").payload).products.length, 2);
  for (let index = 0; index < 150; index++) documents.set(`products/large-${index}`, { ...catalog().products[0], id: `large-${index}`, description: "x".repeat(4000) });
  const before = documents.get("products/one");
  await assert.rejects(client.saveProduct({ ...before, price: "11,50" }, before), /limite di pubblicazione/);
  assert.deepEqual(documents.get("products/one"), before);
  assert.equal(documents.get("_catalog/revision").revision, 2);
});

test("a leitura pública usa somente a projeção permitida e rejeita payload inválido", async () => {
  const { client, documents, sdk, db } = database();
  await client.saveProduct({ ...catalog().products[0], price: "20,00" }, documents.get("products/one"));
  sdk.getDocFromServer = async reference => ({ exists: () => documents.has(reference.path), data: () => documents.get(reference.path) });
  const publicClient = createCatalogClient(db, { sdk });
  assert.equal((await publicClient.readPublicCatalog("menu")).products[0].price, "20,00");
  await assert.rejects(publicClient.readPublicCatalog("../../products"), /Sezione non valida/);
  documents.set("public_catalogs/menu", { schema_version: 1, payload: '{"products":null}' });
  await assert.rejects(publicClient.readPublicCatalog("menu"), /non valido/);
});

test("listeners esperam os dados do servidor, incluem registros ocultos e encerram no erro", async () => {
  const { db, sdk } = database();
  const callbacks = new Map();
  const stopped = [];
  sdk.onSnapshot = (reference, _options, success, failure) => {
    callbacks.set(reference.path, { success, failure });
    return () => stopped.push(reference.path);
  };
  const data = catalog();
  const results = [];
  const errors = [];
  const client = createCatalogClient(db, { sdk, timeoutMs: 1000 });
  const stop = client.subscribeCatalog(value => results.push(value), error => errors.push(error));
  const snapshot = (table, fromCache = false) => ({ metadata: { fromCache, hasPendingWrites: false }, docs: data[table].map(row => ({ id: row.id, data: () => row })) });
  callbacks.get("products").success(snapshot("products", true));
  callbacks.get("sections").success(snapshot("sections"));
  callbacks.get("categories").success(snapshot("categories"));
  assert.equal(results.length, 0);
  callbacks.get("products").success(snapshot("products"));
  assert.equal(results[0].products.length, 3);
  data.products[0].name = "Novo nome em outra aba";
  callbacks.get("products").success(snapshot("products"));
  assert.equal(results.at(-1).products.find(row => row.id === "one").name, "Novo nome em outra aba");
  callbacks.get("products").failure({ code: "permission-denied" });
  assert.equal(errors.length, 1);
  assert.equal(stopped.length, 3);
  stop();
});

test("os quatro catálogos e todos os registros do banco cabem no modelo de gerenciamento", () => {
  const site = JSON.parse(readFileSync(new URL("../data/site.json", import.meta.url), "utf8"));
  const data = { ...site, sections: site.pages.filter(row => row.kind === "catalog") };
  assert.equal(filterCatalog(data).length, 282);
  assert.equal(filterCatalog(data, { view: "categories" }).length, 63);
  for (const product of data.products) assert.equal(productValues(product, data).name, product.name);
});
