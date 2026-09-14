import { randomUUID } from 'node:crypto';
import { issueToken } from './protocol.mjs';
import { PostgresStore } from './store.mjs';
// Operator enrollment of an already verified subject. No public anonymous issuer.
const subject=process.argv[2],secret=process.env.XF_NATIVE_TOKEN_SECRET;
if(!subject || !secret || !process.env.DATABASE_URL || !process.env.XF_NATIVE_API_ORIGIN?.startsWith('https://')) throw Error('verified subject, token secret, database and HTTPS origin required');
const {Pool}=await import('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
try {
  const sid=randomUUID(),exp=Math.floor(Date.now()/1000)+86400;
  await new PostgresStore(pool).addSession(sid,subject,exp);
  const token=issueToken(secret,{scope:'probe',sid,exp});
  process.stdout.write(JSON.stringify({apiOrigin:process.env.XF_NATIVE_API_ORIGIN,probeToken:token})+'\n');
} finally {await pool.end();}
