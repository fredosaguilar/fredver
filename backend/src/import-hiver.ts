// One-time import of Hiver assignments/statuses into Fredver.
//
// Hiver mirrors its state into Gmail labels in each member's mailbox, e.g.
//   Hiver-info-columbiabasininsurancecom/fred      (assignee)
//   Hiver-info-columbiabasininsurancecom/open      (status)
//   Hiver-info-columbiabasininsurancecom/Unassigned
// This reads ONLY label names and each labeled thread's Message-ID header from the given member's
// mailbox (read-only), matches the conversation in the shared mailbox by Message-ID, and copies the
// assignee and status onto the Fredver thread. Nothing in Gmail or Hiver is modified.
//
//   tsx src/import-hiver.ts <member@domain>            dry run: prints what would change
//   tsx src/import-hiver.ts <member@domain> --apply    writes the changes
import {pool} from './db.js';
import {gmail,header,isInternal,parseAddress,sharedMailbox} from './gmail.js';

const member=(process.argv[2]||'').toLowerCase();
const apply=process.argv.includes('--apply');
if(!/^[^@\s]+@[^@\s]+$/.test(member))throw Error('usage: import-hiver.ts <member@domain> [--apply]');
const mailbox=sharedMailbox();
const PREFIX='hiver-'+mailbox.replace(/[@.]/g,'')+'/';
const STATUS:Record<string,'open'|'pending'|'closed'>={open:'open',pending:'pending',closed:'closed'};

const log=(o:any)=>console.log('HIVER '+JSON.stringify(o));
const labels=((await gmail('labels',{as:member})).labels||[]).filter((l:any)=>l.name.toLowerCase().startsWith(PREFIX));
log({event:'labels',names:labels.map((l:any)=>l.name)});

const inbox=(await pool.query('SELECT id FROM inboxes WHERE lower(email)=$1',[mailbox])).rows[0];
if(!inbox)throw Error('shared inbox not provisioned');
const users=(await pool.query('SELECT u.id,u.email,u.display_name FROM users u JOIN inbox_members m ON m.user_id=u.id WHERE m.inbox_id=$1 AND u.active',[inbox.id])).rows;
const norm=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'');
function userFor(sub:string){
  const k=norm(sub);
  return users.find(u=>norm(u.email.split('@')[0])===k)||users.find(u=>norm(u.display_name)===k)||users.find(u=>norm(u.display_name.split(/\s+/)[0])===k);
}

// What Hiver says, keyed by the member mailbox's thread id.
type Want={assignee?:string|null;assigneeLabel?:string;status?:'open'|'pending'|'closed'};
const want=new Map<string,Want>();
const unmappedLabels:string[]=[];
for(const l of labels){
  const sub=l.name.slice(PREFIX.length);
  const key=sub.toLowerCase();
  let apply1:(w:Want)=>void;
  if(STATUS[key])apply1=w=>{w.status=STATUS[key]};
  else if(key==='unassigned')apply1=w=>{if(w.assignee===undefined)w.assignee=null};
  else{const u=userFor(sub);if(!u){unmappedLabels.push(l.name);continue}apply1=w=>{w.assignee=u.id;w.assigneeLabel=sub}}
  let page:string|undefined;
  do{
    const r=await gmail(`threads?labelIds=${encodeURIComponent(l.id)}&maxResults=500`+(page?'&pageToken='+encodeURIComponent(page):''),{as:member});
    for(const t of r.threads||[]){const w=want.get(t.id)||{};apply1(w);want.set(t.id,w)}
    page=r.nextPageToken;
  }while(page);
}
log({event:'hiver_threads',count:want.size,unmappedLabels});

let matched=0,missing=0,created=0,changed=0,unchanged=0;
const byAssignee:Record<string,number>={},byStatus:Record<string,number>={};
const samples:any[]=[];
for(const [memberThreadId,w] of want){
  const mt=await gmail(`threads/${encodeURIComponent(memberThreadId)}?format=metadata&metadataHeaders=Message-ID`,{as:member});
  const ids=(mt.messages||[]).map((m:any)=>header(m,'Message-ID')).filter(Boolean);
  let sharedThreadId:string|null=null;
  for(const id of ids.slice(0,3)){
    const f=await gmail('messages?maxResults=1&q='+encodeURIComponent('rfc822msgid:'+id.replace(/^<|>$/g,'')));
    if(f.messages?.[0]){sharedThreadId=f.messages[0].threadId;break}
  }
  if(!sharedThreadId){missing++;continue}
  matched++;
  let row=(await pool.query('SELECT id,status,assignee_id,subject FROM threads WHERE inbox_id=$1 AND gmail_thread_id=$2',[inbox.id,sharedThreadId])).rows[0];
  if(!row){
    // Conversation older than Fredver's sync window: add it so the import can apply.
    const full=await gmail(`threads/${encodeURIComponent(sharedThreadId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
    const msgs=full.messages||[];const last=msgs.at(-1);
    const ext=[...msgs].reverse().find((m:any)=>!isInternal(parseAddress(header(m,'From')).email))||last;
    const from=parseAddress(header(ext,'From'));
    row={id:null,status:'open',assignee_id:null,subject:header(msgs[0],'Subject')||'(No subject)'};
    created++;
    if(apply){
      row.id=(await pool.query(`INSERT INTO threads(inbox_id,gmail_thread_id,subject,from_name,from_email,snippet,last_message_at,message_count)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(inbox_id,gmail_thread_id) DO UPDATE SET updated_at=threads.updated_at RETURNING id`,
        [inbox.id,sharedThreadId,row.subject,from.name,from.email,(last?.snippet||'').slice(0,300),last?.internalDate?new Date(Number(last.internalDate)):null,msgs.length])).rows[0].id;
    }
  }
  const newAssignee=w.assignee===undefined?row.assignee_id:w.assignee;
  const newStatus=w.status||row.status;
  const name=newAssignee?users.find(u=>u.id===newAssignee)?.display_name||'?':'Unassigned';
  byAssignee[name]=(byAssignee[name]||0)+1;byStatus[newStatus]=(byStatus[newStatus]||0)+1;
  if(newAssignee===row.assignee_id&&newStatus===row.status){unchanged++;continue}
  changed++;
  if(samples.length<10)samples.push({subject:row.subject.slice(0,60),from:{assignee:row.assignee_id?users.find(u=>u.id===row.assignee_id)?.display_name:null,status:row.status},to:{assignee:newAssignee?name:null,status:newStatus}});
  if(apply&&row.id){
    await pool.query('UPDATE threads SET assignee_id=$1,status=$2,updated_at=now() WHERE id=$3',[newAssignee,newStatus,row.id]);
    await pool.query(`INSERT INTO audit_events(thread_id,action,metadata) VALUES($1,'thread.imported',$2)`,[row.id,JSON.stringify({source:'hiver',assignee:newAssignee?name:null,status:newStatus})]);
  }
}
log({event:apply?'applied':'dry_run',hiverThreads:want.size,matched,notFoundInSharedMailbox:missing,addedToFredver:created,changed,alreadyMatching:unchanged,byAssignee,byStatus,unmappedLabels,samples});
await pool.end();
