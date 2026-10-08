import type { Request } from "firebase-functions/v2/https";
import { adminAuth } from "./admin";

export type Role = "viewer" | "editor" | "admin";
const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };
export const roleAtLeast = (have: Role, need: Role) => RANK[have] >= RANK[need];

export interface Caller {
  uid: string;
  tenantId: string;
  role: Role;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

/**
 * Two ways a caller identity reaches a function:
 *  1. Behind API Gateway: the gateway already validated the Firebase ID token
 *     and forwards its claims base64-encoded in X-Apigateway-Api-Userinfo.
 *  2. Direct / emulator: we verify the Bearer ID token ourselves.
 */
export async function getCaller(req: Request): Promise<Caller | null> {
  const gw = req.header("x-apigateway-api-userinfo");
  if (gw) {
    const claims = JSON.parse(Buffer.from(gw, "base64url").toString("utf8"));
    return toCaller(claims);
  }
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    return toCaller(await adminAuth.verifyIdToken(token));
  } catch {
    throw new HttpError(401, "invalid_token");
  }
}

function toCaller(claims: Record<string, unknown>): Caller {
  const uid = String(claims.user_id ?? claims.uid ?? claims.sub ?? "");
  const tenantId = String(claims.tenantId ?? "");
  const role = (claims.role as Role) ?? "viewer";
  if (!uid || !tenantId) throw new HttpError(403, "missing_tenant_claim");
  return { uid, tenantId, role };
}
