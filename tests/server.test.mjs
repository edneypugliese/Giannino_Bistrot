import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createSiteServer } from "../server/index.mjs";

test("todos os recursos públicos baixados conferem com o manifesto", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, "docs/download-manifest.json")));
  const publicAssets = manifest.files.filter(file => file.file.startsWith("public/"));
  assert.ok(publicAssets.length > 100);
  for (const file of publicAssets) {
    const bytes = readFileSync(join(root, file.file));
    assert.equal(bytes.length, file.bytes, file.file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.file);
  }
});

async function fixture(t, dataDir) {
  const directory = dataDir || mkdtempSync(join(tmpdir(), "giannino-test-"));
  const { server } = createSiteServer({ dataDir: directory, username: "admin", password: "test-password", quiet: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (!dataDir) rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  async function request(path, method = "GET", body, headers = {}) {
    return fetch(base + path, { method, headers: { "Content-Type": "application/json", cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function login() {
    const response = await request("/api/auth/login", "POST", { email: "admin@giannino.it", password: "test-password" });
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie").split(";")[0];
    return response;
  }
  return { request, login, directory, server };
}

test("todos os catálogos, mídia e rotas funcionam sem serviços externos", async t => {
  const { request } = await fixture(t);
  const home = await (await request("/api/home")).json();
  assert.match(home.content.body.join(""), /Giuseppina/);
  assert.equal((await request(home.images[0].url)).status, 200);
  let products = 0;
  for (const section of ["menu", "caffetteria", "drink", "vini"]) {
    const response = await request("/api/catalog?section=" + section);
    const catalog = await response.json();
    assert.equal(response.status, 200);
    assert.ok(catalog.categories.length);
    assert.ok(catalog.products.length);
    products += catalog.products.length;
    assert.equal((await request("/" + section)).status, 200);
  }
  assert.equal(products, 282);
  assert.equal((await request("/admin/login")).status, 200);
  assert.equal((await request("/assets/missing.js")).status, 404);
  const fonts = await (await request("/assets/fonts.css")).text();
  assert.match(fonts, /Libre Baskerville/);
  assert.ok(!fonts.includes("https://"));
  const app = await (await request("/assets/app.js")).text();
  assert.ok(!app.includes('const Kr=jS("https://'));
  assert.ok(!app.includes('"https://fonts.googleapis.com/css2?"'));
});

test("painel exige sessão e protege gravações de outra origem", async t => {
  const { request, login } = await fixture(t);
  assert.equal((await request("/api/home?includeHidden=1")).status, 401);
  assert.equal((await request("/api/products", "POST", { name: "X" })).status, 401);
  assert.equal((await request("/api/auth/login", "POST", { email: "admin", password: "wrong" })).status, 401);
  const response = await login();
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.ok((await (await request("/api/auth/session")).json()).session);
  assert.equal((await request("/api/home", "PUT", { kind: "content", title_line1: "X" }, { Origin: "https://example.com" })).status, 403);
  assert.equal((await request("/api/auth/logout", "POST", {})).status, 200);
  assert.equal((await request("/api/home?includeHidden=1")).status, 401);
});

test("edição, visibilidade, ordenação e exclusão de categorias e produtos", async t => {
  const { request, login } = await fixture(t);
  await login();
  const category = await (await request("/api/categories", "POST", { section: "menu", name: "Teste" })).json();
  const child = await (await request("/api/categories", "POST", { section: "menu", name: "Filha", parent_id: category.id })).json();
  const product = await (await request("/api/products", "POST", { category_id: child.id, name: "Produto teste", price: "9,50" })).json();
  assert.ok(product.id);
  assert.equal((await request("/api/categories", "PUT", { id: category.id, parent_id: child.id })).status, 400);
  assert.equal((await request("/api/products", "PUT", { id: product.id, visible: false })).status, 200);
  const publicCatalog = await (await request("/api/catalog?section=menu")).json();
  assert.ok(!publicCatalog.products.some(row => row.id === product.id));
  const privateCatalog = await (await request("/api/catalog?section=menu&includeHidden=1")).json();
  assert.ok(privateCatalog.products.some(row => row.id === product.id));
  assert.equal((await request("/api/reorder", "POST", { table: "categories", ids: [child.id, category.id] })).status, 200);
  assert.equal((await request("/api/categories", "DELETE", { id: category.id })).status, 200);
  const catalog = await (await request("/api/catalog?section=menu&includeHidden=1")).json();
  assert.ok(!catalog.categories.some(row => row.id === child.id));
  assert.ok(!catalog.products.some(row => row.id === product.id));
});

test("home, eventos, páginas e contatos persistem no disco", async t => {
  const { request, login, directory } = await fixture(t);
  await login();
  assert.equal((await request("/api/home", "PUT", { kind: "content", title_line1: "Título local" })).status, 200);
  const event = await (await request("/api/home", "POST", { kind: "event", title: "Evento local" })).json();
  assert.ok(event.id);
  const page = await (await request("/api/pages", "POST", { title: "Nova página", slug: "Nova página", kind: "content", html: "<p>Texto local</p>" })).json();
  assert.equal(page.route, "/p/nova-pagina");
  const contact = await (await request("/api/contact", "POST", { type: "item", label: "Teste", value: "123" })).json();
  assert.ok(contact.id);
  const saved = JSON.parse(readFileSync(join(directory, "site.json")));
  assert.equal(saved.home.content.title_line1, "Título local");
  assert.ok(saved.home.events.some(row => row.id === event.id));
  assert.ok(saved.pages.some(row => row.id === page.id));
  assert.ok(saved.contact.items.some(row => row.id === contact.id));
  const originalPages = await (await request("/api/pages")).json();
  const systemPage = originalPages.find(row => row.kind === "system");
  assert.equal((await request("/api/pages", "DELETE", { id: systemPage.id })).status, 400);
  const winePage = originalPages.find(row => row.section_key === "vini");
  assert.equal((await request("/api/pages", "DELETE", { id: winePage.id })).status, 200);
  const deletedCatalog = await (await request("/api/catalog?section=vini&includeHidden=1")).json();
  assert.deepEqual(deletedCatalog, { categories: [], products: [] });
  const restarted = createSiteServer({ dataDir: directory, quiet: true });
  restarted.server.listen(0, "127.0.0.1");
  await once(restarted.server, "listening");
  const response = await fetch(`http://127.0.0.1:${restarted.server.address().port}/api/home`);
  assert.equal((await response.json()).content.title_line1, "Título local");
  restarted.server.closeAllConnections();
  await new Promise(resolve => restarted.server.close(resolve));
});

test("upload serve arquivo local e rejeita formatos não permitidos", async t => {
  const { request, login } = await fixture(t);
  await login();
  assert.equal((await request("/api/upload", "POST", { contentType: "text/html", fileBase64: "eA==" })).status, 400);
  const content = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
  const response = await request("/api/upload", "POST", { fileName: "test.svg", contentType: "image/svg+xml", fileBase64: Buffer.from(content).toString("base64") });
  assert.equal(response.status, 200);
  const { url } = await response.json();
  const asset = await request(url);
  assert.equal(asset.headers.get("content-type"), "image/svg+xml");
  assert.equal(await asset.text(), content);
});
