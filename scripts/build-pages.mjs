import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFirebase } from "./build-firebase.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ordered = rows => [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

export function normalizeBasePath(value) {
  if (!value.startsWith("/") || /[\\?#<>"'\s]/.test(value)) throw new Error("Base path inválido: use /nome-do-repositorio/ ou /.");
  const parts = value.split("/").filter(Boolean);
  if (parts.some(part => part === "." || part === "..")) throw new Error("Base path não pode conter . ou ..");
  return parts.length ? "/" + parts.join("/") + "/" : "/";
}

function assetPath(value, basePath) {
  return value.replace(/\/(?:img|fonts|assets|uploads)\/[^\s"'<>)]*|\/favicon\.svg/g, path => basePath + path.slice(1));
}

// Reescreve apenas URLs locais de mídia, preservando rotas do React e links externos.
function rewriteMedia(value, basePath) {
  if (typeof value === "string") {
    if (/^\/(?:img|fonts|assets|uploads)\//.test(value) || value === "/favicon.svg") return assetPath(value, basePath);
    return value.replace(/(\b(?:src|poster)=["'])(\/(?:img|fonts|assets|uploads)\/[^"']*)(["'])/g,
      (_, prefix, path, suffix) => prefix + assetPath(path, basePath) + suffix);
  }
  if (Array.isArray(value)) return value.map(item => rewriteMedia(item, basePath));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteMedia(item, basePath)]));
  return value;
}

// Um módulo alterado também troca o nome da entrada e dos módulos dependentes.
// Isso evita misturar o frontend antigo em cache com uma publicação nova.
export async function versionAssets(outDir, html, basePath) {
  const directory = join(outDir, "assets");
  const names = (await readdir(directory)).filter(name => /\.(?:js|css)$/.test(name)).sort();
  const sources = new Map();
  const hash = createHash("sha256").update(basePath);
  for (const name of names) {
    const source = await readFile(join(directory, name), "utf8");
    sources.set(name, source);
    hash.update(name).update("\0").update(source).update("\0");
  }
  const version = hash.digest("hex").slice(0, 12);
  const filenames = new Map(names.map(name => [name, name.replace(/\.(js|css)$/, `.${version}.$1`)]));
  const replaceReferences = source => {
    for (const [name, filename] of filenames) {
      source = source.replaceAll(basePath + "assets/" + name, basePath + "assets/" + filename);
      for (const quote of ['"', "'", "`"]) {
        source = source.replaceAll(quote + "./" + name + quote, quote + "./" + filename + quote);
      }
    }
    return source;
  };
  for (const [name, source] of sources) {
    await writeFile(join(directory, filenames.get(name)), replaceReferences(source));
  }
  return { html: replaceReferences(html), version, filenames };
}

export function publicResponses(site) {
  const responses = {
    theme: site.theme,
    pages: ordered(site.pages.filter(row => row.visible)),
    home: {
      ...site.home,
      images: ordered(site.home.images.filter(row => row.visible)),
      events: ordered(site.home.events.filter(row => row.visible)),
    },
    contact: { ...site.contact, items: ordered(site.contact.items.filter(row => row.visible)) },
  };
  const sections = new Set(["menu", "caffetteria", "drink", "vini", ...responses.pages.filter(row => row.kind === "catalog").map(row => row.section_key)]);
  for (const section of sections) {
    if (!section || !/^[a-z0-9_-]+$/.test(section)) throw new Error("Seção de catálogo inválida: " + section);
    const categories = site.categories.filter(row => row.section === section && row.visible);
    const ids = new Set(categories.map(row => row.id));
    responses["catalog-" + section] = {
      categories: ordered(categories),
      products: ordered(site.products.filter(row => ids.has(row.category_id) && row.visible && row.available)),
    };
  }
  return responses;
}

export async function buildPages({ basePath = process.env.PAGES_BASE_PATH || "/Giannino_Bistrot/", outDir = join(ROOT, "dist"), site } = {}) {
  basePath = normalizeBasePath(basePath);
  outDir = resolve(outDir);
  // Limpeza restrita à pasta de saída, nunca à raiz nem aos arquivos de origem.
  const rootFromOutput = relative(outDir, resolve(ROOT));
  const containsProject = !rootFromOutput || (rootFromOutput !== ".." && !rootFromOutput.startsWith(".." + sep) && !isAbsolute(rootFromOutput));
  if (basename(outDir) !== "dist" || containsProject) {
    throw new Error("A saída deve ser uma pasta dist que não contenha o projeto.");
  }
  await buildFirebase();
  site ||= JSON.parse(await readFile(join(ROOT, "data/site.json"), "utf8"));
  const responses = publicResponses(site);
  let app = await readFile(join(ROOT, "public/assets/app.js"), "utf8");
  if (!app.includes("basename:pagesBasePath") || /local-auth|localAuthClient|\/api\/auth/.test(app)) {
    throw new Error("Prepare o frontend público com npm run frontend:prepare.");
  }
  app = app.replace(/(["'`])(\/(?:img|fonts|assets)\/[^"'`]*|\/favicon\.svg)\1/g,
    (_, quote, path) => quote + assetPath(path, basePath) + quote);
  let html = (await readFile(join(ROOT, "public/index.html"), "utf8"))
    .replace(/((?:src|href)=")\//g, "$1" + basePath);
  const routes = new Set(["/", "/menu", "/caffetteria", "/drink", "/vini", "/contatti", "/admin", "/admin/login", ...responses.pages.map(row => row.route)]);
  for (const route of routes) {
    if (typeof route !== "string" || !/^\/(?:[a-z0-9_-]+\/?)*$/i.test(route)) throw new Error("Rota pública inválida: " + route);
  }

  await rm(outDir, { recursive: true, force: true });
  await cp(join(ROOT, "public"), outDir, { recursive: true });
  await writeFile(join(outDir, "assets/app.js"), app);
  for (const name of ["style.css", "fonts.css"]) {
    let css = await readFile(join(outDir, "assets", name), "utf8");
    css = css.replace(/url\((["']?)(\/[^)]*?)\1\)/g, (_, quote, path) => "url(" + quote + assetPath(path, basePath) + quote + ")");
    await writeFile(join(outDir, "assets", name), css);
  }
  const assets = await versionAssets(outDir, html, basePath);
  html = assets.html;
  await mkdir(join(outDir, "api"), { recursive: true });
  for (const [name, value] of Object.entries(responses)) {
    await writeFile(join(outDir, "api", name + ".json"), JSON.stringify(rewriteMedia(value, basePath)) + "\n");
  }
  for (const route of routes) {
    const destination = join(outDir, route.replace(/^\//, ""), "index.html");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, html);
  }
  await writeFile(join(outDir, "404.html"), html);
  await writeFile(join(outDir, ".nojekyll"), "");
  const products = Object.entries(responses).filter(([key]) => key.startsWith("catalog-")).reduce((total, [, value]) => total + value.products.length, 0);
  return { outDir, basePath, routes: [...routes], products, assetVersion: assets.version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf("--base-path");
  const result = await buildPages(index === -1 ? {} : { basePath: process.argv[index + 1] });
  console.log(`GitHub Pages: ${result.outDir} (${result.basePath}), ${result.routes.length} páginas e ${result.products} produtos.`);
}
