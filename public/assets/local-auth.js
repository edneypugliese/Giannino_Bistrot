// Adapta a interface de autenticação usada pelo frontend ao servidor local.
// A sessão usa cookie HttpOnly; nenhuma credencial é enviada ao Supabase.
const listeners = new Set();
let currentSession = null;

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita");
  return result;
}

function notify(event, session) {
  currentSession = session;
  for (const callback of listeners) callback(event, session);
}

export const localAuthClient = {
  auth: {
    async getSession() {
      try {
        const { session } = await request("/api/auth/session");
        currentSession = session;
        return { data: { session }, error: null };
      } catch {
        return { data: { session: null }, error: null };
      }
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    async signInWithPassword(credentials) {
      try {
        const { session } = await request("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(credentials),
        });
        notify("SIGNED_IN", session);
        return { data: { session }, error: null };
      } catch (error) {
        return { data: { session: null }, error };
      }
    },
    async signOut() {
      await request("/api/auth/logout", { method: "POST", body: "{}" });
      notify("SIGNED_OUT", null);
      return { error: null };
    },
  },
};
