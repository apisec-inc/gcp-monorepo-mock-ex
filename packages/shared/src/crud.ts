import { FieldValue, tenantCollection } from "./admin";
import { HttpError } from "./auth";
import { resourceId, type Handler } from "./http";

const PROTECTED = new Set(["id", "tenantId", "createdAt", "createdBy", "ownerUid", "role"]);

function sanitize(body: unknown, massAssignment: boolean): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_body");
  if (massAssignment) return { ...(body as Record<string, unknown>) };
  return Object.fromEntries(Object.entries(body).filter(([k]) => !PROTECTED.has(k)));
}

export interface CrudOptions {
  owned?: boolean; // collection uses ownerUid (rules "owner" level)
  massAssignment?: boolean; // deliberately unsafe; findings mode only
}

export const crud = {
  list: (resource: string): Handler => async ({ req, tenantId }) => {
    let q = tenantCollection(tenantId, resource).orderBy("createdAt", "desc");
    if (typeof req.query.status === "string") q = q.where("status", "==", req.query.status);
    const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
    const snap = await q.limit(limit).get();
    return { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  },

  get: (resource: string): Handler => async ({ req, tenantId }) => {
    const doc = await tenantCollection(tenantId, resource).doc(resourceId(req)).get();
    if (!doc.exists) throw new HttpError(404, "not_found");
    return { id: doc.id, ...doc.data() };
  },

  create: (resource: string, opts: CrudOptions = {}): Handler => async ({ req, caller, tenantId }) => {
    const data = {
      ...sanitize(req.body, false),
      tenantId,
      createdBy: caller?.uid ?? null,
      ...(opts.owned ? { ownerUid: caller?.uid } : {}),
      createdAt: FieldValue.serverTimestamp(),
      status: (req.body as { status?: string })?.status ?? "active",
    };
    const ref = await tenantCollection(tenantId, resource).add(data);
    return { id: ref.id };
  },

  update: (resource: string, opts: CrudOptions = {}): Handler => async ({ req, tenantId }) => {
    const ref = tenantCollection(tenantId, resource).doc(resourceId(req));
    if (!(await ref.get()).exists) throw new HttpError(404, "not_found");
    await ref.set({ ...sanitize(req.body, !!opts.massAssignment), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { id: ref.id };
  },

  remove: (resource: string): Handler => async ({ req, tenantId }) => {
    await tenantCollection(tenantId, resource).doc(resourceId(req)).delete();
    return { ok: true };
  },
};
