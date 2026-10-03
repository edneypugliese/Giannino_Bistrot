import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

async function runtime(readPublicCatalog) {
  const calls = [];
  const source = (await readFile(new URL("../public/assets/pages-runtime.js", import.meta.url), "utf8"))
    .replace(/export /g, "")
    .replace(/import\.meta\.url/g, '"https://example.test/Giannino_Bistrot/assets/pages-runtime.js"')
    .replace('const loadFirebaseClient = () => import("./firebase-client.js");', 'const loadFirebaseClient = async () => ({ catalogClient: { readPublicCatalog } });');
  const adapter = runInNewContext(source + "\n({ pagesFetch })", {
    URL, Request, Response, setTimeout, clearTimeout, readPublicCatalog,
    location: new URL("https://example.test/Giannino_Bistrot/menu/"),
    fetch: async target => { calls.push(String(target)); return new Response('{"snapshot":true}'); },
  });
  return { adapter, calls };
}

test("o cardápio público usa as alterações do Firestore sem precisar de novo build", async () => {
  let price = "15,00";
  const sections = [];
  const { adapter, calls } = await runtime(async section => { sections.push(section); return { categories: [{ id: "main" }], products: [{ id: "one", name: "1974", price }] }; });
  assert.equal((await (await adapter.pagesFetch("/api/catalog?section=menu")).json()).products[0].price, "15,00");
  price = "16,50";
  const response = await adapter.pagesFetch("/Giannino_Bistrot/api/catalog?section=menu");
  assert.equal((await response.json()).products[0].price, "16,50");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(sections, ["menu", "menu"]);
  assert.equal(calls.length, 0);
});

test("falhas de rede usam o snapshot sem liberar rotas administrativas ou gravações", async () => {
  const { adapter, calls } = await runtime(async () => { throw new Error("offline"); });
  const response = await adapter.pagesFetch("/api/catalog?section=vini");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { snapshot: true });
  assert.deepEqual(calls, ["https://example.test/Giannino_Bistrot/api/catalog-vini.json"]);
  assert.equal((await adapter.pagesFetch("/api/catalog?section=vini&includeHidden=1")).status, 405);
  assert.equal((await adapter.pagesFetch("/api/products", { method: "POST", body: "{}" })).status, 405);
  assert.equal((await adapter.pagesFetch("/api/catalog?section=../../sections")).status, 404);
  assert.equal((await adapter.pagesFetch("/api/auth/session")).status, 404);
  assert.equal(calls.length, 1);
});
