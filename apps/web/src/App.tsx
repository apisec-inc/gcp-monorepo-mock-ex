import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, type User } from "firebase/auth";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { API_BASE, auth, db, functions } from "./firebase";

type Doc = { id: string; name?: string; status?: string };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [products, setProducts] = useState<Doc[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 8));

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    const claims = u ? (await u.getIdTokenResult()).claims : {};
    setTenantId((claims.tenantId as string) ?? null);
  }), []);

  // Path 1: client SDK straight to Firestore. Governed by firestore.rules.
  useEffect(() => {
    if (!tenantId) return;
    const q = query(collection(db, `tenants/${tenantId}/products`), orderBy("createdAt", "desc"), limit(20));
    return onSnapshot(q, (s) => setProducts(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => note(`firestore: ${e.code}`));
  }, [tenantId]);

  // Path 2: REST through the API gateway to an HTTPS function. Governed by function code.
  async function createProduct() {
    const token = await user!.getIdToken();
    const res = await fetch(`${API_BASE}/v1/catalog/products`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `Widget ${Date.now() % 1000}` }),
    });
    note(`POST /v1/catalog/products → ${res.status}`);
  }

  // Path 3: callable function via the Firebase SDK.
  async function loadSummary() {
    const r = await httpsCallable<void, Record<string, number>>(functions, "catalog-tasks-summary")();
    setSummary(r.data);
  }

  if (!user) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 24 }}>
        <h1>API Mock</h1>
        <p>Run <code>pnpm test:smoke</code> once to seed <code>admin@tenant-a.test</code> / <code>password123</code>.</p>
        <button onClick={() => signInWithEmailAndPassword(auth, "admin@tenant-a.test", "password123").catch((e) => note(e.code))}>
          Sign in as tenant-a admin
        </button>
        <pre>{log.join("\n")}</pre>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Tenant {tenantId}</h1>
      <button onClick={createProduct}>Create product (REST)</button>{" "}
      <button onClick={loadSummary}>Load summary (callable)</button>{" "}
      <button onClick={() => auth.signOut()}>Sign out</button>
      <h2>Products (live from Firestore)</h2>
      <ul>{products.map((p) => <li key={p.id}>{p.name ?? p.id} — {p.status}</li>)}</ul>
      {summary && <pre>{JSON.stringify(summary, null, 2)}</pre>}
      <pre>{log.join("\n")}</pre>
    </main>
  );
}
