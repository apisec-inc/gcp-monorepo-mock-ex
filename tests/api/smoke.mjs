// End-to-end check against emulators + dev gateway. Also seeds test users.
//   pnpm emulators        (terminal 1)
//   pnpm gateway:dev      (terminal 2)
//   pnpm test:smoke [--all]
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";

const { project, functions } = JSON.parse(readFileSync(new URL("../../manifest/functions.json", import.meta.url)));
initializeApp({ projectId: project });
const auth = getAuth();
const API = process.env.API_BASE ?? "http://localhost:8787";

const USERS = {
  aAdmin: { email: "admin@tenant-a.test", tenantId: "tenant-a", role: "admin" },
  aViewer: { email: "viewer@tenant-a.test", tenantId: "tenant-a", role: "viewer" },
  bAdmin: { email: "admin@tenant-b.test", tenantId: "tenant-b", role: "admin" },
};

async function tokenFor({ email, tenantId, role }) {
  let u;
  try { u = await auth.getUserByEmail(email); } catch { u = await auth.createUser({ email, password: "password123" }); }
  await auth.setCustomUserClaims(u.uid, { tenantId, role });
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password123", returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}

const call = async (method, path, token, body) => {
  const r = await fetch(API + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

let failed = 0;
const expect = (name, got, want) => {
  const ok = Array.isArray(want) ? want.includes(got) : got === want;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name} (got ${got}, want ${want})`);
};

const t = Object.fromEntries(await Promise.all(Object.entries(USERS).map(async ([k, v]) => [k, await tokenFor(v)])));

const created = await call("POST", "/v1/catalog/products", t.aAdmin, { name: "Smoke widget", tenantId: "tenant-b" });
expect("admin creates product", created.status, 201);
const id = created.body?.id;
const got = await call("GET", `/v1/catalog/products/${id}`, t.aAdmin);
expect("admin reads it back", got.status, 200);
expect("body tenantId ignored (stays tenant-a)", got.body?.tenantId, "tenant-a");
expect("no token → 401", (await call("GET", "/v1/catalog/products", null)).status, 401);
expect("viewer cannot delete → 403", (await call("DELETE", `/v1/catalog/products/${id}`, t.aViewer)).status, 403);
expect("other tenant via ?tenantId → 403", (await call("GET", `/v1/catalog/products/${id}?tenantId=tenant-a`, t.bAdmin)).status, 403);
expect("other tenant default scope → 404", (await call("GET", `/v1/catalog/products/${id}`, t.bAdmin)).status, 404);
expect("wrong method → 405", (await call("PUT", "/v1/catalog/products", t.aAdmin)).status, 405);

if (process.argv.includes("--all")) {
  const lists = functions.filter((f) => f.type === "https" && f.action === "list");
  for (const f of lists) expect(`GET ${f.path}`, (await call("GET", f.path, t.aAdmin)).status, 200);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
