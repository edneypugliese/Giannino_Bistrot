// O bundle original usa /api; no Pages, cada resposta é um arquivo público.
const nativeFetch = globalThis.fetch.bind(globalThis);
export const pagesBasePath = new URL("../", import.meta.url).pathname.replace(/\/$/, "") || "/";

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
    return jsonResponse(405, "La gestione dei contenuti è disponibile nella versione locale del sito.");
  }
  let file;
  if (["home", "theme", "pages", "contact"].includes(endpoint)) file = endpoint;
  if (endpoint === "catalog") {
    const section = url.searchParams.get("section") || "";
    if (/^[a-z0-9_-]+$/.test(section)) file = "catalog-" + section;
  }
  if (!file) return jsonResponse(404, "Contenuto non trovato.");
  const target = new URL("../api/" + file + ".json", import.meta.url);
  return nativeFetch(input instanceof Request ? new Request(target, input) : target, options);
}
