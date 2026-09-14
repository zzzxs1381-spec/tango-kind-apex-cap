import { connect, StringCodec } from "@nats-io/transport-node";
import { jetstream, jetstreamManager, AckPolicy } from "@nats-io/jetstream";

const sc = StringCodec();
let nc, js, jsm;

export async function initBus() {
  nc = await connect({ servers: process.env.NATS_URL || "nats://nats:4222", name: process.env.AGENT_ROLE || "agent" });
  js = jetstream(nc);
  jsm = await jetstreamManager(nc);
  try {
    await jsm.streams.info("CRYPTO");
  } catch {
    await jsm.streams.add({
      name: "CRYPTO",
      subjects: ["raw.>", "features.>", "proposal.>", "trade.>", "memory.>", "system.>"],
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000,
      duplicate_window: 2 * 60 * 1_000_000_000,
    });
  }
  return { nc, js, jsm };
}

export async function publish(subject, payload, msgID) {
  if (!js) await initBus();
  return js.publish(subject, sc.encode(JSON.stringify(payload)), msgID ? { msgID } : undefined);
}

export async function consume(filterSubject, durableName, handler) {
  if (!js) await initBus();
  try {
    await jsm.consumers.info("CRYPTO", durableName);
  } catch {
    await jsm.consumers.add("CRYPTO", {
      durable_name: durableName,
      name: durableName,
      ack_policy: AckPolicy.Explicit,
      filter_subject: filterSubject,
      ack_wait: 30_000_000_000,
      max_deliver: 5,
    });
  }
  const c = await js.consumers.get("CRYPTO", durableName);
  const messages = await c.consume({ max_messages: 256 });
  for await (const m of messages) {
    try {
      await handler(JSON.parse(sc.decode(m.data)), m.subject);
      m.ack();
    } catch (err) {
      console.error(JSON.stringify({ level: "error", durableName, subject: m.subject, error: String(err?.stack || err) }));
      m.nak();
    }
  }
}
