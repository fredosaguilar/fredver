import {pool} from './db.js';
import {syncInbox} from './sync.js';
import {startWatch} from './gmail.js';
// Renew the Gmail push-notification watch, then sync. A failed renewal (e.g. the Pub/Sub topic is not yet
// allowed to receive Gmail notifications) must never stop the sync itself.
if(process.env.WATCH_TOPIC){
  try{const w=await startWatch(process.env.WATCH_TOPIC);console.log(JSON.stringify({event:'watch.renewed',expiration:new Date(Number(w.expiration)).toISOString()}))}
  catch(e){console.log(JSON.stringify({event:'watch.failed',error:(e as Error).message}))}
}
const r=await syncInbox({maxThreads:Number(process.env.SYNC_MAX_THREADS||100)});
console.log(JSON.stringify({event:'sync.done',...r}));
await pool.end();
