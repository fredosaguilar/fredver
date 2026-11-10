import {pool} from './db.js';
import {gmail,header,isInternal,parseAddress,sharedMailbox} from './gmail.js';

type Prev={id:string;status:string;message_count:number;gmail_history_id:string|null;assignee_id:string|null;source_mailbox:string|null}|undefined;
const PREV_COLS='id,status,message_count,gmail_history_id,assignee_id,source_mailbox';

// Read one Gmail conversation and write it to Fredver. `mailbox` is where the conversation lives: null for the
// shared mailbox, or an employee's address for a conversation they added from their own mailbox.
export async function applyThread(inboxId:string,gid:string,historyId:string|null,mailbox:string|null,prev:Prev){
  const full=await gmail(`threads/${encodeURIComponent(gid)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References`,{as:mailbox||undefined});
  const msgs=full.messages||[];if(!msgs.length)return null;
  const first=msgs[0];const last=msgs.at(-1);
  const subject=header(first,'Subject')||'(No subject)';
  // Show the most recent sender who is not the shared mailbox or an employee (i.e. the client).
  const external=[...msgs].reverse().find((m:any)=>!isInternal(parseAddress(header(m,'From')).email))||last;
  const from=parseAddress(header(external,'From'));
  const lastFromUs=isInternal(parseAddress(header(last,'From')).email);
  const lastAt=last?.internalDate?new Date(Number(last.internalDate)):null;
  const firstAt=first?.internalDate?new Date(Number(first.internalDate)):null;
  const lastClient=[...msgs].reverse().find((m:any)=>!isInternal(parseAddress(header(m,'From')).email));
  const lastClientAt=lastClient?.internalDate?new Date(Number(lastClient.internalDate)):null;
  const hid=historyId||full.historyId||null;
  let merged=false;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    // A new shared-mailbox conversation that answers a reply Fredver sent from info@ for a conversation added
    // from someone's own mailbox: move that conversation into the shared mailbox instead of duplicating it.
    if(!prev&&!mailbox){
      const refs=[...new Set(msgs.flatMap((m:any)=>`${header(m,'In-Reply-To')} ${header(m,'References')}`.match(/<[^>]+>/g)||[]))];
      if(refs.length){
        const linked=(await client.query(`SELECT ${PREV_COLS.split(',').map(c=>'t.'+c).join(',')} FROM audit_events a JOIN threads t ON t.id=a.thread_id
          WHERE t.inbox_id=$1 AND t.source_mailbox IS NOT NULL AND a.metadata->>'rfcMessageId'=ANY($2::text[]) LIMIT 1`,[inboxId,refs])).rows[0];
        if(linked){
          await client.query('UPDATE threads SET gmail_thread_id=$1,source_mailbox=NULL WHERE id=$2',[gid,linked.id]);
          await client.query(`INSERT INTO audit_events(thread_id,action,metadata) VALUES($1,'thread.moved',$2)`,[linked.id,JSON.stringify({from:linked.source_mailbox})]);
          prev=linked;merged=true;
        }
      }
    }
    let id:string;
    if(prev){
      await client.query(`UPDATE threads SET subject=$1,from_name=$2,from_email=$3,snippet=$4,last_message_at=$5,message_count=$6,gmail_history_id=$7 WHERE id=$8`,
        [subject,from.name,from.email,(last?.snippet||'').slice(0,300),lastAt,msgs.length,hid,prev.id]);
      id=prev.id;
    }else{
      // A conversation seen for the first time that has been quiet for over a week is old mail, not new
      // work: add it as Closed. (Status on existing rows is never changed by this insert.)
      const firstSeenStatus=lastAt&&Date.now()-lastAt.getTime()>7*864e5?'closed':'open';
      id=(await client.query(`INSERT INTO threads(inbox_id,gmail_thread_id,subject,from_name,from_email,snippet,last_message_at,message_count,gmail_history_id,status,source_mailbox)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(inbox_id,gmail_thread_id) DO UPDATE SET subject=EXCLUDED.subject,from_name=EXCLUDED.from_name,from_email=EXCLUDED.from_email,
          snippet=EXCLUDED.snippet,last_message_at=EXCLUDED.last_message_at,message_count=EXCLUDED.message_count,gmail_history_id=EXCLUDED.gmail_history_id
        RETURNING id`,[inboxId,gid,subject,from.name,from.email,(last?.snippet||'').slice(0,300),lastAt,msgs.length,hid,firstSeenStatus,mailbox])).rows[0].id;
    }
    // SLA/report fields: who spoke last, and when the client last wrote.
    await client.query('UPDATE threads SET first_message_at=coalesce(first_message_at,$1),last_client_message_at=$2,awaiting_reply=$3 WHERE id=$4',[firstAt,lastClientAt,!lastFromUs,id]);
    const newClientMsg=!!prev&&!lastFromUs&&(merged||(msgs.length>prev.message_count&&prev.message_count>0));
    // New client message on an assigned conversation: tell the assignee.
    if(newClientMsg&&prev!.assignee_id)
      await client.query(`INSERT INTO notifications(user_id,thread_id,kind,detail) VALUES($1,$2,'reply',$3)`,[prev!.assignee_id,id,(from.name||from.email).slice(0,120)]);
    // A client replying to a closed conversation reopens it.
    let reopened=false;
    if(newClientMsg&&prev!.status==='closed'){
      await client.query(`UPDATE threads SET status='open',updated_at=now() WHERE id=$1`,[id]);
      await client.query(`INSERT INTO audit_events(thread_id,action,metadata) VALUES($1,'thread.reopened','{"reason":"new client message"}')`,[id]);
      reopened=true;
    }
    // Auto-assign rules run once, on conversations Fredver sees for the first time that are still open.
    const applied=await client.query('SELECT 1 FROM rule_applied WHERE thread_id=$1 LIMIT 1',[id]);
    const st=(await client.query('SELECT status,assignee_id FROM threads WHERE id=$1',[id])).rows[0];
    if(!prev&&!applied.rowCount&&st.status!=='closed'){
      const rules=await client.query('SELECT * FROM automation_rules WHERE inbox_id=$1 AND enabled=true ORDER BY created_at,name',[inboxId]);
      const subj=subject.toLowerCase(),sender=`${from.name} ${from.email}`.toLowerCase();
      for(const rule of rules.rows){
        const ms=(rule.match_subject||'').trim().toLowerCase(),mf=(rule.match_from||'').trim().toLowerCase();
        if(!ms&&!mf)continue;
        // Matches when the subject contains the phrase OR the sender (name/address) contains the text.
        if(!((ms&&subj.includes(ms))||(mf&&sender.includes(mf))))continue;
        await client.query('UPDATE threads SET status=COALESCE($1,status),assignee_id=COALESCE($2,assignee_id) WHERE id=$3',[rule.action_status,rule.assignee_id,id]);
        if(rule.tag_id)await client.query('INSERT INTO thread_tags(thread_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,rule.tag_id]);
        await client.query('INSERT INTO rule_applied(thread_id,rule_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,rule.id]);
        await client.query(`INSERT INTO audit_events(thread_id,action,metadata) VALUES($1,'rule.applied',$2)`,[id,JSON.stringify({rule:rule.name})]);
        if(rule.assignee_id&&!st.assignee_id)await client.query(`INSERT INTO notifications(user_id,thread_id,kind,detail) VALUES($1,$2,'assigned',$3)`,[rule.assignee_id,id,('Rule: '+rule.name).slice(0,200)]);
        break; // first matching rule wins
      }
    }
    await client.query('COMMIT');
    return {id,reopened};
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}

export async function sharedInboxId(){
  const inbox=await pool.query('SELECT id FROM inboxes WHERE lower(email)=$1',[sharedMailbox()]);
  if(!inbox.rowCount)throw Error('Mailbox not provisioned');
  return inbox.rows[0].id as string;
}

// Bounded scan of the shared mailbox's INBOX label, then a refresh of conversations added from employees' own
// mailboxes. Threads whose Gmail historyId is unchanged are skipped.
export async function syncInbox({maxThreads=100}:{maxThreads?:number}={}){
  const inboxId=await sharedInboxId();
  let page:string|undefined;let scanned=0,updated=0,reopened=0;
  while(scanned<maxThreads){
    const data=await gmail('threads?labelIds=INBOX&maxResults='+Math.min(100,maxThreads-scanned)+(page?'&pageToken='+encodeURIComponent(page):''));
    for(const t of data.threads||[]){
      scanned++;
      const prev=(await pool.query(`SELECT ${PREV_COLS} FROM threads WHERE inbox_id=$1 AND gmail_thread_id=$2`,[inboxId,t.id])).rows[0];
      if(prev&&prev.gmail_history_id===t.historyId)continue;
      const r=await applyThread(inboxId,t.id,t.historyId,null,prev);
      if(r){updated++;if(r.reopened)reopened++}
    }
    page=data.nextPageToken;if(!page||!(data.threads||[]).length)break;
  }
  const linked=await syncLinked(inboxId);
  return {scanned,updated,reopened,linked};
}

async function syncLinked(inboxId:string){
  const {rows}=await pool.query(`SELECT ${PREV_COLS},gmail_thread_id FROM threads WHERE inbox_id=$1 AND source_mailbox IS NOT NULL
    AND (status<>'closed' OR last_message_at>now()-interval '30 days') ORDER BY last_message_at DESC NULLS LAST LIMIT 300`,[inboxId]);
  let checked=0,updated=0;
  for(const row of rows){
    try{
      const t=await gmail(`threads/${encodeURIComponent(row.gmail_thread_id)}?format=minimal`,{as:row.source_mailbox});
      checked++;
      if(t.historyId===row.gmail_history_id)continue;
      await applyThread(inboxId,row.gmail_thread_id,t.historyId,row.source_mailbox,row);updated++;
    }catch(e){console.log(JSON.stringify({event:'linked.refresh_failed',thread:row.id,error:(e as Error).message}))}
  }
  return {checked,updated};
}
