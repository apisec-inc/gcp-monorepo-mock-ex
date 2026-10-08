import { onRequest, type HttpsOptions, type Request } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import type { Response } from "express";
import { getCaller, HttpError, roleAtLeast, type Caller, type Role } from "./auth";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface EndpointSpec {
  method: Method;
  /** "public" = no token required. "member" = signed-in tenant member. */
  auth: "public" | "member";
  minRole?: Role;
  /** When false the handler trusts ?tenantId= instead of the token (unsafe). */
  tenantCheck?: boolean;
}

export interface Ctx {
  req: Request;
  res: Response;
  caller: Caller | null;
  tenantId: string;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;

export function httpEndpoint(spec: EndpointSpec, handler: Handler, opts: HttpsOptions = {}) {
  return onRequest({ cors: true, ...opts }, async (req, res) => {
    try {
      if (req.method !== spec.method) throw new HttpError(405, "method_not_allowed");

      const caller = await getCaller(req);
      if (spec.auth === "member" && !caller) throw new HttpError(401, "unauthenticated");

      const requested = String(req.query.tenantId ?? req.header("x-tenant-id") ?? "");
      let tenantId: string;
      if (spec.auth === "public" || spec.tenantCheck === false) {
        tenantId = requested || caller?.tenantId || "";
      } else {
        tenantId = caller!.tenantId;
        if (requested && requested !== tenantId) throw new HttpError(403, "tenant_mismatch");
      }
      if (!tenantId) throw new HttpError(400, "tenant_required");

      if (spec.minRole && caller && !roleAtLeast(caller.role, spec.minRole)) {
        throw new HttpError(403, "insufficient_role");
      }

      const result = await handler({ req, res, caller, tenantId });
      if (!res.headersSent) {
        res.status(spec.method === "POST" ? 201 : 200).json(result ?? { ok: true });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.code });
        return;
      }
      logger.error("unhandled", err);
      res.status(500).json({ error: "internal" });
    }
  });
}

/** Behind API Gateway path params arrive as query params (CONSTANT_ADDRESS). */
export function resourceId(req: Request): string {
  const id = req.query.id ?? req.path.split("/").filter(Boolean).pop();
  if (!id || typeof id !== "string") throw new HttpError(400, "id_required");
  return id;
}
