import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { db, FieldValue } from "./admin";

// Triggers write to _audit / _stats, which are NOT resources, so they never
// re-trigger themselves. (Writing into a triggered collection is the classic
// infinite-loop bug in Firestore-trigger-heavy codebases.)
export function onCreatedCounter(resource: string) {
  return onDocumentCreated(`tenants/{tenantId}/${resource}/{docId}`, async (event) => {
    const { tenantId, docId } = event.params;
    const batch = db.batch();
    batch.set(db.doc(`tenants/${tenantId}/_stats/${resource}`), { count: FieldValue.increment(1) }, { merge: true });
    batch.set(db.collection(`tenants/${tenantId}/_audit`).doc(), {
      resource, docId, action: "created", at: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  });
}

export function onUpdatedAudit(resource: string) {
  return onDocumentUpdated(`tenants/{tenantId}/${resource}/{docId}`, async (event) => {
    const before = event.data?.before.data() ?? {};
    const after = event.data?.after.data() ?? {};
    const changed = Object.keys({ ...before, ...after }).filter(
      (k) => k !== "updatedAt" && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    if (changed.length === 0) return;
    await db.collection(`tenants/${event.params.tenantId}/_audit`).add({
      resource, docId: event.params.docId, action: "updated", changed, at: FieldValue.serverTimestamp(),
    });
  });
}
