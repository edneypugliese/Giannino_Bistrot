import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { cliAuthClient } from "./firebase-client.mjs";

// A CLI habilita provedores; esta API aplica e verifica os domínios configurados.
const config = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
const project = JSON.parse(await readFile(new URL("../.firebaserc", import.meta.url), "utf8")).projects.default;
const authClient = cliAuthClient();
const name = `projects/${project}/config`;
const data = {
  name,
  authorizedDomains: config.auth.authorizedDomains,
  signIn: {
    email: { enabled: config.auth.providers.emailPassword === true },
    anonymous: { enabled: config.auth.providers.anonymous === true },
  },
};
await authClient.request({
  url: `https://identitytoolkit.googleapis.com/admin/v2/${name}`,
  method: "PATCH", params: { updateMask: "authorizedDomains,signIn.email.enabled,signIn.anonymous.enabled" }, data,
});
const { data: actual } = await authClient.request({ url: `https://identitytoolkit.googleapis.com/admin/v2/${name}` });
assert.deepEqual([...actual.authorizedDomains].sort(), [...data.authorizedDomains].sort());
assert.equal(actual.signIn.email.enabled === true, data.signIn.email.enabled);
assert.equal(actual.signIn.anonymous.enabled === true, data.signIn.anonymous.enabled);
console.log(JSON.stringify({ project, authorizedDomains: actual.authorizedDomains, emailPassword: actual.signIn.email.enabled === true, anonymous: actual.signIn.anonymous.enabled === true }, null, 2));
