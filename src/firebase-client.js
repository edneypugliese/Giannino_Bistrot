import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore, doc, getDocFromServer } from "firebase/firestore";
import { createCatalogClient } from "./catalog-store.js";

// Configuração pública do aplicativo web. A autorização é aplicada pelo Firestore.
export const app = initializeApp({
  apiKey: "AIzaSyATcvevcW7_ou_GVM9SOkKrgnXe7TjsKNE",
  authDomain: "giannino-bistrot.firebaseapp.com",
  projectId: "giannino-bistrot",
  storageBucket: "giannino-bistrot.firebasestorage.app",
  messagingSenderId: "375865247329",
  appId: "1:375865247329:web:83de63d681204689a6cc20",
});
export const auth = getAuth(app);
export const db = getFirestore(app, "catalogo");
export const catalogClient = createCatalogClient(db);
export const ADMIN_EMAIL = "edneypugleise@gmail.com";

function denied() {
  return Object.assign(new Error("Accesso negato. Questo account Google non è autorizzato."), { code: "admin/access-denied" });
}

async function verifyAdmin(user) {
  const { claims } = await user.getIdTokenResult();
  if (claims.email !== ADMIN_EMAIL || claims.email_verified !== true || claims.firebase?.sign_in_provider !== "google.com") {
    throw denied();
  }
  // Anche una pagina modificata nel browser deve superare le regole sul server.
  await getDocFromServer(doc(db, "sections", "menu"));
  return user;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const { user } = await signInWithPopup(auth, provider);
  try {
    return await verifyAdmin(user);
  } catch (error) {
    await signOut(auth);
    throw error;
  }
}

export function subscribeAdminAuth(listener) {
  let generation = 0;
  const unsubscribe = onIdTokenChanged(auth, async user => {
    const current = ++generation;
    if (!user) { listener({ user: null, loading: false, error: null }); return; }
    listener({ user: null, loading: true, error: null });
    try {
      await verifyAdmin(user);
      if (current === generation) listener({ user, loading: false, error: null });
    } catch (error) {
      if (current !== generation) return;
      // Non conservare sessioni di altri account nella pagina amministrativa.
      if (error.code === "admin/access-denied") await signOut(auth);
      if (current === generation || error.code === "admin/access-denied") listener({ user: null, loading: false, error });
    }
  }, error => listener({ user: null, loading: false, error }));
  return () => { generation++; unsubscribe(); };
}

export function signOutAdmin() { return signOut(auth); }
