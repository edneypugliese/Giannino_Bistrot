import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { buildPages, normalizeBasePath, versionAssets } from "../scripts/build-pages.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "giannino-pages-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, outDir: join(directory, "dist") };
}

test("o Pages preserva o snapshot público, com links diretos e recursos no subdiretório", async t => {
  const { outDir } = await fixture(t);
  const site = JSON.parse(await readFile(new URL("../data/site.json", import.meta.url), "utf8"));
  const result = await buildPages({ basePath: "/", outDir });
  assert.equal(result.products, 282);
  for (const name of ["home", "theme", "pages", "contact"]) {
    const exported = JSON.parse(await readFile(join(outDir, "api", name + ".json"), "utf8"));
    assert.deepEqual(exported, site[name], name);
  }
  for (const [section, categories, products] of [["menu", 5, 24], ["caffetteria", 1, 20], ["drink", 19, 119], ["vini", 38, 119]]) {
    const catalog = JSON.parse(await readFile(join(outDir, "api", "catalog-" + section + ".json"), "utf8"));
    assert.equal(catalog.categories.length, categories);
    assert.equal(catalog.products.length, products);
    for (const product of catalog.products) {
      const source = site.products.find(row => row.id === product.id);
      for (const key of ["id", "category_id", "name", "description", "price", "sort_order"]) assert.deepEqual(product[key], source[key]);
      assert.equal(product.visible, true);
      assert.equal(product.available, true);
      assert.ok(!Object.hasOwn(product, "created_at"));
    }
  }

  await buildPages({ basePath: "/Giannino_Bistrot/", outDir });
  const html = await readFile(join(outDir, "index.html"), "utf8");
  assert.match(html, /src="\/Giannino_Bistrot\/assets\/app\.[a-f0-9]{12}\.js"/);
  const entry = html.match(/src="(\/Giannino_Bistrot\/assets\/app\.[a-f0-9]{12}\.js)"/)[1];
  const entryScript = await readFile(join(outDir, entry.slice("/Giannino_Bistrot/".length)), "utf8");
  assert.match(entryScript, /from "\.\/google-admin\.[a-f0-9]{12}\.js"/);
  assert.match(entryScript, /to:"\/admin\/login","aria-label":"Area riservata"/);
  assert.match(html, /href="\/Giannino_Bistrot\/favicon.svg"/);
  for (const route of result.routes) assert.equal(await readFile(join(outDir, route.slice(1), "index.html"), "utf8"), html);
  assert.equal(await readFile(join(outDir, "404.html"), "utf8"), html);
  assert.ok((await stat(join(outDir, "favicon.svg"))).isFile());
  assert.ok((await stat(join(outDir, ".nojekyll"))).isFile());
  const fonts = await readFile(join(outDir, "assets/fonts.css"), "utf8");
  for (const [, path] of fonts.matchAll(/url\(([^)]+)\)/g)) {
    assert.ok(path.startsWith("/Giannino_Bistrot/fonts/"));
    assert.ok((await stat(join(outDir, path.slice("/Giannino_Bistrot/".length)))).isFile());
  }
  const home = JSON.parse(await readFile(join(outDir, "api/home.json"), "utf8"));
  assert.equal(home.images[0].url, "/Giannino_Bistrot/img/hero-sala.jpg");
  const theme = JSON.parse(await readFile(join(outDir, "api/theme.json"), "utf8"));
  assert.equal(theme.theme.logo_url, "/Giannino_Bistrot/img/logo-giannino.png");
  const app = await readFile(join(outDir, "assets/app.js"), "utf8");
  assert.match(app, /basename:pagesBasePath/);
  assert.match(app, /"\/Giannino_Bistrot\/assets\/fonts.css\?"/);
  const files = await readdir(outDir);
  for (const privatePath of [".local", "server", "data", "admin.json", "ACESSO-LOCAL.txt", "site.json"]) assert.ok(!files.includes(privatePath));
  await assert.rejects(stat(join(outDir, "assets/local-auth.js")), { code: "ENOENT" });
  assert.ok(!/src\/pages\/AdminLogin\.tsx|src\/contexts\/AuthContext\.tsx|localAuthClient|\/api\/auth/.test(app));
  const runtime = await readFile(join(outDir, "assets/pages-runtime.js"), "utf8");
  assert.ok(!runtime.includes("localhost") && !runtime.includes("versione locale"));
});

test("atualizar um módulo invalida o cache da entrada, dos imports e dos estilos", async t => {
  const { outDir } = await fixture(t);
  const assets = join(outDir, "assets");
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, "app.js"), 'import {login} from "./login.js"; import("./firebase-client.js"); login();');
  await writeFile(join(assets, "login.js"), 'export function login(){return "Google";}');
  await writeFile(join(assets, "firebase-client.js"), 'export const enabled = true;');
  await writeFile(join(assets, "style.css"), 'header{display:flex}');
  const html = '<script src="/Giannino_Bistrot/assets/app.js"></script><link href="/Giannino_Bistrot/assets/style.css">';
  const first = await versionAssets(outDir, html, "/Giannino_Bistrot/");
  const entry = await readFile(join(assets, first.filenames.get("app.js")), "utf8");
  assert.ok(first.html.includes(first.filenames.get("app.js")));
  assert.ok(first.html.includes(first.filenames.get("style.css")));
  assert.ok(entry.includes('from "./' + first.filenames.get("login.js") + '"'));
  assert.ok(entry.includes('import("./' + first.filenames.get("firebase-client.js") + '")'));
  // Um build limpo com as mesmas fontes mantém a URL, sem invalidar à toa.
  for (const name of first.filenames.values()) await rm(join(assets, name));
  assert.equal((await versionAssets(outDir, html, "/Giannino_Bistrot/")).version, first.version);
  for (const name of first.filenames.values()) await rm(join(assets, name));
  await writeFile(join(assets, "login.js"), 'export function login(){return "Google aggiornato";}');
  const second = await versionAssets(outDir, html, "/Giannino_Bistrot/");
  assert.notEqual(second.version, first.version);
  assert.notEqual(second.filenames.get("app.js"), first.filenames.get("app.js"));
  assert.notEqual(second.filenames.get("style.css"), first.filenames.get("style.css"));
});

test("a exportação publica todo o cardápio e preserva os controles das outras páginas", async t => {
  const { outDir } = await fixture(t);
  const site = JSON.parse(await readFile(new URL("../data/site.json", import.meta.url), "utf8"));
  const hiddenCategory = site.categories[0];
  hiddenCategory.visible = false;
  const hiddenProduct = site.products.find(row => row.category_id !== hiddenCategory.id);
  hiddenProduct.visible = false;
  const unavailableProduct = site.products.find(row => row.visible && row.category_id !== hiddenCategory.id);
  unavailableProduct.available = false;
  site.pages.find(row => row.section_key === "menu").visible = false;
  site.home.images.push({ id: "private-image", url: "/img/private.jpg", visible: false });
  site.home.events.push({ id: "private-event", title: "Evento privado", visible: false });
  site.contact.items[0].visible = false;
  site.pages.push({ id: "custom-page", route: "/p/eventi", kind: "content", visible: true, html: '<img src="/img/hero-sala.jpg">' });
  await buildPages({ outDir, site });
  assert.ok((await stat(join(outDir, "p/eventi/index.html"))).isFile());
  const pages = JSON.parse(await readFile(join(outDir, "api/pages.json"), "utf8"));
  assert.match(pages.find(row => row.id === "custom-page").html, /src="\/Giannino_Bistrot\/img\/hero-sala.jpg"/);
  const exported = (await Promise.all((await readdir(join(outDir, "api"))).map(name => readFile(join(outDir, "api", name), "utf8")))).join("");
  for (const id of [hiddenCategory.id, hiddenProduct.id, unavailableProduct.id]) assert.ok(exported.includes(id), id);
  for (const id of ["private-image", "private-event", site.contact.items[0].id]) assert.ok(!exported.includes(id), id);
  assert.equal(pages.find(row => row.section_key === "menu").visible, true);
  for (const section of ["menu", "caffetteria", "drink", "vini"]) {
    const data = JSON.parse(await readFile(join(outDir, "api", `catalog-${section}.json`), "utf8"));
    assert.ok(data.categories.every(row => row.visible === true));
    assert.ok(data.products.every(row => row.visible === true && row.available === true));
  }
  site.pages = site.pages.filter(row => row.id !== "custom-page");
  await buildPages({ outDir, site });
  await assert.rejects(stat(join(outDir, "p/eventi/index.html")), { code: "ENOENT" });
  assert.equal(normalizeBasePath("/Giannino_Bistrot"), "/Giannino_Bistrot/");
  assert.equal(normalizeBasePath("/"), "/");
  assert.throws(() => normalizeBasePath("/../"));
  await assert.rejects(buildPages({ outDir: new URL("../", import.meta.url).pathname }), /saída/);
});

test("o adaptador usa arquivos JSON, preserva chamadas externas e bloqueia gravações", async () => {
  const calls = [];
  const source = (await readFile(new URL("../public/assets/pages-runtime.js", import.meta.url), "utf8"))
    .replace(/export /g, "").replace(/import\.meta\.url/g, '"https://example.test/Giannino_Bistrot/assets/pages-runtime.js"');
  const runtime = runInNewContext(source + "\n({ pagesFetch, pagesBasePath })", {
    URL, Request, Response,
    location: new URL("https://example.test/Giannino_Bistrot/menu/"),
    fetch: async (...args) => { calls.push(args); return new Response('{"ok":true}'); },
  });
  assert.equal(runtime.pagesBasePath, "/Giannino_Bistrot");
  await runtime.pagesFetch("/api/catalog?section=menu");
  assert.equal(calls[0][0].href, "https://example.test/Giannino_Bistrot/api/catalog-menu.json");
  await runtime.pagesFetch(new Request("https://example.test/api/home"));
  assert.equal(calls[1][0].url, "https://example.test/Giannino_Bistrot/api/home.json");
  await runtime.pagesFetch("/Giannino_Bistrot/api/contact");
  assert.equal(calls[2][0].href, "https://example.test/Giannino_Bistrot/api/contact.json");
  await runtime.pagesFetch("https://external.test/api/home");
  assert.equal(calls[3][0], "https://external.test/api/home");
  assert.equal((await runtime.pagesFetch("/api/home", { method: "PUT" })).status, 405);
  assert.equal((await runtime.pagesFetch("/api/pages?includeHidden=1")).status, 405);
  assert.equal((await runtime.pagesFetch("/api/catalog?section=../../secret")).status, 404);
  assert.equal((await runtime.pagesFetch("/api/auth/login")).status, 404);
  assert.equal(calls.length, 4);
});
