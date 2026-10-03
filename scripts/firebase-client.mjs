import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import firestore from "@google-cloud/firestore";
import { OAuth2Client } from "google-auth-library";

const { Firestore, v1 } = firestore;

export function cliAuthClient() {
  const require = createRequire(import.meta.url);
  const { getProjectDefaultAccount } = require("firebase-tools/lib/auth.js");
  const api = require("firebase-tools/lib/api.js");
  const account = getProjectDefaultAccount(resolve(fileURLToPath(new URL("../", import.meta.url))));
  if (!account?.tokens?.refresh_token) throw new Error("Entre no Firebase com npx -y firebase-tools@latest login antes de importar.");
  const client = new OAuth2Client(api.clientId(), api.clientSecret());
  client.setCredentials({ refresh_token: account.tokens.refresh_token });
  return client;
}

export async function connectCatalog(auth = "cli") {
  const config = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8")).firestore;
  const project = JSON.parse(readFileSync(new URL("../.firebaserc", import.meta.url), "utf8")).projects.default;
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Remova FIRESTORE_EMULATOR_HOST para operar no banco remoto.");
  let authClient;
  if (auth === "cli") {
    authClient = cliAuthClient();
  } else if (auth !== "adc") {
    throw new Error("Use --auth cli ou --auth adc.");
  }
  const settings = { projectId: project, databaseId: config.database, preferRest: true, ...(authClient ? { authClient } : {}) };
  const admin = new v1.FirestoreAdminClient({ projectId: project, fallback: true, ...(authClient ? { authClient } : {}) });
  try {
    const [database] = await admin.getDatabase({ name: `projects/${project}/databases/${config.database}` });
    const edition = database.databaseEdition;
    if (edition !== "ENTERPRISE" && edition !== 2) throw new Error(`Edição inesperada no banco ${config.database}: ${edition}.`);
    if (database.locationId !== config.location) throw new Error(`Região inesperada: ${database.locationId}.`);
    if (database.type !== "FIRESTORE_NATIVE" && database.type !== 1) throw new Error("O banco precisa usar o modo nativo do Firestore.");
    return { db: new Firestore(settings), project, database: config.database, location: database.locationId };
  } finally {
    await admin.close();
  }
}
