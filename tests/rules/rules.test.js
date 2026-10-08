// Run via `pnpm test:rules` (starts the Firestore emulator for you).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let env;
const as = (uid, claims) => env.authenticatedContext(uid, claims).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const A_ADMIN = ["a-admin", { tenantId: "tenant-a", role: "admin" }];
const A_VIEWER = ["a-viewer", { tenantId: "tenant-a", role: "viewer" }];
const B_ADMIN = ["b-admin", { tenantId: "tenant-b", role: "admin" }];

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-apimock",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "tenants/tenant-a/products/p1"), { tenantId: "tenant-a", name: "Widget" });
    await setDoc(doc(db, "tenants/tenant-a/orders/o1"), { tenantId: "tenant-a", total: 10 });
    await setDoc(doc(db, "tenants/tenant-a/payments/pay1"), { tenantId: "tenant-a", amount: 10 });
    await setDoc(doc(db, "tenants/tenant-a/warehouses/w1"), { tenantId: "tenant-a", name: "Main" });
    await setDoc(doc(db, "tenants/tenant-a/wishlists/wl1"), { tenantId: "tenant-a", ownerUid: "a-viewer" });
  });
});

describe("public-read (catalog/products)", () => {
  it("anyone can read", () => assertSucceeds(getDoc(doc(anon(), "tenants/tenant-a/products/p1"))));
  it("nobody writes from the client", () => assertFails(setDoc(doc(as(...A_ADMIN), "tenants/tenant-a/products/p2"), { tenantId: "tenant-a" })));
});

describe("member-read (orders/orders)", () => {
  it("member reads", () => assertSucceeds(getDoc(doc(as(...A_VIEWER), "tenants/tenant-a/orders/o1"))));
  it("other tenant denied", () => assertFails(getDoc(doc(as(...B_ADMIN), "tenants/tenant-a/orders/o1"))));
  it("signed out denied", () => assertFails(getDoc(doc(anon(), "tenants/tenant-a/orders/o1"))));
});

describe("server-only (billing/payments)", () => {
  // Fails when generated with --with-findings (F-004) — that's the point.
  it("even admins can't read from the client", () => assertFails(getDoc(doc(as(...A_ADMIN), "tenants/tenant-a/payments/pay1"))));
});

describe("member-write (inventory/warehouses)", () => {
  it("viewer cannot write", () => assertFails(updateDoc(doc(as(...A_VIEWER), "tenants/tenant-a/warehouses/w1"), { name: "x" })));
  it("admin can write", () => assertSucceeds(updateDoc(doc(as(...A_ADMIN), "tenants/tenant-a/warehouses/w1"), { name: "x" })));
  it("cannot move doc to another tenant", () =>
    assertFails(updateDoc(doc(as(...A_ADMIN), "tenants/tenant-a/warehouses/w1"), { tenantId: "tenant-b" })));
});

describe("owner (catalog/wishlists)", () => {
  it("owner reads", () => assertSucceeds(getDoc(doc(as(...A_VIEWER), "tenants/tenant-a/wishlists/wl1"))));
  it("same-tenant non-owner denied", () => assertFails(getDoc(doc(as(...A_ADMIN), "tenants/tenant-a/wishlists/wl1"))));
});

describe("users/{uid}", () => {
  it("cannot self-promote role", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/a-viewer"), { role: "viewer" }));
    await assertFails(updateDoc(doc(as(...A_VIEWER), "users/a-viewer"), { role: "admin" }));
  });
});
