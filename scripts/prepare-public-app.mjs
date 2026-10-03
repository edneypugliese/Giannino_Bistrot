import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function marker(source, value) {
  const index = source.indexOf(value);
  if (index === -1 || source.indexOf(value, index + value.length) !== -1) {
    throw new Error("O frontend de referência mudou; revise a adaptação pública: " + value);
  }
  return index;
}

// O código TSX original não está disponível. Os limites abaixo são verificados
// antes de remover o SDK de autenticação e as telas administrativas do bundle.
export function preparePublicApp(original) {
  const sdkStart = marker(original, "function Wi(n,a)");
  const homeStart = marker(original, "const ad={");
  const adminStart = marker(original, "function PS(){");
  const appStart = marker(original, "function u4(){");
  const renderStart = marker(original, "Q1.createRoot");
  if (!(sdkStart < homeStart && homeStart < adminStart && adminStart < appStart && appStart < renderStart)) {
    throw new Error("A ordem dos componentes de referência mudou.");
  }
  let source = original.slice(0, sdkStart) + original.slice(homeStart, adminStart);
  const adminLinkStart = marker(source, ',u.jsx(us,{to:"/admin"');
  const adminLinkEnd = source.indexOf("})})", adminLinkStart) + 4;
  if (!source.slice(adminLinkStart, adminLinkEnd).includes('"src/components/TopBar.tsx:51:10"')) {
    throw new Error("O botão administrativo da referência mudou.");
  }
  source = source.slice(0, adminLinkStart) + source.slice(adminLinkEnd);

  for (const [signature, publicFetch, replacement] of [
    ["async function Fi(n=!1){", 'const a=await fetch("/api/pages")', "async function Fi(){"],
    ["async function h0(n=!1){", 'const a=await fetch("/api/home")', "async function h0(){"],
    ["async function m0(n,a=!1){", 'const r=await fetch(`/api/catalog?section=${n}`)', "async function m0(n){"],
  ]) {
    const start = marker(source, signature);
    const end = marker(source, publicFetch);
    if (end < start || end - start > 400) throw new Error("A leitura pública da referência mudou.");
    source = source.slice(0, start) + replacement + source.slice(end);
  }
  source = source.replaceAll('"https://fonts.googleapis.com/css2?"', '"/assets/fonts.css?"');
  if (/\/admin|\/api\/auth|localAuthClient|includeHidden|\b_d\b/.test(source)) {
    throw new Error("O frontend público ainda contém uma dependência administrativa.");
  }
  const app = `
function u4(){
  const routes = [
    ["/", DS], ["/menu", Pr, "menu"], ["/caffetteria", Pr, "caffetteria"],
    ["/drink", Pr, "drink"], ["/vini", Pr, "vini"], ["/contatti", qS],
    ["/p/:slug", Pr], ["*", g0],
  ];
  return u.jsx(B_,{children:u.jsx(_b,{basename:pagesBasePath,children:u.jsx(Zv,{
    children:u.jsx(Jt,{
      element:u.jsx(Q_,{}),
      children:routes.map(([path,Component,sectionKey]) =>
        u.jsx(Jt,{path,element:u.jsx(Component,sectionKey ? {sectionKey} : {})},path)),
    }),
  })})});
}
`;
  return 'import { pagesFetch as fetch, pagesBasePath } from "./pages-runtime.js";\n' + source + app + original.slice(renderStart);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const original = await readFile(new URL("../vendor/original-app.js", import.meta.url), "utf8");
  const app = preparePublicApp(original);
  await writeFile(new URL("../public/assets/app.js", import.meta.url), app);
  console.log("Frontend público preparado para GitHub Pages.");
}
