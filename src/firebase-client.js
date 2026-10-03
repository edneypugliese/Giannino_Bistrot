import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, doc, getDocFromServer } from "firebase/firestore";
import { createCatalogClient } from "./catalog-store.js";
import { createAdminAuth } from "./admin-auth.js";
export { ADMIN_EMAIL, ADMIN_USERNAME } from "./admin-auth.js";

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

const adminAuth = createAdminAuth({
  auth,
  sdk: { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signInWithEmailAndPassword, signOut },
  // Conferma a autorização no servidor antes de abrir o painel.
  verifyAccess: () => getDocFromServer(doc(db, "sections", "menu")),
});
export const { signInWithGoogle, signInWithPassword, subscribeAdminAuth, signOutAdmin } = adminAuth;
