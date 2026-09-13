export const STAGES = new Set('IDLE PREPARING DIAGNOSING SELECTING_ROUTE CONNECTING HANDSHAKING TUNNEL_UP VERIFYING CONNECTED DEGRADED FAILING_OVER RECONNECTING OFFLINE ERROR'.split(' '));
export function cleanStage(body) {
  if (!body || !STAGES.has(body.stage) || !Number.isSafeInteger(body.generation) || body.generation < 1 || !Number.isSafeInteger(body.sequence) || body.sequence < 1) throw Error('invalid_stage');
  const evidence = Object.fromEntries(['tunInterfaceUp','dnsOk','internetOk','engineHealthy'].map(k=>[k,body.evidence?.[k]===true]));
  return {stage:body.stage,generation:body.generation,sequence:body.sequence,evidence};
}
export class PostgresStore {
  constructor(pool) {this.pool=pool;}
  async session(sid) {
    const r=await this.pool.query('SELECT id, expires_at FROM xf_native_sessions WHERE id=$1 AND expires_at>now()',[sid]);
    return r.rows[0];
  }
  async addSession(sid,subject,exp) {
    await this.pool.query('INSERT INTO xf_native_sessions(id,subject,expires_at) VALUES ($1,$2,to_timestamp($3))',[sid,subject,exp]);
  }
  async append(sid,event) {
    const db=await this.pool.connect();
    try {
      await db.query('BEGIN');
      const result=await db.query('SELECT * FROM xf_native_sessions WHERE id=$1 AND expires_at>now() FOR UPDATE',[sid]);
      const current=result.rows[0];
      if(current){current.generation=Number(current.generation);current.sequence=Number(current.sequence);}
      if(!current) throw Error('session_expired');
      if(event.generation<current.generation || event.generation===current.generation && event.sequence<=current.sequence) {
        await db.query('ROLLBACK');return {accepted:false,reason:'stale_or_duplicate',webConnected:false};
      }
      const tunSeen=event.generation===current.generation && current.tun_seen || event.stage==='TUNNEL_UP' && event.evidence.tunInterfaceUp;
      if(event.stage==='CONNECTED' && (!tunSeen || !Object.values(event.evidence).every(Boolean))) throw Error('missing_evidence');
      await db.query('UPDATE xf_native_sessions SET generation=$2,sequence=$3,tun_seen=$4 WHERE id=$1',[sid,event.generation,event.sequence,tunSeen]);
      await db.query('INSERT INTO xf_native_stages(session_id,generation,sequence,stage,evidence) VALUES($1,$2,$3,$4,$5)',[sid,event.generation,event.sequence,event.stage,JSON.stringify(event.evidence)]);
      await db.query('COMMIT');return {accepted:true,source:'native-reported',webConnected:false};
    } catch(e) {await db.query('ROLLBACK');throw e;} finally {db.release();}
  }
}
