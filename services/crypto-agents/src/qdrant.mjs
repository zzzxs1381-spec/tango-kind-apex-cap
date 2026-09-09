import crypto from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { cfg } from "./config.mjs";

const client = new QdrantClient({ url: cfg.qdrantUrl });
let ready = false;

async function ensureCollection() {
  if (ready) return;
  const all = await client.getCollections();
  if (!all.collections.some(c => c.name === cfg.qdrantCollection)) {
    await client.createCollection(cfg.qdrantCollection, { vectors: { size: 8, distance: "Cosine" } });
    for (const field of ["asset", "category", "regime", "horizon", "signalClass", "agentRole"]) {
      await client.createPayloadIndex(cfg.qdrantCollection, { field_name: field, field_schema: "keyword" });
    }
  }
  ready = true;
}

function vectorFromId(id) {
  const b = crypto.createHash("sha256").update(id).digest();
  return Array.from({ length: 8 }, (_, i) => (b.readUInt32BE(i * 4) / 0xffffffff) * 2 - 1);
}

export async function remember(record) {
  await ensureCollection();
  const id = record.id || crypto.randomUUID();
  await client.upsert(cfg.qdrantCollection, {
    wait: false,
    points: [{ id, vector: vectorFromId(id), payload: { ...record, id } }],
  });
  return id;
}
