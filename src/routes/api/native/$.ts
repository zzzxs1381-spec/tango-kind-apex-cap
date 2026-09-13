import { createFileRoute } from "@tanstack/react-router";

async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!/^\/api\/native\/(config|stage|edge|verify)$/.test(url.pathname)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const configured = process.env.XF_NATIVE_API_URL;
  if (!configured) return Response.json({ error: "native_not_configured", webConnected: false }, { status: 503 });
  const base = new URL(configured);
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username || base.password) {
    return Response.json({ error: "invalid_native_api_origin" }, { status: 503 });
  }
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "origin"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const body = request.method === "POST" ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > 8192) return Response.json({ error: "body_too_large" }, { status: 413 });
    const result = await fetch(new URL(url.pathname + url.search, base), {
      method: request.method, headers, body, redirect: "error", signal: AbortSignal.timeout(15000),
    });
    return new Response(await result.arrayBuffer(), { status: result.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "native_unavailable", webConnected: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
export const Route = createFileRoute("/api/native/$")({ server: { handlers: {
  GET: ({ request }) => proxy(request), POST: ({ request }) => proxy(request),
} } });
