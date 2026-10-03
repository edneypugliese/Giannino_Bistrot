import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdminAuth, ADMIN_EMAIL, emailForUsername, isAdminClaims } from "../src/admin-auth.js";
import { authNotice } from "../public/assets/google-admin.js";

const claims = provider => ({ email: ADMIN_EMAIL, email_verified: true, firebase: { sign_in_provider: provider } });
const user = values => ({ uid: "test-user", getIdTokenResult: async () => ({ claims: values }) });
function fixture(values, verification = async () => {}) {
  const signedIn = user(values);
  const auth = { currentUser: null };
  const calls = [];
  let observer;
  const sdk = {
    GoogleAuthProvider: class { setCustomParameters(value) { calls.push(["provider", value]); } },
    async signInWithPopup() { auth.currentUser = signedIn; calls.push(["google"]); return { user: signedIn }; },
    async signInWithEmailAndPassword(_, email, password) { auth.currentUser = signedIn; calls.push(["password", email, password]); return { user: signedIn }; },
    async signOut() { calls.push(["logout"]); auth.currentUser = null; },
    onIdTokenChanged(_, callback) { observer = callback; return () => calls.push(["unsubscribe"]); },
  };
  const client = createAdminAuth({ auth, sdk, verifyAccess: async () => { calls.push(["server"]); await verification(); } });
  return { client, calls, auth, signedIn, restore: () => { auth.currentUser = signedIn; return observer(signedIn); } };
}

test("nome de usuário antigo e email resolvem para a mesma identidade Firebase", () => {
  assert.equal(emailForUsername(" admin "), ADMIN_EMAIL);
  assert.equal(emailForUsername(ADMIN_EMAIL.toUpperCase()), ADMIN_EMAIL);
  for (const value of ["", "another-admin", "other@example.com"]) assert.throws(() => emailForUsername(value), { code: "admin/access-denied" });
});

test("Google e senha exigem email exato e verificado; outros provedores e roles não concedem acesso", () => {
  for (const provider of ["google.com", "password"]) {
    assert.equal(isAdminClaims(claims(provider)), true);
    assert.equal(isAdminClaims({ ...claims(provider), email: "other@example.com", admin: true }), false);
    assert.equal(isAdminClaims({ ...claims(provider), email_verified: false }), false);
  }
  for (const provider of ["custom", "anonymous", "phone"]) assert.equal(isAdminClaims(claims(provider)), false);
  assert.equal(isAdminClaims({ admin: true }), false);
});

test("ambas as opções confirmam autorização no servidor antes de devolver sessão", async () => {
  const password = fixture(claims("password"));
  assert.equal(await password.client.signInWithPassword("admin", "test-secret"), password.signedIn);
  assert.deepEqual(password.calls, [["password", ADMIN_EMAIL, "test-secret"], ["server"]]);
  const google = fixture(claims("google.com"));
  assert.equal(await google.client.signInWithGoogle(), google.signedIn);
  assert.deepEqual(google.calls, [["provider", { prompt: "select_account" }], ["google"], ["server"]]);
});

test("sessões não autorizadas são encerradas em login e restauração", async () => {
  for (const provider of ["google.com", "password"]) {
    const f = fixture({ ...claims(provider), email: "other@example.com" });
    const operation = provider === "password" ? () => f.client.signInWithPassword("admin", "test") : () => f.client.signInWithGoogle();
    await assert.rejects(operation, { code: "admin/access-denied" });
    assert.equal(f.auth.currentUser, null);
    assert.ok(!f.calls.some(row => row[0] === "server"));
    const states = [];
    const unsubscribe = f.client.subscribeAdminAuth(state => states.push(state));
    await f.restore();
    assert.equal(f.auth.currentUser, null);
    assert.ok(!states.some(state => state.user));
    assert.equal(states.at(-1).error.code, "admin/access-denied");
    unsubscribe();
  }
});

test("negação do servidor encerra a sessão e não libera o painel", async () => {
  const f = fixture(claims("password"), async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); });
  await assert.rejects(() => f.client.signInWithPassword("admin", "test"), { code: "admin/access-denied" });
  assert.equal(f.auth.currentUser, null);
});

test("uma verificação pendente não publica a sessão após cancelar a assinatura", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(claims("google.com"), () => pending);
  const states = [];
  const unsubscribe = f.client.subscribeAdminAuth(state => states.push(state));
  const request = f.restore();
  unsubscribe(); release(); await request;
  assert.equal(states.length, 1);
  assert.equal(states[0].loading, true);
});

test("a mensagem de negação é profissional e não revela se um email existe", () => {
  const notice = authNotice({ code: "admin/access-denied", message: "sensitive@example.com" });
  assert.equal(notice.title, "Accesso non autorizzato");
  assert.equal(notice.denied, true);
  for (const code of ["auth/wrong-password", "auth/user-not-found", "auth/invalid-credential", "permission-denied"]) assert.deepEqual(authNotice({ code }), notice);
  assert.ok(!notice.message.includes("sensitive") && !notice.message.includes("Firebase"));
  assert.equal(authNotice({ code: "auth/network-request-failed" }).title, "Connessione non disponibile");
});
