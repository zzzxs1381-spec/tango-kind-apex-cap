import tls from 'node:tls';
import http from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Edge, certificate } from './edge.mjs';
import { TYPE, FrameReader, frame, openPayload, streamPayload, issueToken, verifyToken } from './protocol.mjs';
export async function connectPinned({port,sni,pin,token,host='127.0.0.1',alpn='xf-tls1',maxVersion='TLSv1.3'}) {
  const started=performance.now();
  const socket=tls.connect({host,port,servername:sni,minVersion:maxVersion,maxVersion,ALPNProtocols:[alpn],rejectUnauthorized:false});
  socket.on('error',()=>{}); socket.setTimeout(5000,()=>socket.destroy(Error('timeout')));
  try {
    await once(socket,'secureConnect');
    const cert=socket.getPeerCertificate(), actual=createHash('sha256').update(cert.raw).digest();
    const expected=Buffer.from(pin.replace(/^sha256\//,''),'base64');
    if (actual.length!==expected.length || !timingSafeEqual(actual,expected) || Date.parse(cert.valid_to)<Date.now() || Date.parse(cert.valid_from)>Date.now()) throw Error('pin_or_validity_mismatch');
    if(socket.getProtocol()!=='TLSv1.3' || socket.alpnProtocol!=='xf-tls1') throw Error('tls_contract');
    const handshakeMs=performance.now()-started;
    const auth=new Promise((resolve,reject)=>{
      const clean=()=>{socket.off('data',data);socket.off('close',close);socket.off('error',fail);};
      const data=x=>{clean();resolve(x);};const close=()=>{clean();reject(Error('auth_closed'));};const fail=e=>{clean();reject(e);};
      socket.once('data',data);socket.once('close',close);socket.once('error',fail);
    }); socket.write('AUTH '+token+'\n');
    const ok=await auth; if(!ok.equals(Buffer.from('OK\n'))) throw Error('auth_failed');
    return {socket,handshakeMs};
  } catch(e) {socket.destroy();throw e;}
}
export async function selftest(edge) {
  const nonce=randomBytes(24).toString('hex');
  const echo=http.createServer((req,res)=>{
    res.writeHead(req.url==='/'+nonce?200:404,{'Content-Type':'text/plain','Connection':'close'});
    res.end(req.url==='/'+nonce?nonce:'not_found');
  });
  echo.listen(0,'127.0.0.1'); await once(echo,'listening');
  let socket,claims;
  try {
    const echoPort=echo.address().port;
    const token=issueToken(edge.secret,{scope:'edge',sid:'selftest',test:true,exp:Math.floor(Date.now()/1000)+15});
    claims=verifyToken(edge.secret,token,'edge'); edge.selftests.set(claims.jti,{host:'127.0.0.1',port:echoPort});
    const result=await connectPinned({port:edge.port,sni:edge.sni,pin:edge.credentials.pin,token}); socket=result.socket;
    const reader=new FrameReader(); let data=Buffer.alloc(0), opened=false;
    await new Promise((resolve,reject)=>{
      const deadline=setTimeout(()=>reject(Error('echo_timeout')),6000);
      const finish=(fn,v)=>{clearTimeout(deadline);fn(v);};
      socket.on('error',e=>finish(reject,e));
      socket.on('close',()=>{if(!data.toString().includes(nonce)) finish(reject,Error('early_close'));});
      socket.on('data',chunk=>{try{
        for(const {type,payload} of reader.push(chunk)) {
          if(type===TYPE.OPEN_OK && payload.length===4 && payload.readUInt32BE()===1) {
            opened=true;
            socket.write(frame(TYPE.DATA,streamPayload(1,Buffer.from('GET /'+nonce+' HTTP/1.1\r\nHost: echo.local\r\nConnection: close\r\n\r\n'))));
          } else if(type===TYPE.DATA) {
            data=Buffer.concat([data,payload.subarray(4)]);
            if(data.toString().includes(nonce) && data.toString().startsWith('HTTP/1.1 200')) finish(resolve);
          } else if(type===TYPE.OPEN_ERR) finish(reject,Error('echo_open_failed'));
        }
      }catch(e){finish(reject,e);}});
      socket.write(frame(TYPE.OPEN,openPayload(1,'127.0.0.1',echoPort)));
    });
    return {ok:true,scope:'local-selftest',checkedAt:new Date().toISOString(),pin:edge.credentials.pin,
      handshakeMs:Number(result.handshakeMs.toFixed(3)),tls:socket.getProtocol(),alpn:socket.alpnProtocol,sni:edge.lastHandshake.sni,
      auth:true,open:opened,echo:{ok:true},phoneVerified:false,regionalVerified:false};
  } finally {
    socket?.destroy(); if(claims) edge.selftests.delete(claims.jti);
    echo.closeAllConnections(); await new Promise(resolve=>echo.close(resolve));
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const dir=await mkdtemp(tmpdir()+'/xf-tls1-'); let edge;
  try {
    const sni='www.microsoft.com', secret=randomBytes(32).toString('hex');
    edge=await new Edge({credentials:await certificate(dir,sni),secret,sni}).start();
    console.log(JSON.stringify(await selftest(edge),null,2));
  } finally {await edge?.stop(); await rm(dir,{recursive:true,force:true});}
}
