import {pool} from './db.js';
import {gmail,header,isInternal,parseAddress,sharedMailbox} from './gmail.js';

// Bounded scan of the INBOX label. Threads whose Gmail historyId is unchanged are skipped, so a
// frequent scheduled run only fetches conversations that actually changed.
export async function syncInbox({maxThreads=100}:{maxThreads?:number}={}){
  const mailbox=sharedMailbox();
  const inbox=await pool.query('SELECT id FROM inboxes WHERE lower(email)=$1',[mailbox]);
  if(!inbox.rowCount)throw Error('Mailbox not provisioned');
  const inboxId=inbox.rows[0].id;
  let page:string|undefined;let scanned=0,updated=0,reopened=0;
  while(scanned<maxThreads){
    const data=await gmail('threads?labelIds=INBOX&maxResults='+Math.min(100,maxThreads-scanned)+(page?'&pageToken='+encodeURIComponent(page):''));
    for(const t of data.threads||[]){
      scanned++;
      const prev=(await pool.query('SELECT id,status,message_count,gmail_history_id,assignee_id FROM threads WHERE inbox_id=$1 AND gmail_thread_id=$2',[inboxId,t.id])).rows[0];
      if(prev&&prev.gmail_history_id===t.historyId)continue;
      const full=await gmail('threads/'+encodeURIComponent(t.id)+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date');
      const msgs=full.messages||[];const first=msgs[0];const last=msgs.at(-1);
      const subject=header(first,'Subject')||'(No subject)';
      // Show the most recent sender who is not the shared mailbox or an employee (i.e. the client).
      const external=[...msgs].reverse().find((m:any)=>!isInternal(parseAddress(header(m,'From')).email))||last;
      const from=parseAddress(header(external,'From'));
      const lastFromUs=isInternal(parseAddress(header(last,'From')).email);
      const lastAt=last?.internalDate?new Date(Number(last.internalDate)):null;
      const firstAt=first?.internalDate?new Date(Number(first.internalDate)):null;
      const lastClient=[...msgs].reverse().find((m:any)=>!isInternal(parseAddress(header(m,'From')).email));
      const lastClientAt=lastClient?.internalDate?new Date(Number(lastClient.internalDate)):null;
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const saved=await client.query(`INSERT INTO threads(inbox_id,gmail_thread_id,subject,from_name,from_email,snippet,last_message_at,message_count,gmail_history_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT(inbox_id,gmail_thread_id) DO UPDATE SET subject=EXCLUDED.subject,from_name=EXCLUDED.from_name,from_email=EXCLUDED.from_email,
            snippet=EXCLUDED.snippet,last_message_at=EXCLUDED.last_message_at,message_count=EXCLUDED.message_count,gmail_history_id=EXCLUDED.gmail_history_id
          RETURNING id`,[inboxId,t.id,subject,from.name,from.email,(last?.snippet||'').slice(0,300),lastAt,msgs.length,t.historyId]);
        const id=saved.rows[0].id;
        // SLA/report fields: who spoke last, and when the client last wrote.
        await client.query('UPDATE threads SET first_message_at=$1,last_client_message_at=$2,awaiting_reply=$3 WHERE id=$4',[firstAt,lastClientAt,!lastFromUs,id]);
        // New client message on an assigned conversation: tell the assignee.
        if(prev&&prev.assignee_id&&!lastFromUs&&msgs.length>prev.message_count&&prev.message_count>0)
          await client.query(`INSERT INTO notifications(user_id,thread_id,kind,detail) VALUES($1,$2,'reply',$3)`,[prev.assignee_id,id,(from.name||from.email).slice(0,120)]);
        // A client replying to a closed conversation reopens it.
        if(prev&&prev.status==='closed'&&!lastFromUs&&msgs.length>prev.message_count&&prev.message_count>0){
          await client.query(`UPDATE threads SET status='open',updated_at=now() WHERE id=$1`,[id]);
          await client.query(`INSERT INTO audit_events(thread_id,action,metadata) VALUES($1,'thread.reopened','{"reason":"new client message"}')`,[id]);
          reopened++;
        }
        const applied=await client.query('SELECT 1 FROM rule_applied WHERE thread_id=$1 LIMIT 1',[id]);
        if(!prev&&!applied.rowCount){
          const rules=await client.query('SELECT * FROM automation_rules WHERE inbox_id=$1 AND enabled=true ORDER BY name',[inboxId]);
          for(const rule of rules.rows)if(subject.toLowerCase().includes(rule.match_subject.toLowerCase())){
            await client.query('UPDATE threads SET status=COALESCE($1,status),assignee_id=COALESCE($2,assignee_id) WHERE id=$3',[rule.action_status,rule.assignee_id,id]);
            await client.query('INSERT INTO rule_applied(thread_id,rule_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,rule.id]);
          }
        }
        await client.query('COMMIT');updated++;
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    }
    page=data.nextPageToken;if(!page||!(data.threads||[]).length)break;
  }
  return {scanned,updated,reopened};
}
