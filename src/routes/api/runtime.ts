import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runtime")({
  server: {
    handlers: {
      GET: async () => {
        const path = process.env.XF_RUNTIME_STATUS;
        if (!path) return Response.json({ configured: false });
        try {
          const { readFile } = await import("node:fs/promises");
          const data = JSON.parse(await readFile(path, "utf8"));
          const fresh = typeof data.checked_at === "number" && Date.now() / 1000 - data.checked_at < 180;
          // Return only status booleans, never configuration files or environment values.
          return Response.json({
            configured: true,
            fresh,
            checkedAt: typeof data.checked_at === "number" ? data.checked_at : null,
            checks: Object.fromEntries(["app", "postgres", "qdrant"].map((name) => [name, fresh && data.checks?.[name] === true])),
            xray: fresh && data.services?.["xfreedom-xray"] === true,
            hysteria: fresh && data.services?.["xfreedom-hysteria"] === true,
            watchdog: fresh && data.watchdog === true,
            regionalTestRequired: true,
          }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json({ configured: true, fresh: false }, { headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
