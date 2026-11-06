import {pool} from './db.js';
import {syncInbox} from './sync.js';
import {startWatch} from './gmail.js';
// Daily: renew the Gmail push-notification watch, then run a catch-up sync in case a notification was missed.
if(process.env.WATCH_TOPIC){const w=await startWatch(process.env.WATCH_TOPIC);console.log(JSON.stringify({event:'watch.renewed',expiration:new Date(Number(w.expiration)).toISOString()}))}
const r=await syncInbox({maxThreads:Number(process.env.SYNC_MAX_THREADS||100)});
console.log(JSON.stringify({event:'sync.done',...r}));
await pool.end();
