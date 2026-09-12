import type { BlockType, Probe } from "./session";

export const APPS = [
  { id: "telegram", label: "Telegram", host: "telegram.org", href: "https://web.telegram.org/", url: "https://telegram.org/favicon.ico" },
  { id: "whatsapp", label: "WhatsApp", host: "web.whatsapp.com", href: "https://web.whatsapp.com/", url: "https://web.whatsapp.com/favicon.ico" },
  { id: "tiktok", label: "TikTok", host: "tiktok.com", href: "https://www.tiktok.com/", url: "https://www.tiktok.com/favicon.ico" },
  { id: "instagram", label: "Instagram", host: "instagram.com", href: "https://www.instagram.com/", url: "https://www.instagram.com/favicon.ico" },
  { id: "youtube", label: "YouTube", host: "youtube.com", href: "https://www.youtube.com/", url: "https://www.youtube.com/favicon.ico" },
] as const;

type DohState = "pass" | "fail" | "unknown";

function load(url: string, ms: number): Promise<{ ok: boolean; ms: number }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const img = new Image();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      resolve({ ok, ms: Math.round(performance.now() - t0) });
    };
    const t = window.setTimeout(() => done(false), ms);
    img.onload = () => {
      window.clearTimeout(t);
      done(true);
    };
    img.onerror = () => {
      window.clearTimeout(t);
      done(false);
    };
    img.src = `${url}?xf_probe=${Date.now()}`;
  });
}

async function doh(host: string): Promise<DohState> {
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 1600);
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      headers: { Accept: "application/dns-json" },
      signal: ctrl.signal,
    });
    window.clearTimeout(t);
    if (!res.ok) return "unknown";
    const body = (await res.json()) as { Answer?: { type?: number }[] };
    return body.Answer?.some((a) => a.type === 1) ? "pass" : "fail";
  } catch {
    return "unknown";
  }
}

function browserClassification(ok: boolean): BlockType {
  // A browser Image/fetch probe cannot observe raw DNS, TCP, TLS ClientHello,
  // injected RSTs or QUIC handshakes. A failed favicon therefore proves only
  // that this browser endpoint probe did not complete.
  return ok ? "none" : "http";
}

function note(ok: boolean, dns: DohState) {
  if (ok) return "browser endpoint доступен";
  if (dns === "pass") return "endpoint недоступен · DoH отвечает · причина не доказана";
  if (dns === "fail") return "endpoint недоступен · DoH A-запись не получена · причина не доказана";
  return "endpoint недоступен · причина не доказана";
}

export async function measureAll(): Promise<Probe[]> {
  return Promise.all(
    APPS.map(async (a) => {
      const [hit, dns] = await Promise.all([load(a.url, 1400), doh(a.host)]);
      return {
        id: a.id,
        label: a.label,
        host: a.host,
        href: a.href,
        ms: hit.ms,
        block: browserClassification(hit.ok),
        note: note(hit.ok, dns),
      };
    }),
  );
}

export function pickTransport(_rows: Probe[]) {
  // Browser-only evidence is deliberately insufficient for transport choice.
  // Real selection is performed by network-intelligence.ts from native/server
  // DNS/TCP/TLS/UDP/QUIC measurements.
  return {
    transport: "diagnostic-only",
    vector: "browser-evidence-insufficient",
    sni: "",
  };
}
