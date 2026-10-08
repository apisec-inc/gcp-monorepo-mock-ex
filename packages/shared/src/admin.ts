import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

// The Admin SDK BYPASSES firestore.rules. Every authorization decision a
// function makes has to be enforced in code (see http.ts), not by rules.
export const app = getApps()[0] ?? initializeApp();
export const db = getFirestore(app);
export const adminAuth = getAuth(app);
export { FieldValue };

export const tenantCollection = (tenantId: string, resource: string) =>
  db.collection(`tenants/${tenantId}/${resource}`);
