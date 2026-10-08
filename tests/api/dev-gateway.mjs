// Local stand-in for API Gateway: serves the paths in openapi/openapi.json on
// :8787 and forwards each operation to its function in the emulator, appending
// path params as query params exactly like x-google-backend CONSTANT_ADDRESS.
// Difference from the real gateway: it does NOT validate JWTs — the function does.
import http from "node:http";
import { readFileSync } from "node:fs";

const { project, region, functions } = JSON.parse(readFileSync(new URL("../../manifest/functions.json", import.meta.url)));
const FN_HOST = process.env.FUNCTIONS_EMULATOR ?? "http://127.0.0.1:5001";
const PORT = Number(process.env.PORT ?? 8787);

const routes = functions.filter((f) => f.type === "https").map((f) => ({
  ...f,
  re: new RegExp("^" + f.path.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)") + "$"),
}));

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type,x-tenant-id", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();

  const pathMatches = routes.filter((r) => r.re.test(url.pathname));
  const route = pathMatches.find((r) => r.method === req.method);
  if (!route) {
    res.writeHead(pathMatches.length ? 405 : 404, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ error: pathMatches.length ? "method_not_allowed" : "no_route" }));
  }
  const target = new URL(`${FN_HOST}/${project}/${region}/${route.functionId}`);
  url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
  for (const [k, v] of Object.entries(route.re.exec(url.pathname).groups ?? {})) target.searchParams.set(k, v);

  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: Object.fromEntries(["authorization", "content-type", "x-tenant-id"].filter((h) => req.headers[h]).map((h) => [h, req.headers[h]])),
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json", "x-function-id": route.functionId, ...cors });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "upstream_unreachable", detail: String(e) }));
  }
}).listen(PORT, () => console.log(`dev gateway on http://localhost:${PORT} → ${routes.length} operations`));
