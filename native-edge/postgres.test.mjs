import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PostgresStore,cleanStage} from './store.mjs';
test('Postgres accepts ordered native evidence, rejects stale/replayed and unproven CONNECTED',{skip:!process.env.DATABASE_URL},async()=>{
  const {Pool}=await import('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL});const store=new PostgresStore(pool),sid=randomUUID();
  try {
    await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
    await store.addSession(sid,'ci-subject',Math.floor(Date.now()/1000)+60);
    const event=(stage,sequence,generation=1)=>cleanStage({stage,sequence,generation,evidence:{tunInterfaceUp:true,dnsOk:true,internetOk:true,engineHealthy:true}});
    await assert.rejects(store.append(sid,event('CONNECTED',1)),/missing_evidence/);
    assert.equal((await store.append(sid,event('TUNNEL_UP',1))).accepted,true);
    const verified=await store.append(sid,event('CONNECTED',2));assert.equal(verified.accepted,true);assert.equal(verified.webConnected,false);
    assert.equal((await store.append(sid,event('CONNECTED',2))).accepted,false);
    await assert.rejects(store.append(sid,event('CONNECTED',3,2)),/missing_evidence/);
    assert.equal((await store.append(sid,event('TUNNEL_UP',3,2))).accepted,true);
    assert.equal((await store.append(sid,event('CONNECTED',4,1))).accepted,false);
    const rows=await pool.query('SELECT count(*)::int AS n FROM xf_native_stages WHERE session_id=$1',[sid]);assert.equal(rows.rows[0].n,3);
  } finally {await pool.query('DELETE FROM xf_native_sessions WHERE id=$1',[sid]);await pool.end();}
});
