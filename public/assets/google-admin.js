import { createMenuManager } from "./menu-manager.js";

export function authError(error) {
  const code = error?.code || "";
  if (code === "admin/access-denied") return "Accesso negato. Questo account Google non è autorizzato.";
  if (code.includes("permission-denied")) return "Accesso negato dal database. Accedi con l'account amministratore autorizzato.";
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return "Accesso annullato. Puoi riprovare.";
  if (code.includes("popup-blocked")) return "Consenti le finestre popup per questo sito e riprova.";
  if (code.includes("unauthorized-domain")) return "Questo dominio non è autorizzato. Apri il sito ufficiale Giannino Bistrot.";
  if (code.includes("network") || code.includes("unavailable")) return "Connessione non disponibile. Controlla la rete e riprova.";
  return "Impossibile accedere. Riprova tra poco.";
}

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
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
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
          if (state.error) setError(authError(state.error));
          if (state.user) { setError(""); navigate("/admin", { replace: true }); }
        });
      }).catch(() => { if (active) { setSession({ user: null, loading: false }); setError("Impossibile caricare l'accesso. Aggiorna la pagina e riprova."); } });
      return () => { active = false; unsubscribe?.(); };
    }, []);

    const login = async () => {
      setError(""); setBusy(true);
      try { await client.signInWithGoogle(); }
      catch (failure) { setError(authError(failure)); }
      finally { setBusy(false); }
    };
    const logout = async () => {
      try { await client.signOutAdmin(); navigate("/admin/login", { replace: true }); }
      catch (failure) { setError(authError(failure)); }
    };
    if (session.user && MenuManager) return h(MenuManager, {
      user: session.user, onSignOut: logout, onBackToSite: () => navigate("/"),
      siteUrl: new URL("../", import.meta.url).href,
    });
    return h("main", { className: "ga-main" },
      h("section", { className: "ga-card", "aria-labelledby": "ga-title", "aria-busy": session.loading || busy },
        h("h1", { id: "ga-title", className: "ga-title" }, "Area Riservata"),
        h("p", { className: "ga-subtitle" }, "ACCESSO AMMINISTRATORE"),
        h("p", { className: "ga-description" }, "Accedi con l'account Google autorizzato per gestire il menù."),
        h("button", { type: "button", className: "ga-google", disabled: !client || session.loading || busy, onClick: login },
          h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", "aria-hidden": true },
            h("path", { fill: "#4285f4", d: "M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.4" }),
            h("path", { fill: "#34a853", d: "M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9a6 6 0 0 1-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22" }),
            h("path", { fill: "#fbbc05", d: "M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z" }),
            h("path", { fill: "#ea4335", d: "M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6A6 6 0 0 1 12 6" })),
          busy ? "ACCESSO IN CORSO…" : session.loading ? "VERIFICA ACCESSO…" : "ACCEDI CON GOOGLE"),
        error && h("p", { className: "ga-error", role: "alert" }, error),
        h(Link, { to: "/", className: "ga-back" }, "← Torna al sito")));
  };
}
