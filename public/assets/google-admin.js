import { createMenuManager } from "./menu-manager.js";

export function authNotice(error) {
  const code = error?.code || "";
  if (["admin/access-denied", "auth/user-disabled", "auth/invalid-credential", "auth/invalid-login-credentials", "auth/user-not-found", "auth/wrong-password", "auth/invalid-email"].includes(code) || code.includes("permission-denied")) {
    return { title: "Accesso non autorizzato", message: "Non disponi dell'accesso all'area riservata con questo account o con le credenziali inserite. Verifica nome utente e password oppure accedi con un account abilitato.", denied: true };
  }
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return { title: "Accesso annullato", message: "La finestra di accesso è stata chiusa. Puoi riprovare quando desideri." };
  if (code.includes("popup-blocked")) return { title: "Consenti la finestra di accesso", message: "Il browser ha bloccato la finestra di Google. Consenti i popup per questo sito e riprova." };
  if (code.includes("unauthorized-domain")) return { title: "Accesso non disponibile", message: "Apri il sito ufficiale Giannino Bistrot per accedere all'area riservata." };
  if (code.includes("network") || code.includes("unavailable")) return { title: "Connessione non disponibile", message: "Non è stato possibile completare l'accesso. Controlla la connessione e riprova." };
  if (code.includes("too-many-requests")) return { title: "Attendi prima di riprovare", message: "Sono stati effettuati diversi tentativi di accesso. Attendi qualche minuto e riprova." };
  return { title: "Accesso non disponibile", message: "Non è stato possibile completare l'accesso. Riprova tra poco." };
}

export function authError(error) { return authNotice(error).message; }

export function createGoogleAdmin(React, { useNavigate, Link }) {
  const h = React.createElement;
  const { useState, useEffect } = React;
  let clientPromise;
  const loadClient = () => clientPromise ||= import("./firebase-client.js");
  let MenuManager;

  return function GoogleAdmin() {
    const navigate = useNavigate();
    const [client, setClient] = useState(null);
    const [session, setSession] = useState({ user: null, loading: true });
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    useEffect(() => {
      let active = true;
      let unsubscribe;
      loadClient().then(module => {
        if (!active) return;
        MenuManager ||= createMenuManager(React, module.catalogClient);
        setClient(module);
        unsubscribe = module.subscribeAdminAuth(state => {
          if (!active) return;
          setSession(state);
          if (state.error) setNotice(authNotice(state.error));
          if (state.user) { setNotice(null); navigate("/admin", { replace: true }); }
        });
      }).catch(() => { if (active) { setSession({ user: null, loading: false }); setNotice({ title: "Accesso non disponibile", message: "Non è stato possibile caricare la pagina di accesso. Aggiorna la pagina e riprova." }); } });
      return () => { active = false; unsubscribe?.(); };
    }, []);

    const login = async mode => {
      setNotice(null); setBusy(mode);
      try {
        if (mode === "password") await client.signInWithPassword(username, password);
        else await client.signInWithGoogle();
      }
      catch (failure) { setNotice(authNotice(failure)); }
      finally { setPassword(""); setBusy(""); }
    };
    const logout = async () => {
      try { await client.signOutAdmin(); navigate("/admin/login", { replace: true }); }
      catch (failure) { setNotice(authNotice(failure)); }
    };
    if (session.user && MenuManager) return h(MenuManager, {
      user: session.user, onSignOut: logout, onBackToSite: () => navigate("/"),
      siteUrl: new URL("../", import.meta.url).href,
    });
    const disabled = !client || session.loading || !!busy;
    return h("main", { className: "ga-main" },
      h("section", { className: "ga-card", "aria-labelledby": "ga-title", "aria-busy": session.loading || !!busy },
        h("h1", { id: "ga-title", className: "ga-title" }, "Area Riservata"),
        h("p", { className: "ga-subtitle" }, "ACCESSO AMMINISTRATORE"),
        h("p", { className: "ga-description" }, "Accedi con le tue credenziali oppure con l'account Google autorizzato."),
        h("form", { className: "ga-form", onSubmit: event => { event.preventDefault(); if (!disabled) login("password"); } },
          h("div", { className: "ga-field" },
            h("label", { htmlFor: "ga-username" }, "Nome utente"),
            h("input", { id: "ga-username", name: "username", type: "text", autoComplete: "username", autoCapitalize: "none", spellCheck: false, placeholder: "Nome utente o email", value: username, onChange: event => setUsername(event.target.value), required: true, maxLength: 254, disabled })),
          h("div", { className: "ga-field" },
            h("label", { htmlFor: "ga-password" }, "Password"),
            h("input", { id: "ga-password", name: "password", type: "password", autoComplete: "current-password", value: password, onChange: event => setPassword(event.target.value), required: true, disabled })),
          h("button", { type: "submit", className: "ga-submit", disabled }, busy === "password" ? "ACCESSO IN CORSO…" : session.loading ? "VERIFICA ACCESSO…" : "ACCEDI")),
        h("div", { className: "ga-divider" }, h("span", null, "oppure")),
        h("button", { type: "button", className: "ga-google", disabled, onClick: () => login("google") },
          h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", "aria-hidden": true },
            h("path", { fill: "#4285f4", d: "M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.4" }),
            h("path", { fill: "#34a853", d: "M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9a6 6 0 0 1-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22" }),
            h("path", { fill: "#fbbc05", d: "M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z" }),
            h("path", { fill: "#ea4335", d: "M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6A6 6 0 0 1 12 6" })),
          busy === "google" ? "ACCESSO IN CORSO…" : "ACCEDI CON GOOGLE"),
        notice && h("div", { className: "ga-notice", role: "alert", "aria-labelledby": "ga-notice-title" },
          h("svg", { className: "ga-notice-icon", width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true },
            notice.denied ? h("g", null, h("rect", { x: 5, y: 10, width: 14, height: 11, rx: 2 }), h("path", { d: "M8 10V7a4 4 0 0 1 8 0v3M12 14v3" })) : h("g", null, h("circle", { cx: 12, cy: 12, r: 9 }), h("path", { d: "M12 10v6M12 7h.01" }))),
          h("div", null, h("h2", { className: "ga-notice-title", id: "ga-notice-title" }, notice.title), h("p", null, notice.message))),
        h(Link, { to: "/", className: "ga-back" }, "← Torna al sito")));
  };
}
