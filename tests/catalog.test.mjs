import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCatalog } from "../scripts/validate-catalog.mjs";
import { prepareCatalog, priceInCents } from "../scripts/firestore-catalog.mjs";

const snapshot = () => JSON.parse(readFileSync(new URL("../data/site.json", import.meta.url), "utf8"));

test("validação preserva os 282 produtos e sinaliza pais ausentes do snapshot", () => {
  const site = snapshot();
  const before = structuredClone(site);
  const { summary, warnings } = validateCatalog(site);
  assert.deepEqual(summary.map(row => [row.section, row.categories, row.products]), [
    ["menu", 5, 24], ["caffetteria", 1, 20], ["drink", 19, 119], ["vini", 38, 119],
  ]);
  assert.equal(warnings.length, 2);
  assert.equal(site.products.filter(product => product.price == null).length, 30);
  assert.deepEqual(site, before);
});

test("validação rejeita IDs duplicados, produtos órfãos e hierarquia circular", () => {
  const duplicated = snapshot();
  duplicated.products.push(structuredClone(duplicated.products[0]));
  assert.throws(() => validateCatalog(duplicated), /duplicado/);
  const orphan = snapshot();
  orphan.products[0].category_id = "missing";
  assert.throws(() => validateCatalog(orphan), /Categoria inexistente/);
  const cycle = snapshot();
  cycle.categories[0].parent_id = cycle.categories[1].id;
  cycle.categories[1].parent_id = cycle.categories[0].id;
  assert.throws(() => validateCatalog(cycle), /Ciclo/);
});

test("validação rejeita categoria superior em outra seção e preço sem formato textual", () => {
  const invalidParent = snapshot();
  invalidParent.categories[0].parent_id = invalidParent.categories.find(row => row.section === "vini").id;
  assert.throws(() => validateCatalog(invalidParent), /Categoria superior inválida/);
  const invalidPrice = snapshot();
  invalidPrice.products[0].price = 15;
  assert.throws(() => validateCatalog(invalidPrice), /Preço inválido/);
});

test("migração preserva preços originais e converte euros sem arredondamento", () => {
  assert.equal(priceInCents("15,00"), 1500);
  assert.equal(priceInCents("1,20"), 120);
  assert.equal(priceInCents("€ 1.234,56"), 123456);
  assert.equal(priceInCents("1,5"), 150);
  assert.equal(priceInCents(null), null);
  assert.equal(priceInCents("a partire da 10,00"), null);
  const site = snapshot();
  const before = structuredClone(site);
  const { documents, fingerprint } = prepareCatalog(site);
  assert.equal(documents.length, 349);
  assert.equal(fingerprint, prepareCatalog(site).fingerprint);
  for (const product of site.products) {
    const data = documents.find(document => document.path === `products/${product.id}`).data;
    for (const [key, value] of Object.entries(product)) assert.deepEqual(data[key], value);
    assert.equal(data.currency, "EUR");
    assert.equal(data.section, site.categories.find(category => category.id === product.category_id).section);
    assert.equal(data.price_cents, product.price == null ? null : priceInCents(product.price));
  }
  const categoryDocuments = documents.filter(document => document.path.startsWith("categories/"));
  assert.equal(categoryDocuments.filter(document => document.data.source_parent_id).length, 2);
  for (const { data } of categoryDocuments) {
    if (data.parent_id) assert.ok(categoryDocuments.some(document => document.data.id === data.parent_id));
    if (data.source_parent_id) assert.equal(data.parent_id, null);
  }
  assert.deepEqual(site, before);
});
