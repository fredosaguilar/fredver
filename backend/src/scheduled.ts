// Scheduled sends: replies and new emails stored with a send time and sent by processScheduled(), which runs
// from the sync job (every 5 minutes) and opportunistically from the API while anyone has Fredver open.
import type {Express} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {GmailError} from './gmail.js';
import {notifyDue} from './features.js';
import {type Actor,audit,authorizedThread,composeSchema,doCompose,doSend,isMember,sendSchema} from './sending.js';

const MAX_SCHEDULED_BYTES=15*1024*1024;
const wrap=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next);

export async function scheduleSend(actor:Actor,kind:'reply'|'compose',input:any,target:{threadId?:string;inboxId?:string}){
  const at=new Date(input.sendAt);
  if(isNaN(at.getTime())||at.getTime()<Date.now()+30_000)throw new GmailError('Pick a time in the future',400);
  if(at.getTime()>Date.now()+365*864e5)throw new GmailError('Pick a time within the next year',400);
  const bytes=(input.files||[]).reduce((n:number,f:any)=>n+Math.ceil((f.data?.length||0)*3/4),0);
  if(bytes>MAX_SCHEDULED_BYTES)throw new GmailError('Scheduled emails can carry up to 15 MB of attachments',413);
  let inboxId:string,threadId:string|null=null,subject:string;
  if(kind==='reply'){
    const t=await authorizedThread(target.threadId||'',actor);if(!t)throw new GmailError('Conversation not found',404);
    if(t.source_mailbox&&input.from==='me'&&actor.email.toLowerCase()!==t.source_mailbox.toLowerCase())
      throw new GmailError(`This conversation is in ${t.source_mailbox}'s mailbox. Reply from the shared address instead.`,400);
    inboxId=t.inbox_id;threadId=t.id;subject=t.subject;
  }else{
    if(!z.string().uuid().safeParse(target.inboxId).success||!await isMember(target.inboxId!,actor.id))throw new GmailError('Inbox not found',404);
    inboxId=target.inboxId!;subject=input.subject;
  }
  const {sendAt,...payload}=input;
  const summary={to:input.to,cc:input.cc,subject,mode:kind==='reply'?input.mode:'new',from:input.from,files:(input.files||[]).map((f:any)=>f.filename)};
  const {rows}=await pool.query(`INSERT INTO scheduled_sends(inbox_id,thread_id,actor_id,kind,payload,summary,send_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [inboxId,threadId,actor.id,kind,JSON.stringify(payload),JSON.stringify(summary),at]);
  if(threadId){
    await pool.query('DELETE FROM drafts WHERE thread_id=$1',[threadId]);
    await audit(actor.id,threadId,'reply.scheduled',{sendAt:at.toISOString(),mode:input.mode});
  }
  return {scheduled:true,id:rows[0].id,sendAt:at.toISOString()};
}

export async function processScheduled(limit=5){
  await pool.query(`UPDATE scheduled_sends SET status='failed',error='Interrupted while sending. Check Sent before scheduling it again.'
    WHERE status='sending' AND claimed_at<now()-interval '15 minutes'`);
  const {rows}=await pool.query(`UPDATE scheduled_sends SET status='sending',claimed_at=now() WHERE id IN (
    SELECT id FROM scheduled_sends WHERE status='pending' AND send_at<=now() ORDER BY send_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *`,[limit]);
  for(const row of rows){
    try{
      const actor=(await pool.query('SELECT id,email,role,display_name FROM users WHERE id=$1 AND active',[row.actor_id])).rows[0];
      if(!actor)throw new GmailError('The person who scheduled it no longer has access',403);
      const r:any=row.kind==='reply'?await doSend(actor,row.thread_id,sendSchema.parse(row.payload)):await doCompose(actor,row.inbox_id,composeSchema.parse(row.payload));
      await pool.query(`UPDATE scheduled_sends SET status='sent',sent_at=now(),error=NULL,result_thread_id=$2,payload=jsonb_set(payload,'{files}','[]') WHERE id=$1`,[row.id,r.threadId||r.id||null]);
      console.log(JSON.stringify({event:'scheduled.sent',id:row.id}));
    }catch(e){
      const msg=(e as Error).message||'Send failed';
      await pool.query(`UPDATE scheduled_sends SET status='failed',error=$2 WHERE id=$1`,[row.id,msg.slice(0,500)]);
      await pool.query(`INSERT INTO notifications(user_id,thread_id,kind,detail) VALUES($1,$2,'scheduled_failed',$3)`,[row.actor_id,row.thread_id,(row.summary?.subject||'')+': '+msg.slice(0,120)]);
      console.error(JSON.stringify({event:'scheduled.failed',id:row.id,error:msg}));
    }
  }
  return rows.length;
}

let lastRun=0;
// Called from frequent API requests (counts are fetched every 15 s by every open Fredver tab).
export async function maybeProcessScheduled(){
  if(Date.now()-lastRun<20_000)return;lastRun=Date.now();
  try{await processScheduled();await notifyDue()}catch(e){console.error('scheduled processing failed',e)}
}

export function registerScheduled(app:Express){
  app.get('/api/inboxes/:id/scheduled',wrap(async(req:any,res:any)=>{
    if(!z.string().uuid().safeParse(req.params.id).success||!await isMember(req.params.id,req.actor.id))return res.sendStatus(404);
    const {rows}=await pool.query(`SELECT s.id,s.thread_id,s.kind,s.summary,s.send_at,s.status,s.error,s.created_at,u.display_name AS by_name,s.actor_id
      FROM scheduled_sends s JOIN users u ON u.id=s.actor_id WHERE s.inbox_id=$1 AND (s.status IN ('pending','sending') OR (s.status='failed' AND s.created_at>now()-interval '7 days'))
      ORDER BY s.send_at`,[req.params.id]);
    res.json(rows);
  }));
  app.delete('/api/scheduled/:sid',wrap(async(req:any,res:any)=>{
    if(!z.string().uuid().safeParse(req.params.sid).success)return res.sendStatus(404);
    const s=(await pool.query('SELECT inbox_id,actor_id,status,thread_id FROM scheduled_sends WHERE id=$1',[req.params.sid])).rows[0];
    if(!s||!await isMember(s.inbox_id,req.actor.id))return res.sendStatus(404);
    if(s.actor_id!==req.actor.id&&req.actor.role!=='admin')return res.status(403).json({error:'Only the person who scheduled it, or an admin, can cancel it'});
    if(s.status!=='pending'&&s.status!=='failed')return res.status(409).json({error:'It is already being sent'});
    await pool.query(`UPDATE scheduled_sends SET status='canceled',payload=jsonb_set(payload,'{files}','[]') WHERE id=$1`,[req.params.sid]);
    if(s.thread_id)await audit(req.actor.id,s.thread_id,'reply.schedule_canceled');
    res.json({ok:true});
  }));
}
