import { readFile } from "node:fs/promises";
import { cliAuthClient } from "./firebase-client.mjs";

const project = "giannino-bistrot";
const admin = { uid: "test-admin", token: { email: "edneypugleise@gmail.com", email_verified: true, firebase: { sign_in_provider: "google.com" } } };
const other = { ...admin, uid: "test-other", token: { ...admin.token, email: "other@example.com", admin: true } };
const unverified = { ...admin, token: { ...admin.token, email_verified: false } };
const password = { ...admin, token: { ...admin.token, firebase: { sign_in_provider: "password" } } };
const missing = { uid: "test-missing", token: { admin: true } };
const cases = [];
function check(label, auth, method, path, allow, data, resource) {
  const row = { label, test: {
    expectation: allow ? "ALLOW" : "DENY",
    request: { auth, method, time: "2026-10-03T08:00:00.000Z", path: "/databases/catalogo/documents/" + path, ...(data ? { resource: { data } } : {}) },
    ...(resource ? { resource: { data: resource } } : {}),
  } };
  cases.push(row);
  return row.test;
}
for (const [name, auth] of [["anonymous", null], ["other Google with admin claim", other], ["unverified email", unverified], ["password provider", password], ["missing email", missing], ["verified administrator", admin]]) {
  for (const table of ["sections", "categories", "products"]) {
    for (const method of ["get", "list"]) check(`${name}: ${table} ${method}`, auth, method, `${table}/test`, auth === admin);
    for (const method of ["create", "update", "delete"]) if (auth !== admin) check(`${name}: ${table} ${method}`, auth, method, `${table}/test`, false, { name: "injection", role: "admin" });
  }
  check(`${name}: import access`, auth, "get", "_imports/test", false);
  check(`${name}: arbitrary role write`, auth, "create", "users/test", false, { admin: true });
  check(`${name}: revision read`, auth, "get", "_catalog/revision", auth === admin);
  check(`${name}: revision delete`, auth, "delete", "_catalog/revision", false);
}
const revision = { revision: 1, updated_at: "2026-10-03T08:00:00.000Z" };
check("admin can initialize revision", admin, "create", "_catalog/revision", true, revision);
check("admin cannot skip revision", admin, "update", "_catalog/revision", false, { ...revision, revision: 4 }, revision);
check("admin can increment revision", admin, "update", "_catalog/revision", true, { ...revision, revision: 2 }, revision);
check("admin cannot inject revision fields", admin, "create", "_catalog/revision", false, { ...revision, role: "admin" });
check("admin cannot write negative revision", admin, "create", "_catalog/revision", false, { ...revision, revision: -1 });

const now = revision.updated_at;
const product = { id: "test-product", category_id: "test-category", section: "menu", name: "Test", description: null, price: "12,00", price_cents: 1200, currency: "EUR", sort_order: 0, visible: true, available: true, created_at: now, updated_at: now };
const category = { id: "test-category", section: "menu", name: "Test", description: null, schedule: null, parent_id: null, sort_order: 0, visible: true, created_at: now, updated_at: now };
const publicCatalog = { schema_version: 1, payload: '{"categories":[],"products":[]}', updated_at: now };
// Os mocks substituem somente documentos relacionados, sem gravação no catálogo.
const mocks = [
  { function: "exists", args: [{ anyValue: {} }], result: { value: true } },
  { function: "get", args: [{ anyValue: {} }], result: { value: { data: { revision: 1 } } } },
  { function: "getAfter", args: [{ anyValue: {} }], result: { value: { data: { revision: 2, section: "menu" } } } },
];
for (const [table, data] of [["products", product], ["categories", category], ["public_catalogs", publicCatalog]]) {
  const id = table === "public_catalogs" ? "menu" : data.id;
  for (const method of ["create", "update"]) {
    check(`admin valid ${table} ${method}`, admin, method, `${table}/${id}`, true, data, data).functionMocks = mocks;
    check(`admin extra fields ${table} ${method}`, admin, method, `${table}/${id}`, false, { ...data, role: "admin" }, data).functionMocks = mocks;
    check(`admin removed fields ${table} ${method}`, admin, method, `${table}/${id}`, false, { updated_at: now }, data).functionMocks = mocks;
    check(`admin forged date ${table} ${method}`, admin, method, `${table}/${id}`, false, { ...data, updated_at: "2020-01-01T00:00:00.000Z" }, data).functionMocks = mocks;
  }
}
for (const [key, value] of [["price_cents", -1], ["currency", "USD"], ["visible", "true"], ["sort_order", -1], ["name", ""], ["name", "x".repeat(201)], ["description", "x".repeat(4001)], ["section", "vini"]]) {
  check(`invalid product ${key}=${String(value).slice(0,20)}`, admin, "update", "products/test-product", false, { ...product, [key]: value }, product).functionMocks = mocks;
}
check("category cannot parent itself", admin, "update", "categories/test-category", false, { ...category, parent_id: category.id }, category).functionMocks = mocks;
check("product created_at is immutable", admin, "update", "products/test-product", false, { ...product, created_at: "2020-01-01T00:00:00.000Z" }, product).functionMocks = mocks;
for (const auth of [null, other, unverified, password, missing, admin]) {
  for (const section of ["menu", "caffetteria", "drink", "vini"]) check("public projection read", auth, "get", `public_catalogs/${section}`, true);
  check("public projection list denied", auth, "list", "public_catalogs/menu", false);
  check("private projection denied", auth, "get", "public_catalogs/private", false);
  check("public projection delete denied", auth, "delete", "public_catalogs/menu", false);
  if (auth !== admin) check("public projection write denied", auth, "update", "public_catalogs/menu", false, publicCatalog, publicCatalog).functionMocks = mocks;
}

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const { data: result } = await cliAuthClient().request({
  url: `https://firebaserules.googleapis.com/v1/projects/${project}:test`, method: "POST",
  data: { source: { files: [{ name: "firestore.rules", content: rules }] }, testSuite: { testCases: cases.map(row => row.test) } },
});
const errors = result.issues?.filter(issue => issue.severity === "ERROR") || [];
const failures = cases.filter((row, index) => result.testResults?.[index]?.state !== "SUCCESS");
if (errors.length || failures.length) {
  console.error(JSON.stringify({ errors, failures: failures.map(row => ({ label: row.label, result: result.testResults?.[cases.indexOf(row)] })) }, null, 2));
  process.exitCode = 1;
} else console.log(`Firebase Rules API: ${cases.length} cenários de autorização aprovados.`);
