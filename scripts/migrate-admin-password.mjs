import { readFile } from "node:fs/promises";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { cliAuthClient } from "./firebase-client.mjs";
import { ADMIN_EMAIL, ADMIN_USERNAME } from "../src/admin-auth.js";

// Migração única pelo IAM. Credenciais nunca entram no frontend ou no Git.
async function migrate() {
  const project = JSON.parse(await readFile(new URL("../.firebaserc", import.meta.url), "utf8")).projects.default;
  const client = cliAuthClient();
  const lookup = async () => (await client.request({
    url: `https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,
    method: "POST", data: { email: [ADMIN_EMAIL] },
  })).data.users?.[0];
  const owner = await lookup();
  if (!owner || owner.disabled || owner.emailVerified !== true || !owner.providerUserInfo?.some(row => row.providerId === "google.com")) {
    throw new Error("A conta Google autorizada precisa existir, estar ativa e verificada antes da migração.");
  }
  if (owner.passwordHash) { console.log("Conta já possui senha no Firebase; senha existente preservada."); return; }
  const credential = JSON.parse(await readFile(new URL("../.local/admin.json", import.meta.url), "utf8"));
  const instruction = await readFile(new URL("../.local/ACESSO-LOCAL.txt", import.meta.url), "utf8");
  const password = instruction.match(/^Senha: (.+)\r?$/m)?.[1]?.replace(/\r$/, "");
  if (credential.username !== ADMIN_USERNAME || !password || !/^[a-f0-9]{128}$/i.test(credential.hash || "") || !/^[a-f0-9]{32}$/i.test(credential.salt || "")) {
    throw new Error("Credenciais anteriores ausentes ou em formato inesperado.");
  }
  if (!timingSafeEqual(scryptSync(password, credential.salt, 64), Buffer.from(credential.hash, "hex"))) {
    throw new Error("A senha anterior não corresponde ao hash armazenado. Migração cancelada.");
  }
  if (process.argv.includes("--dry-run")) { console.log("Migração validada: credencial anterior corresponde ao hash; conta Google existente será preservada."); return; }
  // Atualiza somente a senha da conta encontrada, preservando UID e Google.
  await client.request({
    url: "https://identitytoolkit.googleapis.com/v1/accounts:update", method: "POST",
    data: { localId: owner.localId, targetProjectId: project, password },
  });
  const actual = await lookup();
  if (!actual?.passwordHash || actual.localId !== owner.localId || actual.emailVerified !== true || !actual.providerUserInfo?.some(row => row.providerId === "google.com")) {
    throw new Error("Verificação da migração incompleta.");
  }
  console.log("Senha anterior vinculada ao administrador Firebase; UID, email verificado e login Google preservados.");
}
try { await migrate(); }
catch { console.error("Migração não concluída. Confira a sessão CLI, as permissões e as credenciais anteriores em .local. Nenhuma credencial foi exibida."); process.exitCode = 1; }
