export const ADMIN_EMAIL = "edneypugleise@gmail.com";
export const ADMIN_USERNAME = "admin";

export function accessDenied() {
  return Object.assign(new Error("Accesso non autorizzato."), { code: "admin/access-denied" });
}

export function emailForUsername(username) {
  const value = String(username || "").trim().toLowerCase();
  if (value === ADMIN_USERNAME || value === ADMIN_EMAIL) return ADMIN_EMAIL;
  throw accessDenied();
}

export function isAdminClaims(claims) {
  return claims?.email === ADMIN_EMAIL && claims.email_verified === true
    && ["google.com", "password"].includes(claims.firebase?.sign_in_provider);
}

export function createAdminAuth({ auth, sdk, verifyAccess }) {
  async function verifyAdmin(user) {
    const { claims } = await user.getIdTokenResult();
    if (!isAdminClaims(claims)) throw accessDenied();
    try { await verifyAccess(); }
    catch (error) {
      if (error.code?.includes("permission-denied") || error.code?.includes("unauthenticated")) throw accessDenied();
      throw error;
    }
    return user;
  }

  async function authenticate(operation) {
    const { user } = await operation();
    try { return await verifyAdmin(user); }
    catch (error) {
      if (auth.currentUser?.uid === user.uid) await sdk.signOut(auth);
      throw error;
    }
  }

  function signInWithGoogle() {
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return authenticate(() => sdk.signInWithPopup(auth, provider));
  }

  function signInWithPassword(username, password) {
    const email = emailForUsername(username);
    return authenticate(() => sdk.signInWithEmailAndPassword(auth, email, password));
  }

  function subscribeAdminAuth(listener) {
    let generation = 0, active = true;
    const unsubscribe = sdk.onIdTokenChanged(auth, async user => {
      const current = ++generation;
      if (!user) { if (active) listener({ user: null, loading: false, error: null }); return; }
      listener({ user: null, loading: true, error: null });
      try {
        await verifyAdmin(user);
        if (active && current === generation) listener({ user, loading: false, error: null });
      } catch (error) {
        if (!active || current !== generation) return;
        listener({ user: null, loading: false, error });
        if (error.code === "admin/access-denied" && auth.currentUser?.uid === user.uid) await sdk.signOut(auth);
      }
    }, error => { if (active) listener({ user: null, loading: false, error }); });
    return () => { active = false; generation++; unsubscribe(); };
  }

  return { signInWithGoogle, signInWithPassword, subscribeAdminAuth, signOutAdmin: () => sdk.signOut(auth) };
}
