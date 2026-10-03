import { EMPTY_CATALOG, SECTION_LABELS, sorted, categoryPath, groupProducts, filterCatalog, productValues, categoryValues, euroCents } from "./catalog-model.js";

const PAGE_SIZE = 20;
const FIELD_LABELS = {
  id: "ID", name: "Nome", title: "Titolo", description: "Descrizione", section: "Sezione", section_key: "Chiave sezione",
  category_id: "ID categoria", parent_id: "ID categoria superiore", source_parent_id: "Riferimento originale",
  price: "Prezzo", price_cents: "Prezzo in centesimi", currency: "Valuta", sort_order: "Ordine",
  created_at: "Creato il", updated_at: "Aggiornato il",
  schedule: "Orario", route: "Pagina", subtitle: "Sottotitolo", footer_note: "Nota a piè di pagina", show_index: "Indice",
};

export function catalogError(error) {
  const code = error?.code || "";
  if (code.includes("permission-denied") || code.includes("unauthenticated")) return "Accesso negato. Accedi con l'account amministratore autorizzato.";
  if (code.includes("unavailable") || code.includes("network")) return "Connessione non disponibile. Controlla la rete e riprova; le modifiche non sono state salvate.";
  return error?.message || "Operazione non riuscita. Riprova.";
}

function metadataValue(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (typeof value?.toDate === "function") return value.toDate().toLocaleString("it-IT");
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

// Usa la stessa istanza React del sito, senza duplicare il runtime nel browser.
// catalogClient: subscribeCatalog, saveProduct, deleteProduct, saveCategory, deleteCategory.
export function createMenuManager(React, catalogClient) {
  const h = React.createElement;
  const { useState, useEffect, useRef } = React;

  function Metadata({ record, open = false, label = "Tutti i dati del record" }) {
    return h("details", { className: "mm-metadata", open },
      h("summary", null, label),
      h("dl", null, Object.entries(record).filter(([key]) => !["visible", "available"].includes(key)).map(([key, value]) => h(React.Fragment, { key },
        h("dt", null, FIELD_LABELS[key] || key), h("dd", null, metadataValue(value))))));
  }

  function Modal({ title, intro, children, onClose, busy = false, actions }) {
    const ref = useRef(null);
    const returnFocus = useRef(null);
    useEffect(() => {
      returnFocus.current = document.activeElement;
      ref.current.showModal();
      return () => { returnFocus.current?.focus?.(); };
    }, []);
    return h("dialog", {
      ref, className: "mm-dialog", "aria-labelledby": "mm-dialog-title", "aria-describedby": "mm-dialog-intro",
      onCancel: event => { event.preventDefault(); if (!busy) onClose(); },
    }, h("div", { className: "mm-dialog-inner" },
      h("h2", { className: "mm-dialog-title", id: "mm-dialog-title" }, title),
      h("p", { className: "mm-dialog-intro", id: "mm-dialog-intro" }, intro), children,
      actions && h("div", { className: "mm-dialog-actions" }, actions)));
  }

  function Editor({ kind, record, catalog, section, onClose, onSaved }) {
    const product = kind === "products";
    const defaultCategory = sorted(catalog.categories).find(row => !section || row.section === section);
    const defaultSection = section || catalog.sections[0]?.section_key || catalog.sections[0]?.id || "menu";
    const [draft, setDraft] = useState(() => record ? { ...record, price: record.price || "", description: record.description || "", schedule: record.schedule || "", parent_id: record.parent_id || "" } : {
      name: "", description: "", price: "", category_id: defaultCategory?.id || "", section: defaultCategory?.section || defaultSection,
      parent_id: "", schedule: "", sort_order: Math.max(-1, ...catalog[kind].filter(row => product ? row.category_id === defaultCategory?.id : row.section === defaultSection).map(row => row.sort_order || 0)) + 1,
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const initial = useRef(JSON.stringify(draft));
    const selectedSection = product ? catalog.categories.find(row => row.id === draft.category_id)?.section || draft.section : draft.section;
    const update = (key, value) => { setDraft(previous => ({ ...previous, [key]: value })); setError(""); };
    const close = () => {
      if (busy) return;
      if (JSON.stringify(draft) !== initial.current && !window.confirm("Vuoi chiudere senza salvare le modifiche?")) return;
      onClose();
    };
    const field = (key, label, type = "text", props = {}) => h("div", { className: "mm-field" + (props.full ? " mm-full" : ""), key },
      h("label", { htmlFor: "mm-edit-" + key }, label),
      h(type === "textarea" ? "textarea" : "input", {
        id: "mm-edit-" + key, name: key, className: "mm-input", type: type === "textarea" ? undefined : type,
        value: draft[key] ?? "", onChange: event => update(key, event.target.value), disabled: busy,
        required: key === "name" || key === "sort_order", maxLength: key === "name" ? 200 : key === "price" ? 100 : key === "schedule" ? 200 : 4000,
        autoFocus: key === "name", ...Object.fromEntries(Object.entries(props).filter(([name]) => name !== "full")),
      }));
    const select = (key, label, options, extra = {}) => h("div", { className: "mm-field", key },
      h("label", { htmlFor: "mm-edit-" + key }, label),
      h("select", { id: "mm-edit-" + key, name: key, className: "mm-input", value: draft[key] ?? "", disabled: busy, onChange: event => update(key, event.target.value), ...extra }, options));
    const sectionOptions = sorted(catalog.sections).map(row => {
      const key = row.section_key || row.id;
      return h("option", { value: key, key }, row.title || SECTION_LABELS[key] || key);
    });
    const categoryOptions = sorted(catalog.categories.filter(row => row.section === selectedSection)).map(row => h("option", { value: row.id, key: row.id }, categoryPath(row, catalog.categories)));
    const parentOptions = sorted(catalog.categories.filter(row => row.section === draft.section && row.id !== record?.id)).filter(row => {
      const visited = new Set();
      while (row && !visited.has(row.id)) {
        if (row.id === record?.id) return false;
        visited.add(row.id);
        row = catalog.categories.find(parent => parent.id === row.parent_id);
      }
      return true;
    }).map(row => h("option", { value: row.id, key: row.id }, categoryPath(row, catalog.categories)));

    async function submit(event) {
      event.preventDefault();
      if (busy) return;
      setError("");
      try {
        const values = product ? productValues(draft, catalog) : categoryValues(draft, catalog);
        setBusy(true);
        await (product ? catalogClient.saveProduct : catalogClient.saveCategory)({ ...values, ...(record ? { id: record.id } : {}) }, record);
        onSaved(`${product ? "Prodotto" : "Categoria"} ${record ? "aggiornato" : "creato"} con successo.`);
      } catch (failure) { setError(catalogError(failure)); }
      finally { setBusy(false); }
    }

    return h(Modal, { title: `${record ? "Modifica" : "Nuovo"} ${product ? "prodotto" : "categoria"}`, intro: "Le modifiche salvate sono pubblicate subito nel menù del sito.", onClose: close, busy },
      h("form", { onSubmit: submit },
        h("fieldset", { disabled: busy, className: "mm-form", style: { border: 0, padding: 0, margin: 0 } },
          field("name", "Nome *", "text", { full: true }),
          product ? h("div", { className: "mm-field" }, h("label", { htmlFor: "mm-product-section" }, "Sezione *"),
            h("select", { id: "mm-product-section", className: "mm-input", value: selectedSection, onChange: event => {
              const next = event.target.value;
              const category = sorted(catalog.categories).find(row => row.section === next);
              setDraft(previous => ({ ...previous, section: next, category_id: category?.id || "" }));
            } }, sectionOptions)) : select("section", "Sezione *", sectionOptions, { required: true, disabled: busy || !!record }),
          product ? select("category_id", "Categoria *", [h("option", { key: "empty", value: "" }, "Seleziona una categoria"), ...categoryOptions], { required: true }) :
            select("parent_id", "Categoria superiore", [h("option", { key: "empty", value: "" }, "Nessuna (categoria principale)"), ...parentOptions]),
          field("description", "Descrizione", "textarea", { full: true }),
          product ? field("price", "Prezzo (€)", "text", { placeholder: "es. 15,00", inputMode: "text" }) : field("schedule", "Orario", "text", { placeholder: "es. Dalle 12:00 alle 15:00" }),
          field("sort_order", "Ordine di visualizzazione *", "number", { min: 0, max: 1000000, step: 1 }),
          product && h("p", { className: "mm-help mm-full" }, "Usa la virgola per i decimali. Puoi lasciare il prezzo vuoto o inserire una nota, ad esempio “al calice”.")),
        error && h("p", { className: "mm-message mm-message-error", role: "alert", style: { marginTop: 18 } }, error),
        h("div", { className: "mm-dialog-actions" },
          h("button", { type: "button", className: "mm-btn", disabled: busy, onClick: close }, "Annulla"),
          h("button", { type: "submit", className: "mm-btn mm-btn-primary", disabled: busy }, busy ? "Salvataggio…" : "Salva modifiche"))),
      record && h(Metadata, { record }));
  }

  function DeleteDialog({ kind, record, catalog, onClose, onDeleted }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const product = kind === "products";
    const products = product ? 0 : catalog.products.filter(row => row.category_id === record.id).length;
    const children = product ? 0 : catalog.categories.filter(row => row.parent_id === record.id).length;
    const blocked = products > 0 || children > 0;
    async function remove() {
      if (busy || blocked) return;
      setBusy(true);
      setError("");
      try {
        await (product ? catalogClient.deleteProduct : catalogClient.deleteCategory)(record);
        onDeleted(`${product ? "Prodotto" : "Categoria"} eliminato con successo.`);
      } catch (failure) { setError(catalogError(failure)); }
      finally { setBusy(false); }
    }
    return h(Modal, { title: `Elimina ${product ? "prodotto" : "categoria"}`, intro: "Questa operazione rimuove il record dal catalogo.", onClose, busy,
      actions: [
        h("button", { key: "cancel", className: "mm-btn", disabled: busy, onClick: onClose }, "Annulla"),
        h("button", { key: "delete", className: "mm-btn mm-btn-danger", disabled: busy || blocked, onClick: remove }, busy ? "Eliminazione…" : "Conferma eliminazione"),
      ] },
      h("p", { className: "mm-item-name" }, record.name),
      blocked ? h("p", { className: "mm-message", role: "status" }, `Questa categoria contiene ${products} prodotti e ${children} sottocategorie. Spostali o rimuovili prima di eliminare la categoria.`) :
        h("p", { className: "mm-subtitle" }, "Il record eliminato sarà rimosso anche dal menù del sito."),
      error && h("p", { className: "mm-message mm-message-error", role: "alert" }, error));
  }

  return function MenuManager({ user, onSignOut, onBackToSite, siteUrl = new URL("../", import.meta.url).pathname } = {}) {
    const [catalog, setCatalog] = useState(EMPTY_CATALOG);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [retry, setRetry] = useState(0);
    const [view, setView] = useState("products");
    const [section, setSection] = useState("menu");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [editor, setEditor] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [message, setMessage] = useState("");
    const [logoutBusy, setLogoutBusy] = useState(false);
    const tabRefs = useRef({});

    useEffect(() => {
      setLoading(true);
      setLoadError("");
      return catalogClient.subscribeCatalog(data => { setCatalog(data); setLoading(false); setLoadError(""); }, error => {
        setLoadError(catalogError(error)); setLoading(false);
      });
    }, [retry]);
    useEffect(() => { setPage(1); }, [search, section, view]);

    const rows = filterCatalog(catalog, { section, search, view });
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const currentPage = Math.min(page, pages);
    const visibleRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const categories = catalog.categories.filter(row => row.section === section);
    const categoryIds = new Set(categories.map(row => row.id));
    const productCount = catalog.products.filter(row => categoryIds.has(row.category_id)).length;
    const sectionRecord = catalog.sections.find(row => (row.section_key || row.id) === section);
    const productGroups = view === "products" ? groupProducts(rows, categories) : [];
    const sectionName = key => catalog.sections.find(row => (row.section_key || row.id) === key)?.title || SECTION_LABELS[key] || key || "—";
    const sectionTabs = Object.entries(SECTION_LABELS);
    const changeView = next => { setView(next); setPage(1); setMessage(""); };
    const changeSection = next => { setSection(next); setView("products"); setSearch(""); setPage(1); setMessage(""); };
    const navigateTabs = (event, index) => {
      const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? sectionTabs.length - 1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + sectionTabs.length) % sectionTabs.length;
      const next = sectionTabs[nextIndex][0];
      changeSection(next);
      tabRefs.current[next]?.focus();
    };
    const finish = text => { setEditor(null); setDeleting(null); setMessage(text); };

    const table = (items, label) => h("div", { className: "mm-table-wrap", tabIndex: 0, role: "region", "aria-label": label },
      h("table", { className: `mm-table mm-table-${view}` },
        h("thead", null, h("tr", null, ...(view === "products" ? ["Prodotto", "Prezzo", "Azioni"] : ["Categoria", "Percorso", "Contenuto", "Azioni"]).map(label => h("th", { key: label, scope: "col" }, label)))),
        h("tbody", null, items.map(row => h("tr", { key: row.id },
          h("td", null, h("p", { className: "mm-item-name" }, row.name), h("p", { className: "mm-description" }, row.description || "—"), row.schedule && h("p", { className: "mm-help" }, row.schedule)),
          view === "categories" && h("td", null, h("p", { className: "mm-category-name" }, categoryPath(row, catalog.categories))),
          h("td", null, view === "products" ? h("span", { className: "mm-price" }, row.price ? `${row.price}${euroCents(row.price) !== null && !/^€|€$/.test(row.price.trim()) ? " €" : ""}` : "—") :
            h("span", { className: "mm-help" }, `${catalog.products.filter(item => item.category_id === row.id).length} prodotti · ${catalog.categories.filter(item => item.parent_id === row.id).length} sottocategorie`)),
          h("td", null, h("div", { className: "mm-actions" },
            h("button", { className: "mm-btn mm-btn-small", "aria-label": `Modifica ${row.name}`, onClick: () => { setMessage(""); setEditor({ kind: view, record: row }); } }, "Modifica"),
            h("button", { className: "mm-btn mm-btn-small mm-btn-danger", "aria-label": `Elimina ${row.name}`, onClick: () => { setMessage(""); setDeleting({ kind: view, record: row }); } }, "Elimina"))))))));

    async function logout() {
      if (logoutBusy) return;
      setLogoutBusy(true);
      try { await onSignOut?.(); }
      catch (error) { setLoadError(catalogError(error)); }
      finally { setLogoutBusy(false); }
    }

    return h("section", { className: "menu-manager", "aria-label": "Gestione del menù" },
      h("div", { className: "mm-heading" },
        h("div", null, h("p", { className: "mm-eyebrow" }, "Giannino · Area riservata"),
          h("h1", { className: "mm-title" }, "Gestione del menù"),
          h("p", { className: "mm-subtitle" }, "Tutti i tuoi menù, in un unico luogo. Aggiungi e modifica prodotti, prezzi e categorie.")),
        h("div", { className: "mm-actions" },
          h("a", { className: "mm-btn", href: siteUrl, onClick: onBackToSite }, "Visualizza il sito"),
          onSignOut && h("button", { className: "mm-btn", onClick: logout, disabled: logoutBusy }, logoutBusy ? "Uscita…" : "Esci"))),
      user?.email && h("p", { className: "mm-help", style: { marginBottom: 20 } }, `Accesso effettuato: ${user.email}`),
      loadError && h("div", { className: "mm-message mm-message-error", role: "alert" }, loadError, " ",
        h("button", { className: "mm-btn mm-btn-small", onClick: () => setRetry(value => value + 1) }, "Riprova")),
      message && h("p", { className: "mm-message", role: "status", "aria-live": "polite" }, message),
      loading ? h("p", { className: "mm-empty", role: "status" }, "Caricamento del catalogo…") : !loadError && h(React.Fragment, null,
        h("div", { className: "mm-tabs", role: "tablist", "aria-label": "Menù da gestire" },
          ...sectionTabs.map(([key, label], index) => h("button", {
            key, className: "mm-tab", role: "tab", id: `mm-tab-${key}`, "aria-controls": "mm-tab-panel",
            "aria-selected": section === key, tabIndex: section === key ? 0 : -1,
            ref: element => { tabRefs.current[key] = element; },
            onClick: () => changeSection(key), onKeyDown: event => navigateTabs(event, index),
          }, label))),
        h("section", { id: "mm-tab-panel", role: "tabpanel", "aria-labelledby": `mm-tab-${section}` },
          h("div", { className: "mm-view-switch", role: "group", "aria-label": `Contenuti di ${sectionName(section)}` },
            ...[["products", "Prodotti", productCount], ["categories", "Categorie", categories.length]].map(([key, label, count]) => h("button", {
              key, className: "mm-view-button", "aria-pressed": view === key, onClick: () => changeView(key),
            }, `${label} (${count})`))),
          h("div", { className: "mm-toolbar" },
            h("div", { className: "mm-field mm-field-search" }, h("label", { htmlFor: "mm-search" }, `Cerca in ${sectionName(section)}`),
              h("input", { className: "mm-input", type: "search", id: "mm-search", value: search, placeholder: "Nome, descrizione o categoria…", onChange: event => setSearch(event.target.value) }))),
          h("div", { className: "mm-results" }, h("span", { "aria-live": "polite" }, `${rows.length} ${view === "products" ? "prodotti trovati" : "categorie trovate"}`),
            h("div", { className: "mm-actions" },
              search && h("button", { className: "mm-btn mm-btn-small", onClick: () => setSearch("") }, "Cancella ricerca"),
              h("button", { className: "mm-btn mm-btn-primary", disabled: view === "products" && !categories.length, onClick: () => { setMessage(""); setEditor({ kind: view, record: null }); } }, view === "products" ? "+ Nuovo prodotto" : "+ Nuova categoria"))),
          view === "products" && !categories.length && h("p", { className: "mm-help" }, "Crea prima una categoria in questo menù per aggiungere prodotti."),
          rows.length === 0 ? h("p", { className: "mm-empty" }, "Nessun risultato in questo menù. Prova un'altra ricerca o aggiungi un nuovo elemento.") :
            view === "products" ? h("div", { className: "mm-product-groups" }, productGroups.map(({ category, products }) => {
              const label = category ? categoryPath(category, catalog.categories) : "Categoria da assegnare";
              const headingId = `mm-category-${category?.id || "unassigned"}`;
              return h("section", { key: category?.id || "unassigned", className: "mm-product-group", "aria-labelledby": headingId },
                h("div", { className: "mm-group-heading" }, h("h2", { id: headingId, className: "mm-group-title" }, label),
                  h("span", { className: "mm-help" }, `${products.length} ${products.length === 1 ? "prodotto" : "prodotti"}`)),
                category?.schedule && h("p", { className: "mm-group-schedule mm-help" }, category.schedule),
                table(products, `Prodotti · ${label}`));
            })) : h(React.Fragment, null,
              table(visibleRows, "Categorie del menù, tabella scorrevole"),
              h("div", { className: "mm-pagination" }, h("span", null, `Pagina ${currentPage} di ${pages} · ${rows.length} elementi`),
                h("div", { className: "mm-actions" },
                  h("button", { className: "mm-btn mm-btn-small", disabled: currentPage <= 1, onClick: () => setPage(currentPage - 1) }, "Precedente"),
                  h("button", { className: "mm-btn mm-btn-small", disabled: currentPage >= pages, onClick: () => setPage(currentPage + 1) }, "Successiva")))),
          sectionRecord && h(Metadata, { key: section, record: sectionRecord, label: "Tutti i dati della sezione" }))),
      editor && h(Editor, { key: editor.record?.id || editor.kind, ...editor, catalog, section, onClose: () => setEditor(null), onSaved: finish }),
      deleting && h(DeleteDialog, { ...deleting, catalog, onClose: () => setDeleting(null), onDeleted: finish }));
  };
}
