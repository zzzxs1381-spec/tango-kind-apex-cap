import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyNetwork, decideTransport, type NetworkSnapshot } from "./network-intelligence.ts";

function snapshot(partial: Partial<NetworkSnapshot> = {}): NetworkSnapshot {
  return {
    observedAt: "2026-09-11T15:00:00Z",
    accessType: "mobile",
    control: {
      dns: "pass",
      tcp443: "pass",
      tls: "pass",
      udp443: "pass",
      quic: "pass",
    },
    apps: [
      { id: "whatsapp", dns: "pass", tcp443: "pass", tls: "pass", http: "pass", quic: "unknown" },
      { id: "youtube", dns: "pass", tcp443: "pass", tls: "pass", http: "pass", quic: "pass" },
    ],
    ...partial,
  };
}

describe("classifyNetwork", () => {
  it("marks confirmed transport loss as a shutdown without inventing a DPI cause", () => {
    const result = classifyNetwork(
      snapshot({ indicators: { transportAvailable: "fail", whitelistMode: "not-observed" } }),
    );
    assert.equal(result.kind, "transport_shutdown");
    assert.equal(result.confidence, 0.98);
    assert.match(result.limitations[0], /не доказывает/i);
  });

  it("separates a confirmed allowlist regime from app-specific interference", () => {
    const result = classifyNetwork(
      snapshot({ indicators: { transportAvailable: "pass", whitelistMode: "confirmed" } }),
    );
    assert.equal(result.kind, "whitelist_only");
    assert.equal(result.confidence, 0.98);
  });

  it("treats failed UDP with healthy TCP/TLS as UDP degradation, not proof of censorship", () => {
    const result = classifyNetwork(
      snapshot({
        control: { dns: "pass", tcp443: "pass", tls: "pass", udp443: "fail", quic: "fail" },
      }),
    );
    assert.equal(result.kind, "udp_degraded_or_blocked");
    assert.ok(result.limitations.some((line) => /NAT|QoS|перегрузки|фильтрации/.test(line)));
  });

  it("marks app failure behind healthy controls as suspected rather than confirmed interference", () => {
    const s = snapshot();
    s.apps[0] = { ...s.apps[0], http: "fail" };
    const result = classifyNetwork(s);
    assert.equal(result.kind, "application_interference_suspected");
    assert.ok(result.confidence < 0.8);
  });
});

describe("decideTransport", () => {
  it("prefers QUIC transports only when fresh UDP/443 and QUIC probes pass", () => {
    const result = decideTransport(snapshot());
    assert.equal(result.primary, "hysteria2-native");
    assert.deepEqual(result.fallbacks, ["tuic-v5", "hysteria2-obfuscated", "vless-reality"]);
    assert.equal(result.action, "connect");
  });

  it("moves to TCP/TLS when UDP/443 fails", () => {
    const result = decideTransport(
      snapshot({
        control: { dns: "pass", tcp443: "pass", tls: "pass", udp443: "fail", quic: "fail" },
      }),
    );
    assert.equal(result.primary, "vless-reality");
    assert.equal(result.action, "connect");
  });

  it("refuses to pretend a tunnel can fix a confirmed transport shutdown", () => {
    const result = decideTransport(
      snapshot({ indicators: { transportAvailable: "fail", whitelistMode: "not-observed" } }),
    );
    assert.equal(result.primary, null);
    assert.equal(result.action, "switch_uplink");
  });
});
