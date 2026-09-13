import tls from 'node:tls';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { X509Certificate, createHash } from 'node:crypto';
import { readFile, mkdir, chmod, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { TYPE, FrameReader, frame, streamPayload, parseOpen, verifyToken } from './protocol.mjs';
const exec = promisify(execFile);
export function isPublicIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a,b,c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 88 && c === 99)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) || (a === 203 && b === 0 && c === 113));
}
export async function certificate(dir, sni) {
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(sni)) throw Error('invalid_sni');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const keyPath = dir + '/edge-key.pem', certPath = dir + '/edge-cert.pem';
  const [hasKey, hasCert] = await Promise.all([stat(keyPath).then(()=>true,()=>false), stat(certPath).then(()=>true,()=>false)]);
  if (hasKey !== hasCert) throw Error('incomplete_certificate_pair');
  if (!hasKey) {
    await exec('openssl', ['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-days','30','-keyout',keyPath,'-out',certPath,'-subj','/CN='+sni,'-addext','subjectAltName=DNS:'+sni], { timeout: 15000 });
  }
  await chmod(keyPath, 0o600);
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
  const x509 = new X509Certificate(cert);
  if (Date.parse(x509.validTo) <= Date.now() || Date.parse(x509.validFrom) > Date.now()) throw Error('certificate_expired');
  return { key, cert, pin: 'sha256/' + createHash('sha256').update(x509.raw).digest('base64') };
}
export class Edge {
  constructor({ credentials, secret, sni, port = 0, maxSessions = 128 }) {
    Object.assign(this, { credentials, secret, sni, port, maxSessions });
    this.sockets = new Set(); this.selftests = new Map(); this.lastHandshake = null;
  }
  async start() {
    const secureContext = tls.createSecureContext({ ...this.credentials, minVersion:'TLSv1.3', maxVersion:'TLSv1.3' });
    this.server = tls.createServer({ ...this.credentials, minVersion:'TLSv1.3', maxVersion:'TLSv1.3', ALPNProtocols:['xf-tls1'], handshakeTimeout:10000, allowHalfOpen:true,
      SNICallback:(name, cb)=>name === this.sni ? cb(null, secureContext) : cb(Error('sni_rejected')) }, socket=>this.accept(socket));
    this.server.on('connection', socket => {
      if (this.sockets.size >= this.maxSessions) { socket.destroy(); return; }
      this.sockets.add(socket); socket.on('close',()=>this.sockets.delete(socket)); socket.on('error',()=>{});
    });
    this.server.on('tlsClientError',()=>{});
    this.server.listen(this.port, '127.0.0.1'); await once(this.server,'listening'); this.port = this.server.address().port;
    return this;
  }
  accept(socket) {
    if (socket.alpnProtocol !== 'xf-tls1' || socket.servername !== this.sni || socket.getProtocol() !== 'TLSv1.3') { socket.destroy(); return; }
    const streams = new Map(), reader = new FrameReader(); let auth = Buffer.alloc(0), claims = null, expires;
    const cleanup = ()=>{ clearTimeout(expires); for (const s of streams.values()) s.socket?.destroy(); streams.clear(); };
    socket.on('close',cleanup); socket.on('error',cleanup); socket.on('end',()=>socket.destroy());
    socket.setTimeout(10000,()=>socket.destroy());
    const send = (type,payload)=>{
      if (socket.destroyed) return false;
      if (socket.writableLength > 1024 * 1024) { socket.destroy(); return false; }
      return socket.write(frame(type,payload));
    };
    socket.on('drain',()=>{for(const s of streams.values()) s.socket?.resume();});
    const open = async payload => {
      const target = parseOpen(payload);
      if (streams.has(target.id) || streams.size >= 64) throw Error('stream_limit');
      const state = { ready:false, socket:null, ended:false }; streams.set(target.id,state);
      try {
        let ip;
        if (claims.test) {
          const permitted = this.selftests.get(claims.jti);
          if (!permitted || permitted.host !== target.host || permitted.port !== target.port) throw Error('target_denied');
          ip = target.host;
        } else {
          const resolved = await lookup(target.host, { family:4, all:true });
          if (!resolved.length || resolved.some(x=>!isPublicIPv4(x.address))) throw Error('target_denied');
          ip = resolved[0].address;
        }
        if (socket.destroyed || streams.get(target.id) !== state) return;
        const upstream = net.createConnection({host:ip,port:target.port,allowHalfOpen:true}); state.socket=upstream;
        upstream.on('error',()=>{ if(!state.ready) send(TYPE.OPEN_ERR,streamPayload(target.id,Buffer.from('open_failed'))); else send(TYPE.CLOSE,streamPayload(target.id)); streams.delete(target.id); });
        upstream.setTimeout(10000,()=>upstream.destroy(Error('upstream_timeout')));
        upstream.once('connect',()=>{state.ready=true; upstream.setTimeout(120000); send(TYPE.OPEN_OK,streamPayload(target.id)); });
        upstream.on('data',chunk=>{
          for(let offset=0;offset<chunk.length;offset+=16384) if(!send(TYPE.DATA,streamPayload(target.id,chunk.subarray(offset,offset+16384)))) upstream.pause();
        });
        upstream.on('end',()=>{send(TYPE.CLOSE,streamPayload(target.id)); if(state.ended) upstream.destroy();});
        upstream.on('close',()=>streams.delete(target.id));
        upstream.on('drain',()=>socket.resume());
      } catch { streams.delete(target.id); send(TYPE.OPEN_ERR,streamPayload(target.id,Buffer.from('open_failed'))); }
    };
    const handle = ({type,payload})=>{
      if(type===TYPE.OPEN) { void open(payload).catch(()=>socket.destroy()); return; }
      if(type===TYPE.PING || type===TYPE.PONG) {
        if(payload.length>32) throw Error('ping_size'); if(type===TYPE.PING) send(TYPE.PONG,payload); return;
      }
      if(payload.length<4) throw Error('stream_id_required');
      const id=payload.readUInt32BE(), state=streams.get(id);
      if(!state?.ready) throw Error('stream_not_open');
      if(type===TYPE.DATA) {
        if(state.ended || payload.length<5 || payload.length>16388) throw Error('invalid_data');
        if(state.socket.writableLength>1024*1024) throw Error('upstream_backpressure');
        if(!state.socket.write(payload.subarray(4))) socket.pause();
      } else if(type===TYPE.CLOSE && payload.length===4) {state.ended=true; state.socket.end();}
      else throw Error('unexpected_frame');
    };
    socket.on('data',chunk=>{
      try {
        if(!claims) {
          auth=Buffer.concat([auth,chunk]); const newline=auth.indexOf(10);
          if(newline<0) {if(auth.length>4096) throw Error('auth_size'); return;}
          if(newline>4096 || !auth.subarray(0,5).equals(Buffer.from('AUTH '))) throw Error('auth_invalid');
          claims=verifyToken(this.secret,auth.subarray(5,newline).toString('ascii'),'edge');
          expires=setTimeout(()=>socket.destroy(),Math.min(2147483647,claims.exp*1000-Date.now())); expires.unref();
          this.lastHandshake={tls:socket.getProtocol(),alpn:socket.alpnProtocol,sni:socket.servername};
          socket.write('OK\n'); socket.setTimeout(45000); chunk=auth.subarray(newline+1); auth=Buffer.alloc(0);
        }
        for(const f of reader.push(chunk)) handle(f);
      } catch {socket.destroy();}
    });
  }
  async stop() {
    for(const s of this.sockets) s.destroy(); this.selftests.clear();
    if(this.server?.listening) await new Promise(resolve=>this.server.close(resolve));
  }
}
