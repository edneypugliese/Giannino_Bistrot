import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, statSync } from "node:fs";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp4": "video/mp4", ".ico": "image/x-icon",
};
const FIELDS = {
  categories: ["section", "name", "description", "schedule", "parent_id", "sort_order", "visible"],
  products: ["category_id", "name", "description", "price", "sort_order", "visible", "available"],
  pages: ["title", "slug", "icon", "kind", "subtitle", "html", "show_index", "footer_note", "visible", "sort_order"],
  images: ["url", "alt", "sort_order", "visible"],
  events: ["title", "description", "date_label", "time_label", "sort_order", "visible"],
  items: ["label", "value", "href", "icon", "sort_order", "visible"],
  info: ["address_line1", "address_line2", "maps_pin_address", "phone", "email", "instagram_handle", "instagram_url", "schedule_main", "schedule_note"],
  content: ["title_line1", "title_line2", "body", "signature", "carousel_enabled", "carousel_interval", "show_images", "events_title", "events_intro"],
};

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function select(body, fields) { return Object.fromEntries(fields.filter(key => key in body).map(key => [key, body[key]])); }
function ordered(rows) { return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)); }
function slugify(value) { return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function atomicJson(file, value) {
  writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n");
  renameSync(file + ".tmp", file);
}
async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) fail(413, "Arquivo muito grande (máximo 10 MB).");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString() || "{}", (key, val) =>
      ["__proto__", "constructor", "prototype"].includes(key) ? undefined : val);
    if (!value || Array.isArray(value) || typeof value !== "object") fail(400, "JSON inválido.");
    return value;
  } catch (error) {
    if (error.status) throw error;
    fail(400, "JSON inválido.");
  }
}

export function createSiteServer({ dataDir = resolve(ROOT, ".local"), password = process.env.LOCAL_ADMIN_PASSWORD, username = process.env.LOCAL_ADMIN_USER || "admin", quiet = false } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const uploads = resolve(dataDir, "uploads");
  mkdirSync(uploads, { recursive: true });
  const dataFile = resolve(dataDir, "site.json");
  if (!existsSync(dataFile)) writeFileSync(dataFile, readFileSync(resolve(ROOT, "data/site.json")));
  let site = JSON.parse(readFileSync(dataFile, "utf8"));
  const credentialFile = resolve(dataDir, "admin.json");
  let credentials;
  if (!password && existsSync(credentialFile)) credentials = JSON.parse(readFileSync(credentialFile, "utf8"));
  else {
    password ||= randomBytes(12).toString("base64url");
    const salt = randomBytes(16).toString("hex");
    credentials = { username, salt, hash: scryptSync(password, salt, 64).toString("hex") };
    atomicJson(credentialFile, credentials);
    writeFileSync(resolve(dataDir, "ACESSO-LOCAL.txt"), `Giannino Bistrot — acesso ao painel local\n\nEndereço: /admin/login\nUsuário: ${username}\nSenha: ${password}\n\nUso somente neste computador. Este arquivo não é enviado ao Git.\n`);
  }
  const sessions = new Map();
  const attempts = new Map();
  const save = () => atomicJson(dataFile, site);
  const json = (response, status, value, headers = {}) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    response.end(JSON.stringify(value));
  };
  const sessionFor = request => {
    const token = /(?:^|;\s*)giannino_session=([^;]+)/.exec(request.headers.cookie || "")?.[1];
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) { if (token) sessions.delete(token); return null; }
    return session;
  };
  const requireAuth = request => { if (!sessionFor(request)) fail(401, "Accedi al pannello amministratore."); };
  const publicSession = session => session ? { user: { id: "local-admin", email: credentials.username + "@giannino.it" } } : null;
  const reorder = (rows, ids) => {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !rows.some(row => row.id === id))) fail(400, "Ordine non valido.");
    ids.forEach((id, index) => { rows.find(row => row.id === id).sort_order = index; });
  };
  const mutate = (rows, type, method, body, defaults = {}) => {
    if (method === "DELETE") {
      const index = rows.findIndex(row => row.id === body.id);
      if (index === -1) fail(404, "Elemento non trovato.");
      return rows.splice(index, 1)[0];
    }
    const values = select(body, FIELDS[type]);
    if (method === "POST") {
      const row = { id: randomUUID(), visible: true, sort_order: rows.length, ...defaults, ...values };
      rows.push(row);
      return row;
    }
    if (method === "PUT") {
      const row = rows.find(row => row.id === body.id);
      if (!row) fail(404, "Elemento non trovato.");
      Object.assign(row, values);
      return row;
    }
    fail(405, "Metodo non consentito.");
  };
  function deleteCategories(ids) {
    const removed = new Set(ids);
    let previous;
    do {
      previous = removed.size;
      for (const row of site.categories) if (removed.has(row.parent_id)) removed.add(row.id);
    } while (removed.size !== previous);
    site.categories = site.categories.filter(row => !removed.has(row.id));
    site.products = site.products.filter(row => !removed.has(row.category_id));
  }

  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host || "localhost";
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) fail(403, "Servidor disponível somente em localhost.");
      const url = new URL(request.url, "http://" + host);
      const path = url.pathname;
      const method = request.method;
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      if (!["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method)) fail(405, "Metodo non consentito.");
      if (!["GET", "HEAD"].includes(method)) {
        if (request.headers.origin && request.headers.origin !== "http://" + host) fail(403, "Origine non consentita.");
        if (request.headers["sec-fetch-site"] === "cross-site") fail(403, "Origine non consentita.");
      }
      if (path.startsWith("/api/")) {
        if (path === "/api/auth/session" && method === "GET") return json(response, 200, { session: publicSession(sessionFor(request)) });
        if (path === "/api/auth/login" && method === "POST") {
          const body = await readBody(request);
          const key = request.socket.remoteAddress;
          const previous = attempts.get(key);
          if (previous?.until > Date.now() && previous.count >= 10) fail(429, "Troppi tentativi. Riprova tra un minuto.");
          const enteredUser = String(body.email || "").replace(/@giannino\.it$/, "");
          const computed = scryptSync(String(body.password || ""), credentials.salt, 64);
          if (enteredUser !== credentials.username || !timingSafeEqual(computed, Buffer.from(credentials.hash, "hex"))) {
            attempts.set(key, { count: previous?.until > Date.now() ? previous.count + 1 : 1, until: Date.now() + 60_000 });
            fail(401, "Credenziali non valide.");
          }
          attempts.delete(key);
          const token = randomBytes(32).toString("hex");
          const session = { expires: Date.now() + 12 * 60 * 60 * 1000 };
          sessions.set(token, session);
          return json(response, 200, { session: publicSession(session) }, { "Set-Cookie": `giannino_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
        }
        if (path === "/api/auth/logout" && method === "POST") {
          const token = /(?:^|;\s*)giannino_session=([^;]+)/.exec(request.headers.cookie || "")?.[1];
          sessions.delete(token);
          return json(response, 200, { ok: true }, { "Set-Cookie": "giannino_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
        }
        const hidden = url.searchParams.get("includeHidden") === "1";
        if (hidden || method !== "GET") requireAuth(request);
        if (method === "GET") {
          if (path === "/api/health") return json(response, 200, { ok: true });
          if (path === "/api/theme") return json(response, 200, site.theme);
          if (path === "/api/pages") return json(response, 200, ordered(site.pages.filter(row => hidden || row.visible)));
          if (path === "/api/home") return json(response, 200, { ...site.home, images: ordered(site.home.images.filter(row => hidden || row.visible)), events: ordered(site.home.events.filter(row => hidden || row.visible)) });
          if (path === "/api/contact") return json(response, 200, { ...site.contact, items: ordered(site.contact.items.filter(row => hidden || row.visible)) });
          if (path === "/api/catalog") {
            const categories = site.categories.filter(row => row.section === url.searchParams.get("section") && (hidden || row.visible));
            const ids = new Set(categories.map(row => row.id));
            return json(response, 200, { categories: ordered(categories), products: ordered(site.products.filter(row => ids.has(row.category_id) && (hidden || row.visible && row.available))) });
          }
          fail(404, "API non trovata.");
        }
        const body = await readBody(request);
        let result;
        // A mutation is committed only after all its validation succeeds.
        const backup = structuredClone(site);
        try {
          if (path === "/api/theme" && method === "PUT") {
            if (!body.theme || typeof body.theme !== "object" || Array.isArray(body.theme)) fail(400, "Tema non valido.");
            result = site.theme = { theme: body.theme };
          } else if (path === "/api/home") {
            if (body.kind === "content" && method === "PUT") {
              if (body.body && !Array.isArray(body.body)) fail(400, "Contenuto non valido.");
              result = Object.assign(site.home.content, select(body, FIELDS.content));
            } else if (body.kind === "reorder" && method === "POST") {
              reorder(site.home.images, body.ids); result = { ok: true };
            } else if (["image", "event"].includes(body.kind)) {
              const type = body.kind === "image" ? "images" : "events";
              result = mutate(site.home[type], type, method, body);
            } else fail(400, "Tipo di contenuto non valido.");
          } else if (path === "/api/pages") {
            if (body.action === "reorder" && method === "POST") { reorder(site.pages, body.ids); result = { ok: true }; }
            else {
              const existing = site.pages.find(row => row.id === body.id);
              if (method === "DELETE" && existing?.kind === "system") fail(400, "Le pagine di sistema non possono essere eliminate.");
              if (body.slug !== undefined) {
                body.slug = slugify(body.slug);
                if (!body.slug || site.pages.some(row => row.slug === body.slug && row.id !== body.id)) fail(400, "Slug non valido o già utilizzato.");
              }
              if (body.kind && !["content", "catalog", "system"].includes(body.kind)) fail(400, "Tipo di pagina non valido.");
              result = mutate(site.pages, "pages", method, body, { system: false, html: "", show_index: false, footer_note: null });
              if (method === "POST") {
                result.slug ||= slugify(result.title || "pagina");
                result.route = "/p/" + result.slug;
                result.section_key = result.kind === "catalog" ? result.slug : null;
              } else if (!result.system && method === "PUT") {
                result.route = "/p/" + result.slug;
                if (result.kind === "catalog") result.section_key ||= result.slug;
              }
              if (method === "DELETE" && result.kind === "catalog") deleteCategories(site.categories.filter(row => row.section === result.section_key).map(row => row.id));
            }
          } else if (path === "/api/categories") {
            const existing = site.categories.find(row => row.id === body.id);
            if (method === "DELETE") {
              if (!existing) fail(404, "Categoria non trovata.");
              deleteCategories([body.id]); result = { ok: true };
            } else {
              const section = body.section ?? existing?.section;
              if (!section) fail(400, "Sezione obbligatoria.");
              if (body.parent_id) {
                let parent = site.categories.find(row => row.id === body.parent_id);
                if (!parent || parent.section !== section) fail(400, "Categoria superiore non valida.");
                const seen = new Set([body.id]);
                while (parent) {
                  if (seen.has(parent.id)) fail(400, "Gerarchia circolare non consentita.");
                  seen.add(parent.id);
                  parent = site.categories.find(row => row.id === parent.parent_id);
                }
              }
              result = mutate(site.categories, "categories", method, body, { parent_id: null, description: null, schedule: null });
            }
          } else if (path === "/api/products") {
            if (method !== "DELETE" && body.category_id && !site.categories.some(row => row.id === body.category_id)) fail(400, "Categoria non trovata.");
            if (method === "POST" && !body.category_id) fail(400, "Categoria obbligatoria.");
            result = mutate(site.products, "products", method, body, { available: true, description: null, price: null });
          } else if (path === "/api/contact") {
            if (body.type === "info" && method === "PUT") result = Object.assign(site.contact.info, select(body, FIELDS.info));
            else result = mutate(site.contact.items, "items", method, body, { href: null });
          } else if (path === "/api/reorder" && method === "POST") {
            if (!["categories", "products"].includes(body.table)) fail(400, "Tabella non valida.");
            reorder(site[body.table], body.ids); result = { ok: true };
          } else if (path === "/api/upload" && method === "POST") {
            const extensions = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "image/x-icon": ".ico" };
            if (!extensions[body.contentType] || typeof body.fileBase64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.fileBase64)) fail(400, "Formato immagine non valido.");
            const bytes = Buffer.from(body.fileBase64, "base64");
            if (!bytes.length || bytes.length > 10 * 1024 * 1024) fail(413, "Immagine troppo grande (massimo 10 MB).");
            const filename = randomUUID() + extensions[body.contentType];
            writeFileSync(resolve(uploads, filename), bytes);
            result = { url: "/uploads/" + filename };
          } else fail(404, "API non trovata.");
          save();
        } catch (error) { site = backup; throw error; }
        return json(response, 200, result);
      }
      if (method !== "GET" && method !== "HEAD") fail(405, "Metodo non consentito.");
      const base = path.startsWith("/uploads/") ? uploads : resolve(ROOT, "public");
      const relative = decodeURIComponent(path.startsWith("/uploads/") ? path.slice(9) : path.slice(1));
      let file = resolve(base, relative);
      if (file !== base && !file.startsWith(base + sep)) fail(403, "Accesso non consentito.");
      if (!existsSync(file) || !statSync(file).isFile()) {
        if (path.startsWith("/assets/") || path.startsWith("/img/") || path.startsWith("/fonts/") || path.startsWith("/uploads/") || extname(path)) fail(404, "Arquivo não encontrado.");
        file = resolve(ROOT, "public/index.html");
      }
      const bytes = readFileSync(file);
      response.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Content-Length": bytes.length, "Cache-Control": "no-cache" });
      response.end(method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (!quiet && !error.status) console.error(error);
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : "Erro interno do servidor local." });
      else response.end();
    }
  });
  server.requestTimeout = 30_000;
  return { server, dataDir, credentialsFile: resolve(dataDir, "ACESSO-LOCAL.txt") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  const { server, credentialsFile } = createSiteServer();
  server.on("error", error => {
    console.error(error.code === "EADDRINUSE" ? `A porta ${port} já está ocupada. Defina PORT para usar outra porta.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Giannino Bistrot Cafè: http://localhost:${port}`);
    console.log(`Acesso ao painel: ${credentialsFile}`);
    console.log("Ctrl+C encerra o servidor. Dados e uploads ficam em .local/.");
  });
}
