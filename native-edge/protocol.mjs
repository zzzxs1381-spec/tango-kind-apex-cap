import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
export const TYPE = Object.freeze({ OPEN: 1, OPEN_OK: 2, OPEN_ERR: 3, DATA: 4, CLOSE: 5, PING: 6, PONG: 7 });
export const MAX_FRAME = 65536;
export function frame(type, payload = Buffer.alloc(0)) {
  if (!Number.isInteger(type) || type < 1 || type > 7 || payload.length + 1 > MAX_FRAME) throw Error('invalid_frame');
  const out = Buffer.allocUnsafe(5 + payload.length);
  out.writeUInt32BE(payload.length + 1); out[4] = type; payload.copy(out, 5); return out;
}
export function streamPayload(id, data = Buffer.alloc(0)) {
  if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff) throw Error('invalid_stream');
  const out = Buffer.allocUnsafe(4 + data.length); out.writeUInt32BE(id); data.copy(out, 4); return out;
}
export function openPayload(id, host, port) {
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.:-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid_target');
  const name = Buffer.from(host, 'ascii'); const out = Buffer.alloc(8 + name.length);
  out.writeUInt32BE(id); out.writeUInt16BE(name.length, 4); name.copy(out, 6); out.writeUInt16BE(port, 6 + name.length); return out;
}
export function parseOpen(p) {
  if (p.length < 9) throw Error('invalid_open');
  const id = p.readUInt32BE(0), size = p.readUInt16BE(4);
  if (!id || size > 253 || p.length !== 8 + size) throw Error('invalid_open');
  const host = p.subarray(6, 6 + size).toString('ascii'), port = p.readUInt16BE(6 + size);
  if (!/^[a-zA-Z0-9.:-]{1,253}$/.test(host) || !port || [...p.subarray(6, 6 + size)].some(x => x > 127)) throw Error('invalid_target');
  return { id, host, port };
}
export class FrameReader {
  buffer = Buffer.alloc(0);
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]); const frames = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE();
      if (size < 1 || size > MAX_FRAME) throw Error('invalid_length');
      if (this.buffer.length < size + 4) break;
      const type = this.buffer[4];
      if (type < 1 || type > 7) throw Error('invalid_type');
      frames.push({ type, payload: Buffer.from(this.buffer.subarray(5, size + 4)) });
      this.buffer = this.buffer.subarray(size + 4);
    }
    if (this.buffer.length > MAX_FRAME + 4) throw Error('buffer_limit');
    return frames;
  }
}
export function issueToken(secret, claims, now = Date.now()) {
  if (Buffer.byteLength(secret) < 32) throw Error('weak_token_secret');
  const body = Buffer.from(JSON.stringify({ ...claims, iat: Math.floor(now / 1000), jti: randomBytes(12).toString('hex') })).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}
export function verifyToken(secret, token, scope, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4000) throw Error('invalid_token');
  const parts = token.split('.'); if (parts.length !== 2) throw Error('invalid_token');
  const signature = Buffer.from(parts[1], 'base64url'), expected = createHmac('sha256', secret).update(parts[0]).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw Error('invalid_token');
  const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (claims.scope !== scope || !Number.isInteger(claims.exp) || claims.exp <= now / 1000 || !claims.sid || claims.iat > now / 1000 + 30) throw Error('expired_or_wrong_scope');
  return claims;
}
