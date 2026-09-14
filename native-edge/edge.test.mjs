import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Edge, certificate, isPublicIPv4 } from './edge.mjs';
import { selftest, connectPinned } from './selftest.mjs';
import { TYPE, FrameReader, frame, openPayload, streamPayload, issueToken, verifyToken } from './protocol.mjs';
import { createApi, createRuntime } from './api.mjs';
import { cleanStage } from './store.mjs';
const dir=await mkdtemp(tmpdir()+'/xf-edge-tests-'),sni='www.microsoft.com',secret=randomBytes(32).toString('hex');
const credentials=await certificate(dir,sni);
const edge=await new Edge({credentials,secret,sni}).start();
const token=()=>issueToken(secret,{scope:'edge',sid:'test-session',exp:Math.floor(Date.now()/1000)+60});
const connect=(extra={})=>connectPinned({port:edge.port,sni,pin:credentials.pin,token:token(),...extra});
test.after(async()=>{await edge.stop();await rm(dir,{recursive:true,force:true});});
test('TLS1.3 SNI ALPN pin AUTH OPEN echo, repeated on the same edge',async()=>{
  for(let i=0;i<2;i++) {const result=await selftest(edge);assert.equal(result.echo.ok,true);assert.equal(result.tls,'TLSv1.3');assert.equal(result.sni,sni);assert.equal(result.alpn,'xf-tls1');assert.ok(result.handshakeMs>0);}
  assert.equal(edge.server.listening,true);assert.equal(edge.selftests.size,0);
});
test('wrong pin, wrong token and expired auth are rejected',async()=>{
  await assert.rejects(connect({pin:'sha256/'+Buffer.alloc(32).toString('base64')}),/pin/);
  await assert.rejects(connect({token:'forged.token'}));
  await assert.rejects(connect({token:issueToken(secret,{scope:'edge',sid:'expired',exp:1})}));
});
test('TLS1.2, wrong SNI and missing ALPN fail closed',async()=>{
  await assert.rejects(connect({maxVersion:'TLSv1.2'}));
  await assert.rejects(connect({sni:'www.apple.com'}));
  await assert.rejects(connect({alpn:'h2'}));
});
test('fragmented and coalesced frames; invalid lengths/types',()=>{
  const reader=new FrameReader(), first=frame(TYPE.PING,Buffer.from('nonce')),second=frame(TYPE.PONG,Buffer.from('nonce'));
  const bytes=Buffer.concat([first,second]);let found=[];
  for(const byte of bytes)found.push(...reader.push(Buffer.from([byte])));
  assert.equal(found.length,2);assert.equal(found[0].payload.toString(),'nonce');
  for(const n of [0,65537,0xffffffff]){const head=Buffer.alloc(4);head.writeUInt32BE(n);assert.throws(()=>new FrameReader().push(head));}
  assert.throws(()=>new FrameReader().push(Buffer.from([0,0,0,1,99])));
});
test('expired and wrong-scope bearer rejected; filtered event contains no payload fields',()=>{
  const p=issueToken(secret,{scope:'probe',sid:'one',exp:Math.floor(Date.now()/1000)+60});
  assert.throws(()=>verifyToken(secret,p,'edge'));
  assert.throws(()=>verifyToken(secret,p,'probe',Date.now()+120000));
  const event=cleanStage({stage:'CONNECTED',generation:1,sequence:1,evidence:{dnsOk:'true',payload:'secret'},host:'private',token:'sensitive'});
  assert.equal(event.evidence.dnsOk,false);assert.equal(JSON.stringify(event).includes('secret'),false);assert.equal('host' in event,false);
});
test('public-address policy rejects private, metadata, special and all IPv6 targets',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.0.1','203.0.113.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(isPublicIPv4(ip),false,ip);
  assert.equal(isPublicIPv4('1.1.1.1'),true);
});
test('ordinary token cannot OPEN loopback, and malformed authenticated frame closes only its session',async()=>{
  let {socket}=await connect();
  const data=once(socket,'data');socket.write(frame(TYPE.OPEN,openPayload(1,'127.0.0.1',80)));
  const [chunk]=await data;assert.equal(new FrameReader().push(chunk)[0].type,TYPE.OPEN_ERR);socket.destroy();
  ({socket}=await connect());const closed=once(socket,'close');socket.write(Buffer.from([0xff,0xff,0xff,0xff]));await closed;
  assert.equal((await selftest(edge)).ok,true);
});
test('OPEN duplicate id closes session; valid half-close preserves response',async()=>{
  const echo=net.createServer({allowHalfOpen:true},s=>{let bytes=Buffer.alloc(0);s.on('data',x=>{bytes=Buffer.concat([bytes,x])});s.on('end',()=>s.end(bytes));});
  echo.listen(0,'127.0.0.1');await once(echo,'listening');
  const auth=issueToken(secret,{scope:'edge',sid:'halfclose',test:true,exp:Math.floor(Date.now()/1000)+30});
  const claims=verifyToken(secret,auth,'edge');edge.selftests.set(claims.jti,{host:'127.0.0.1',port:echo.address().port});
  let socket;
  try {
    ({socket}=await connect({token:auth}));const reader=new FrameReader();let received=Buffer.alloc(0);
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('halfclose_timeout')),5000);
      socket.on('data',chunk=>{for(const f of reader.push(chunk)){
        if(f.type===TYPE.OPEN_OK){socket.write(frame(TYPE.DATA,streamPayload(1,Buffer.from('half-close-ok'))));socket.write(frame(TYPE.CLOSE,streamPayload(1)));}
        if(f.type===TYPE.DATA)received=Buffer.concat([received,f.payload.subarray(4)]);
        if(f.type===TYPE.CLOSE){clearTimeout(timeout);resolve();}
      }});socket.write(frame(TYPE.OPEN,openPayload(1,'127.0.0.1',echo.address().port)));
    });
    assert.equal(received.toString(),'half-close-ok');socket.destroy();
    ({socket}=await connect({token:auth}));const closed=once(socket,'close');
    const open=frame(TYPE.OPEN,openPayload(1,'127.0.0.1',echo.address().port));socket.write(Buffer.concat([open,open]));await closed;
  } finally {socket?.destroy();edge.selftests.delete(claims.jti);await new Promise(r=>echo.close(r));}
});
test('lazy API selftest is single-flight, does not imply VPN and stays alive without DB',async()=>{
  const runtime=createRuntime({stateDir:dir+'/api',sni,secret});
  const server=createApi({runtime,secret,configured:false});server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  try {
    assert.equal((await (await fetch(origin+'/health')).json()).edgeStarted,false);
    const [a,b]=await Promise.all([runtime.check(),runtime.check()]);assert.deepEqual(a,b);
    const result=await (await fetch(origin+'/api/native/edge')).json();assert.equal(result.phoneVerified,false);assert.equal(result.echo.ok,true);
    assert.equal((await fetch(origin+'/api/native/config')).status,503);
    const verification=await (await fetch(origin+'/api/native/verify?nonce='+ 'a'.repeat(32))).json();assert.equal(verification.ok,true);
    assert.equal((await fetch(origin+'/api/native/verify?nonce=bad')).status,400);
    assert.equal((await (await fetch(origin+'/health')).json()).webConnected,false);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));await runtime.edge?.stop();}
});
