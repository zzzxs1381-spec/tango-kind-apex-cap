import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Edge, certificate, isPublicIPv4 } from './edge.mjs';
import { selftest } from './selftest.mjs';
import { verifyToken, issueToken } from './protocol.mjs';
import { cleanStage, PostgresStore } from './store.mjs';
export function createRuntime({stateDir,sni,secret,edgePort=0}) {
  let starting,checking,last; const runtime={edge:null};
  runtime.getEdge=async()=>{
    if(runtime.edge?.server?.listening) return runtime.edge;
    if(!starting) starting=(async()=>{
      const credentials=await certificate(stateDir,sni);
      runtime.edge=await new Edge({credentials,secret,sni,port:edgePort}).start();return runtime.edge;
    })().finally(()=>{starting=null;});
    return starting;
  };
  runtime.check=async()=>{
    if(last && Date.now()-Date.parse(last.checkedAt)<30000 && runtime.edge?.server?.listening) return last;
    if(!checking) checking=(async()=>{last=await selftest(await runtime.getEdge());return last;})().finally(()=>{checking=null;});
    return checking;
  };
  return runtime;
}
function reply(res,status,body) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));
}
export function createApi({runtime,store,secret,publicHost,publicPort=443,apiOrigin,configured=true}) {
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET' && url.pathname==='/health') return reply(res,200,{ok:true,edgeStarted:!!runtime.edge?.server?.listening,webConnected:false});
      if(req.method==='GET' && url.pathname==='/api/native/verify') {
        const nonce=url.searchParams.get('nonce');
        if(!/^[a-f0-9]{32,64}$/.test(nonce||'')) return reply(res,400,{error:'invalid_nonce'});
        return reply(res,200,{nonce,ok:true});
      }
      if(req.method==='GET' && url.pathname==='/api/native/edge') return reply(res,200,await runtime.check());
      if(!['/api/native/config','/api/native/stage'].includes(url.pathname)) return reply(res,404,{error:'not_found'});
      if(req.headers.origin) return reply(res,403,{error:'native_bearer_required',webConnected:false});
      if(!configured || !store) return reply(res,503,{error:'native_not_configured',webConnected:false});
      let claims;
      try {claims=verifyToken(secret,req.headers.authorization?.replace(/^Bearer /,''),'probe');}
      catch {return reply(res,401,{error:'invalid_or_expired_token'});}
      if(!await store.session(claims.sid)) return reply(res,401,{error:'session_expired'});
      if(req.method==='GET' && url.pathname==='/api/native/config') {
        if(!isPublicIPv4(publicHost) || !Number.isInteger(publicPort) || publicPort<1 || publicPort>65535 || !apiOrigin?.startsWith('https://')) return reply(res,503,{error:'public_ingress_not_configured'});
        const checked=await runtime.check();
        const token=issueToken(secret,{scope:'edge',sid:claims.sid,exp:claims.exp});
        return reply(res,200,{version:1,sessionId:claims.sid,expiresAt:claims.exp,apiOrigin,protocol:'TLS13_SNI',
          endpoint:{host:publicHost,port:publicPort,sni:checked.sni,pin:checked.pin,authToken:token},
          capabilities:{tcp:true,udp:false,ipv6:false,avoidUdp:true},mtu:1280,
          fallbacks:[],evidence:{scope:checked.scope,checkedAt:checked.checkedAt,phoneVerified:false},webConnected:false});
      }
      if(req.method==='POST' && url.pathname==='/api/native/stage') {
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) return reply(res,415,{error:'json_required'});
        let size=0;const chunks=[];
        for await(const chunk of req) {size+=chunk.length;if(size>8192){reply(res,413,{error:'body_too_large'});return;}chunks.push(chunk);}
        let event;try{event=cleanStage(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{return reply(res,400,{error:'invalid_stage'});}
        try {return reply(res,200,await store.append(claims.sid,event));}
        catch(e) {if(e.message==='missing_evidence')return reply(res,409,{error:'missing_evidence',webConnected:false});throw e;}
      }
      return reply(res,405,{error:'method_not_allowed'});
    } catch {reply(res,503,{error:'native_dependency_unavailable',webConnected:false});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=32;server.maxConnections=64;
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const secret=process.env.XF_NATIVE_TOKEN_SECRET || randomBytes(32).toString('hex');
  if(Buffer.byteLength(secret)<32) throw Error('XF_NATIVE_TOKEN_SECRET must contain at least 32 bytes');
  let store,pool;
  if(process.env.DATABASE_URL) {
    const {Pool}=await import('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:5000,statement_timeout:5000});store=new PostgresStore(pool);
  }
  const runtime=createRuntime({stateDir:process.env.XF_NATIVE_STATE_DIR||'.runtime/native-edge',sni:process.env.XF_NATIVE_SNI||'www.microsoft.com',secret,edgePort:Number(process.env.XF_NATIVE_EDGE_PORT||9443)});
  const server=createApi({runtime,store,secret,publicHost:process.env.XF_NATIVE_PUBLIC_IP,publicPort:Number(process.env.XF_NATIVE_PUBLIC_PORT||443),apiOrigin:process.env.XF_NATIVE_API_ORIGIN,configured:!!process.env.XF_NATIVE_TOKEN_SECRET});
  server.listen(Number(process.env.XF_NATIVE_API_PORT||9081),'127.0.0.1',()=>console.log('XFreedom native API listening on loopback; edge starts on demand'));
  async function shutdown(){server.closeAllConnections();await new Promise(r=>server.close(r));await runtime.edge?.stop();await pool?.end();}
  process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
}
