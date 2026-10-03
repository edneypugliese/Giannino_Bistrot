import { collection, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { execute, field } from "firebase/firestore/pipelines";
import { productValues, categoryValues, publicCatalogDocument, SECTION_LABELS, sorted } from "../public/assets/catalog-model.js";

const defaultSdk = { collection, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp, execute, field };
const TABLES = ["sections", "categories", "products"];

function comparable(value) {
  if (value == null || typeof value !== "object") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(comparable);
  return Object.fromEntries(Object.keys(value).filter(key => key !== "id").sort().map(key => [key, comparable(value[key])]));
}

function unchanged(current, previous) {
  if (!current) throw new Error("Questo elemento è stato eliminato. Chiudi la finestra e aggiorna il catalogo.");
  if (!previous || JSON.stringify(comparable(current)) !== JSON.stringify(comparable(previous))) {
    throw new Error("Questo elemento è stato modificato in un'altra finestra. Chiudi l'editor e riaprilo per usare i dati aggiornati.");
  }
}

function validId(id) {
  if (typeof id !== "string" || !id || id.includes("/") || id === "." || id === "..") throw new Error("ID non valido.");
  return id;
}

export function createCatalogClient(db, { sdk = defaultSdk, timeoutMs = 15000 } = {}) {
  const ref = (table, id) => sdk.doc(db, table, validId(id));
  const revisionRef = sdk.doc(db, "_catalog", "revision");

  // A lista deve refletir também edições feitas em outra aba ou no Console.
  // Os listeners padrão são necessários para essa atualização em tempo real;
  // as verificações pontuais de hierarquia usam pipelines Enterprise.
  function subscribeCatalog(onNext, onError) {
    let active = true;
    const data = {};
    const ready = new Set();
    const listeners = [];
    const stop = () => { active = false; clearTimeout(timer); listeners.splice(0).forEach(unsubscribe => unsubscribe()); };
    const fail = error => { if (active) { stop(); onError(error); } };
    const timer = setTimeout(() => fail(Object.assign(new Error("Connessione al catalogo non disponibile. Controlla la rete e riprova."), { code: "unavailable" })), timeoutMs);
    try {
      for (const table of TABLES) {
        const unsubscribe = sdk.onSnapshot(sdk.collection(db, table), { includeMetadataChanges: true }, snapshot => {
          if (!active || snapshot.metadata?.hasPendingWrites) return;
          if (!ready.has(table) && snapshot.metadata?.fromCache) return;
          data[table] = sorted(snapshot.docs.map(row => ({ ...row.data(), id: row.id })));
          ready.add(table);
          if (ready.size === TABLES.length) {
            clearTimeout(timer);
            onNext({ sections: data.sections, categories: data.categories, products: data.products });
          }
        }, fail);
        if (active) listeners.push(unsubscribe); else unsubscribe();
      }
    } catch (error) { fail(error); }
    return stop;
  }

  async function pipelineRows(table) {
    const snapshot = await sdk.execute(db.pipeline().collection(table).sort(sdk.field("sort_order").ascending()));
    return snapshot.results.map(row => ({ ...row.data(), id: row.id }));
  }

  async function readCatalog() {
    const [sections, categories, products] = await Promise.all(TABLES.map(pipelineRows));
    return { sections, categories, products };
  }

  async function readPublicCatalog(section) {
    if (!Object.hasOwn(SECTION_LABELS, section)) throw new Error("Sezione non valida.");
    const snapshot = await sdk.getDocFromServer(ref("public_catalogs", section));
    if (!snapshot.exists() || snapshot.data().schema_version !== 1) throw new Error("Catalogo pubblico non disponibile.");
    const payload = JSON.parse(snapshot.data().payload);
    if (!payload || !Array.isArray(payload.categories) || !Array.isArray(payload.products)) throw new Error("Catalogo pubblico non valido.");
    return payload;
  }

  async function mutate(table, values, previous, remove = false) {
    const editing = remove || !!values.id;
    const target = editing ? ref(table, values.id) : sdk.doc(sdk.collection(db, table));
    return sdk.runTransaction(db, async transaction => {
      // Todas as mutações da interface incrementam a revisão. Uma edição
      // concorrente durante a conferência da hierarquia reinicia a transação.
      const revision = await transaction.get(revisionRef);
      const currentSnapshot = editing ? await transaction.get(target) : null;
      const current = currentSnapshot?.exists() ? currentSnapshot.data() : null;
      if (editing) unchanged(current, previous);
      const catalog = await readCatalog();
      let clean;
      if (table === "products") {
        if (!remove) {
          const categorySnapshot = await transaction.get(ref("categories", values.category_id));
          if (!categorySnapshot.exists()) throw new Error("La categoria non esiste più. Seleziona un'altra categoria.");
          const category = { ...categorySnapshot.data(), id: categorySnapshot.id };
          clean = productValues(values, { categories: [category] });
        }
      } else {
        if (remove) {
          if (catalog.products.some(row => row.category_id === target.id) || catalog.categories.some(row => row.parent_id === target.id)) {
            throw new Error("La categoria contiene prodotti o sottocategorie. Spostali o rimuovili prima di eliminarla.");
          }
        } else {
          clean = categoryValues(values, catalog);
          // Anche le modifiche dal Console ai genitori durante la transazione
          // devono causare un retry, per evitare una gerarchia incoerente.
          let parentId = clean.parent_id;
          const visited = new Set([target.id]);
          while (parentId) {
            if (visited.has(parentId)) throw new Error("Una categoria non può contenere se stessa.");
            visited.add(parentId);
            const parent = await transaction.get(ref("categories", parentId));
            if (!parent.exists() || parent.data().section !== clean.section) throw new Error("La categoria superiore non è più valida.");
            parentId = parent.data().parent_id;
          }
        }
      }
      const now = sdk.serverTimestamp();
      const oldCategory = table === "products" && catalog.categories.find(row => row.id === current?.category_id);
      const affected = new Set([current?.section || oldCategory?.section, clean?.section].filter(section => Object.hasOwn(SECTION_LABELS, section)));
      // Bloqueia também os metadados da seção; uma edição pelo Console durante
      // a publicação deve fazer a transação conferir novamente a visibilidade.
      for (const section of affected) {
        const definition = await transaction.get(ref("sections", section));
        const index = catalog.sections.findIndex(row => (row.section_key || row.id) === section);
        if (definition.exists()) {
          const row = { ...definition.data(), id: section };
          if (index < 0) catalog.sections.push(row); else catalog.sections[index] = row;
        } else if (index >= 0) catalog.sections.splice(index, 1);
      }
      catalog[table] = catalog[table].filter(row => row.id !== target.id);
      if (!remove) catalog[table].push({ ...current, ...clean, id: target.id });
      const publications = [...affected].map(section => [ref("public_catalogs", section), publicCatalogDocument(catalog, section, now)]);
      if (remove) transaction.delete(target);
      else if (editing) transaction.update(target, { ...clean, updated_at: now });
      else transaction.set(target, { ...clean, id: target.id, created_at: now, updated_at: now });
      transaction.set(revisionRef, { revision: (revision.exists() ? revision.data().revision || 0 : 0) + 1, updated_at: now });
      for (const [reference, publication] of publications) transaction.set(reference, publication);
      return { id: target.id, ...clean };
    });
  }

  return {
    subscribeCatalog,
    readCatalog,
    readPublicCatalog,
    saveProduct: (values, previous) => mutate("products", values, previous),
    deleteProduct: previous => mutate("products", { id: previous.id }, previous, true),
    saveCategory: (values, previous) => mutate("categories", values, previous),
    deleteCategory: previous => mutate("categories", { id: previous.id }, previous, true),
  };
}
