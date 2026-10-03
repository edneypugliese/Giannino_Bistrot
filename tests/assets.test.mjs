import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { preparePublicApp } from "../scripts/prepare-public-app.mjs";

test("todos os recursos públicos baixados conferem com o manifesto", () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("docs/download-manifest.json", root), "utf8"));
  const publicAssets = manifest.files.filter(file => file.file.startsWith("public/"));
  assert.ok(publicAssets.length > 100);
  for (const file of publicAssets) {
    const bytes = readFileSync(new URL(file.file, root));
    assert.equal(bytes.length, file.bytes, file.file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.file);
  }
});

test("o frontend online é reproduzível e não possui dependências da administração local", () => {
  const original = readFileSync(new URL("../vendor/original-app.js", import.meta.url), "utf8");
  const frontend = readFileSync(new URL("../public/assets/app.js", import.meta.url), "utf8");
  assert.equal(preparePublicApp(original), frontend);
  assert.ok(frontend.length < original.length * 0.6);
  assert.ok(!/src\/pages\/AdminLogin\.tsx|src\/contexts\/AuthContext\.tsx|localAuthClient|\/api\/auth|supabase/.test(frontend));
  for (const file of ["../server/index.mjs", "../public/assets/local-auth.js", "../scripts/pages-auth.js", "../iniciar-site.cmd"]) {
    assert.ok(!existsSync(new URL(file, import.meta.url)), file);
  }
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(!pkg.scripts.start && !pkg.scripts.dev);
  const shortcut = readFileSync(new URL("../abrir-site.cmd", import.meta.url), "utf8");
  assert.ok(shortcut.includes("https://edneypugliese.github.io/Giannino_Bistrot/"));
  assert.throws(() => preparePublicApp(original.replace("function PS(){", "function ChangedAdmin(){")), /referência mudou/);
});
