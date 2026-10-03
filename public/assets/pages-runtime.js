// O bundle usa /api; no GitHub Pages, cada resposta é um arquivo público.
const nativeFetch = globalThis.fetch.bind(globalThis);
const loadFirebaseClient = () => import("./firebase-client.js");
export const pagesBasePath = new URL("../", import.meta.url).pathname.replace(/\/$/, "") || "/";

async function liveCatalog(section) {
  let timer;
  try {
    const request = loadFirebaseClient().then(module => module.catalogClient.readPublicCatalog(section));
    return await Promise.race([request, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Catalogo non disponibile")), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

function jsonResponse(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function pagesFetch(input, options = {}) {
  const url = new URL(input instanceof Request ? input.url : input, globalThis.location.href);
  const path = url.pathname;
  const apiPrefix = pagesBasePath === "/" ? "/api/" : pagesBasePath + "/api/";
  const endpoint = path.startsWith("/api/") ? path.slice(5) : path.startsWith(apiPrefix) ? path.slice(apiPrefix.length) : null;
  if (url.origin !== globalThis.location.origin || endpoint === null) return nativeFetch(input, options);

  const method = (options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" || url.searchParams.get("includeHidden") === "1") {
    return jsonResponse(405, "Metodo non consentito.");
  }
  let file;
  if (["home", "theme", "pages", "contact"].includes(endpoint)) file = endpoint;
  if (endpoint === "catalog") {
    const section = url.searchParams.get("section") || "";
    if (/^[a-z0-9_-]+$/.test(section)) {
      file = "catalog-" + section;
      if (["menu", "caffetteria", "drink", "vini"].includes(section)) {
        try {
          const catalog = await liveCatalog(section);
          return new Response(JSON.stringify(catalog), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
          });
        } catch { /* Mantém o snapshot disponível se a rede ou o Firebase falhar. */ }
      }
    }
  }
  if (!file) return jsonResponse(404, "Contenuto non trovato.");
  const target = new URL("../api/" + file + ".json", import.meta.url);
  return nativeFetch(input instanceof Request ? new Request(target, input) : target, options);
}
