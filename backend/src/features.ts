// Fredver 1.0 features: notifications, templates, read/unread, tags, shared drafts, full-text search,
// team management, settings and reports. All routes sit behind the /api sign-in check in server.ts.
import type {Express} from 'express';
import sanitizeHtml from 'sanitize-html';
import {z} from 'zod';
import {pool} from './db.js';
import {gmail,header,isInternal,parseAddress,sharedMailbox} from './gmail.js';
import {applyThread,sharedInboxId} from './sync.js';

type Actor={id:string;email:string;role:string;display_name:string};
const wrap=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next);
const uuid=z.string().uuid();

// Formatted email bodies and templates: only simple formatting survives (no scripts, styles, forms, images).
export function cleanHtml(html:string){
  return sanitizeHtml(html,{
    allowedTags:['b','strong','i','em','u','s','p','br','div','span','ul','ol','li','a','blockquote','h3','h4'],
    allowedAttributes:{a:['href','target','rel']},
    allowedSchemes:['http','https','mailto','tel'],
    transformTags:{a:sanitizeHtml.simpleTransform('a',{target:'_blank',rel:'noopener noreferrer'})},
  }).trim();
}

export async function memberOf(inboxId:string,userId:string){
  return uuid.safeParse(inboxId).success&&!!(await pool.query('SELECT 1 FROM inbox_members WHERE inbox_id=$1 AND user_id=$2',[inboxId,userId])).rowCount;
}

export async function notify(userId:string|null|undefined,threadId:string,kind:'assigned'|'mention'|'reply'|'draft',actorId:string|null,detail=''){
  if(!userId||userId===actorId)return;
  await pool.query('INSERT INTO notifications(user_id,thread_id,kind,actor_id,detail) VALUES($1,$2,$3,$4,$5)',[userId,threadId,kind,actorId,detail.slice(0,200)]);
}

// "@Henry" or "@henry@columbiabasininsurance.com" in a note notifies that teammate.
export async function notifyMentions(body:string,threadId:string,inboxId:string,actor:Actor){
  const tokens=[...body.matchAll(/@([\p{L}\p{N}._'’-]+(?:@[\w.-]+)?)/gu)].map(m=>m[1].toLowerCase().replace(/[.,;:!?]+$/,''));
  if(!tokens.length)return;
  const {rows}=await pool.query('SELECT u.id,u.email,u.display_name FROM users u JOIN inbox_members m ON m.user_id=u.id WHERE m.inbox_id=$1 AND u.active',[inboxId]);
  const norm=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9@.]/g,'');
  const hit=new Set<string>();
  for(const t of tokens)for(const u of rows){
    const first=norm(u.display_name.split(/\s+/)[0]);
    if(norm(t)===norm(u.email)||norm(t)===norm(u.email.split('@')[0])||norm(t)===first)hit.add(u.id);
  }
  for(const id of hit)await notify(id,threadId,'mention',actor.id,body.slice(0,160));
}

export function registerFeatures(app:Express,h:{authorizedThread:(id:string,a:Actor)=>Promise<any>;audit:(a:string|null,t:string,action:string,m?:any)=>Promise<any>}){
  // ---------- notifications ----------
  app.get('/api/notifications',wrap(async(req:any,res:any)=>{
    const {rows}=await pool.query(`SELECT n.id,n.kind,n.detail,n.created_at,n.read_at,n.thread_id,t.subject,a.display_name AS actor
      FROM notifications n LEFT JOIN threads t ON t.id=n.thread_id LEFT JOIN users a ON a.id=n.actor_id
      WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 50`,[req.actor.id]);
    const unread=(await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL',[req.actor.id])).rows[0].n;
    res.json({unread,items:rows});
  }));
  app.post('/api/notifications/read',wrap(async(req:any,res:any)=>{
    const {ids,all}=z.object({ids:z.array(z.number().int()).max(200).default([]),all:z.boolean().default(false)}).parse(req.body);
    if(all)await pool.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL',[req.actor.id]);
    else if(ids.length)await pool.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id=ANY($2::bigint[]) AND read_at IS NULL',[req.actor.id,ids]);
    res.json({ok:true});
  }));

  // ---------- read / unread ----------
  app.post('/api/threads/:id/unread',wrap(async(req:any,res:any)=>{
    const t=await h.authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
    await pool.query('DELETE FROM thread_reads WHERE user_id=$1 AND thread_id=$2',[req.actor.id,t.id]);res.json({ok:true});
  }));

  // ---------- templates ----------
  app.get('/api/inboxes/:id/templates',wrap(async(req:any,res:any)=>{
    if(!await memberOf(req.params.id,req.actor.id))return res.sendStatus(404);
    const {rows}=await pool.query('SELECT t.id,t.name,t.body_html,t.updated_at,u.display_name AS created_by FROM templates t LEFT JOIN users u ON u.id=t.created_by WHERE t.inbox_id=$1 ORDER BY lower(t.name)',[req.params.id]);
    res.json(rows);
  }));
  app.post('/api/inboxes/:id/templates',wrap(async(req:any,res:any)=>{
    if(!await memberOf(req.params.id,req.actor.id))return res.sendStatus(404);
    const {name,bodyHtml}=z.object({name:z.string().trim().min(1).max(100),bodyHtml:z.string().min(1).max(50000)}).parse(req.body);
    const {rows}=await pool.query('INSERT INTO templates(inbox_id,name,body_html,created_by) VALUES($1,$2,$3,$4) RETURNING id',[req.params.id,name,cleanHtml(bodyHtml),req.actor.id]);
    res.status(201).json(rows[0]);
  }));
  app.delete('/api/templates/:tid',wrap(async(req:any,res:any)=>{
    if(!uuid.safeParse(req.params.tid).success)return res.sendStatus(404);
    const t=(await pool.query('SELECT inbox_id,created_by FROM templates WHERE id=$1',[req.params.tid])).rows[0];
    if(!t||!await memberOf(t.inbox_id,req.actor.id))return res.sendStatus(404);
    if(t.created_by!==req.actor.id&&req.actor.role!=='admin')return res.status(403).json({error:'Only the author or an admin can delete this template'});
    await pool.query('DELETE FROM templates WHERE id=$1',[req.params.tid]);res.json({ok:true});
  }));

  // ---------- tags ----------
  app.get('/api/inboxes/:id/tags',wrap(async(req:any,res:any)=>{
    if(!await memberOf(req.params.id,req.actor.id))return res.sendStatus(404);
    const {rows}=await pool.query(`SELECT g.id,g.name,g.color,count(t.id) FILTER (WHERE t.status<>'closed')::int open_count
      FROM tags g LEFT JOIN thread_tags x ON x.tag_id=g.id LEFT JOIN threads t ON t.id=x.thread_id WHERE g.inbox_id=$1 GROUP BY g.id ORDER BY lower(g.name)`,[req.params.id]);
    res.json(rows);
  }));
  app.post('/api/inboxes/:id/tags',wrap(async(req:any,res:any)=>{
    if(!await memberOf(req.params.id,req.actor.id))return res.sendStatus(404);
    const {name,color}=z.object({name:z.string().trim().min(1).max(40),color:z.string().regex(/^#[0-9a-f]{6}$/i).default('#5f6368')}).parse(req.body);
    const {rows}=await pool.query('INSERT INTO tags(inbox_id,name,color) VALUES($1,$2,$3) ON CONFLICT(inbox_id,name) DO UPDATE SET color=EXCLUDED.color RETURNING id,name,color',[req.params.id,name,color]);
    res.status(201).json(rows[0]);
  }));
  app.delete('/api/tags/:tag',wrap(async(req:any,res:any)=>{
    if(req.actor.role!=='admin')return res.status(403).json({error:'Admins only'});
    if(!uuid.safeParse(req.params.tag).success)return res.sendStatus(404);
    const g=(await pool.query('SELECT inbox_id FROM tags WHERE id=$1',[req.params.tag])).rows[0];
    if(!g||!await memberOf(g.inbox_id,req.actor.id))return res.sendStatus(404);
    await pool.query('DELETE FROM tags WHERE id=$1',[req.params.tag]);res.json({ok:true});
  }));
  app.post('/api/threads/:id/tags',wrap(async(req:any,res:any)=>{
    const {tagId}=z.object({tagId:uuid}).parse(req.body);
    const t=await h.authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
    const g=(await pool.query('SELECT name FROM tags WHERE id=$1 AND inbox_id=$2',[tagId,t.inbox_id])).rows[0];if(!g)return res.sendStatus(404);
    const r=await pool.query('INSERT INTO thread_tags(thread_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[t.id,tagId]);
    if(r.rowCount)await h.audit(req.actor.id,t.id,'tag.added',{tag:g.name});
    res.json({ok:true});
  }));
  app.delete('/api/threads/:id/tags/:tag',wrap(async(req:any,res:any)=>{
    const t=await h.authorizedThread(req.params.id,req.actor);if(!t||!uuid.safeParse(req.params.tag).success)return res.sendStatus(404);
    const g=(await pool.query('SELECT name FROM tags WHERE id=$1',[req.params.tag])).rows[0];
    const r=await pool.query('DELETE FROM thread_tags WHERE thread_id=$1 AND tag_id=$2',[t.id,req.params.tag]);
    if(r.rowCount)await h.audit(req.actor.id,t.id,'tag.removed',{tag:g?.name});
    res.json({ok:true});
  }));

  // ---------- shared drafts (one per conversation, editable by any teammate) ----------
  const draftBody=z.object({mode:z.enum(['reply','replyAll','forward']),from:z.enum(['shared','me']),to:z.string().max(5000).default(''),
    cc:z.string().max(5000).default(''),bcc:z.string().max(5000).default(''),bodyHtml:z.string().max(100000).default('')});
  app.put('/api/threads/:id/draft',wrap(async(req:any,res:any)=>{
    const d=draftBody.parse(req.body);
    const t=await h.authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
    const prev=(await pool.query('SELECT author_id FROM drafts WHERE thread_id=$1',[t.id])).rows[0];
    await pool.query(`INSERT INTO drafts(thread_id,author_id,updated_by,mode,from_addr,to_addrs,cc_addrs,bcc_addrs,body_html,updated_at)
      VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(thread_id) DO UPDATE SET updated_by=$2,mode=$3,from_addr=$4,to_addrs=$5,cc_addrs=$6,bcc_addrs=$7,body_html=$8,updated_at=now()`,
      [t.id,req.actor.id,d.mode,d.from,d.to,d.cc,d.bcc,cleanHtml(d.bodyHtml)]);
    if(!prev)await h.audit(req.actor.id,t.id,'draft.started');
    res.json({ok:true});
  }));
  app.delete('/api/threads/:id/draft',wrap(async(req:any,res:any)=>{
    const t=await h.authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
    await pool.query('DELETE FROM drafts WHERE thread_id=$1',[t.id]);res.json({ok:true});
  }));
  app.post('/api/threads/:id/draft/review',wrap(async(req:any,res:any)=>{
    const {userId}=z.object({userId:uuid}).parse(req.body);
    const t=await h.authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
    if(!await memberOf(t.inbox_id,userId))return res.status(400).json({error:'Not a teammate'});
    await notify(userId,t.id,'draft',req.actor.id,'Please review the draft reply');
    await h.audit(req.actor.id,t.id,'draft.review_requested');
    res.json({ok:true});
  }));

  // ---------- full-text search (Gmail's own search over the shared mailbox, all dates) ----------
  app.get('/api/search',wrap(async(req:any,res:any)=>{
    const {inboxId,q}=z.object({inboxId:uuid,q:z.string().trim().min(1).max(300)}).parse(req.query);
    if(!await memberOf(inboxId,req.actor.id))return res.sendStatus(404);
    const inbox=(await pool.query('SELECT email FROM inboxes WHERE id=$1',[inboxId])).rows[0];
    if(inbox.email.toLowerCase()!==sharedMailbox())return res.status(409).json({error:'Inbox is not connected to Gmail'});
    const found=await gmail('threads?maxResults=40&q='+encodeURIComponent(q));
    const ids:string[]=(found.threads||[]).map((t:any)=>t.id);
    for(const gid of ids){
      if((await pool.query('SELECT 1 FROM threads WHERE inbox_id=$1 AND gmail_thread_id=$2',[inboxId,gid])).rowCount)continue;
      // Older conversation Fredver hasn't seen: add it (closed if it's been quiet for a week).
      const full=await gmail(`threads/${encodeURIComponent(gid)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
      const msgs=full.messages||[];if(!msgs.length)continue;const last=msgs.at(-1);
      const ext=[...msgs].reverse().find((m:any)=>!isInternal(parseAddress(header(m,'From')).email))||last;
      const from=parseAddress(header(ext,'From'));const lastAt=new Date(Number(last.internalDate||0));
      await pool.query(`INSERT INTO threads(inbox_id,gmail_thread_id,subject,from_name,from_email,snippet,last_message_at,first_message_at,message_count,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,[inboxId,gid,header(msgs[0],'Subject')||'(No subject)',from.name,from.email,(last.snippet||'').slice(0,300),
        lastAt,new Date(Number(msgs[0].internalDate||0)),msgs.length,Date.now()-lastAt.getTime()>7*864e5?'closed':'open']);
    }
    // The list endpoint (view=search&ids=…) returns these as normal conversation rows.
    res.json({ids});
  }));

  // ---------- add a conversation from your own mailbox ("Add to shared inbox") ----------
  // Only ever the signed-in employee's own mailbox. If the email also reached the shared mailbox, the existing
  // shared conversation is used instead of creating a second copy.
  const gidOk=(g:string)=>/^[0-9a-f]{8,24}$/i.test(g);
  async function findInShared(gid:string,owner:string){
    const mt=await gmail(`threads/${encodeURIComponent(gid)}?format=metadata&metadataHeaders=Message-ID`,{as:owner});
    for(const id of (mt.messages||[]).map((m:any)=>header(m,'Message-ID')).filter(Boolean).slice(0,5)){
      const f=await gmail('messages?maxResults=1&q='+encodeURIComponent('rfc822msgid:'+id.replace(/^<|>$/g,'')));
      if(f.messages?.[0])return f.messages[0].threadId as string;
    }
    return null;
  }
  async function rowSummary(where:string,args:any[]){
    return (await pool.query(`SELECT t.id,t.status,t.source_mailbox,u.display_name AS assignee_name FROM threads t LEFT JOIN users u ON u.id=t.assignee_id WHERE ${where} LIMIT 1`,args)).rows[0]||null;
  }
  app.get('/api/share/status',wrap(async(req:any,res:any)=>{
    const {account,gid}=z.object({account:z.string().trim().toLowerCase(),gid:z.string()}).parse(req.query);
    if(!gidOk(gid))return res.status(400).json({error:'Bad thread id'});
    const inboxId=await sharedInboxId();
    if(!await memberOf(inboxId,req.actor.id))return res.sendStatus(404);
    if(account===sharedMailbox())return res.json({canShare:false,thread:await rowSummary('t.inbox_id=$1 AND t.gmail_thread_id=$2 AND t.source_mailbox IS NULL',[inboxId,gid])});
    if(account!==req.actor.email.toLowerCase())return res.json({canShare:false,thread:null});
    let row=await rowSummary('t.inbox_id=$1 AND t.gmail_thread_id=$2 AND lower(t.source_mailbox)=$3',[inboxId,gid,account]);
    if(!row){const sg=await findInShared(gid,account);if(sg)row=await rowSummary('t.inbox_id=$1 AND t.gmail_thread_id=$2 AND t.source_mailbox IS NULL',[inboxId,sg])||{inSharedMailbox:true}}
    res.json({canShare:!row,thread:row});
  }));
  app.post('/api/share',wrap(async(req:any,res:any)=>{
    const {gid}=z.object({gid:z.string()}).parse(req.body);
    if(!gidOk(gid))return res.status(400).json({error:'Bad thread id'});
    const owner=req.actor.email.toLowerCase();
    const inboxId=await sharedInboxId();
    if(!await memberOf(inboxId,req.actor.id))return res.sendStatus(404);
    const existing=await rowSummary('t.inbox_id=$1 AND t.gmail_thread_id=$2 AND lower(t.source_mailbox)=$3',[inboxId,gid,owner]);
    if(existing)return res.json({id:existing.id,already:true});
    const sg=await findInShared(gid,owner);
    if(sg){
      const prev=(await pool.query('SELECT id,status,message_count,gmail_history_id,assignee_id,source_mailbox FROM threads WHERE inbox_id=$1 AND gmail_thread_id=$2',[inboxId,sg])).rows[0];
      const r=await applyThread(inboxId,sg,null,null,prev);
      if(r&&!prev)await pool.query(`UPDATE threads SET status='open' WHERE id=$1`,[r.id]);
      return res.json({id:r?.id,inSharedMailbox:true});
    }
    const r=await applyThread(inboxId,gid,null,owner,undefined);
    if(!r)return res.status(404).json({error:'Conversation not found in your mailbox'});
    await pool.query(`UPDATE threads SET status='open',updated_at=now() WHERE id=$1`,[r.id]);
    await h.audit(req.actor.id,r.id,'thread.shared',{from:owner});
    console.log(JSON.stringify({event:'thread.shared',by:owner,thread:r.id}));
    res.status(201).json({id:r.id});
  }));
  app.delete('/api/threads/:id/share',wrap(async(req:any,res:any)=>{
    const t=await h.authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
    if(!t.source_mailbox)return res.status(400).json({error:'This conversation is in the shared mailbox; close it instead'});
    if(t.source_mailbox.toLowerCase()!==req.actor.email.toLowerCase()&&req.actor.role!=='admin')return res.status(403).json({error:'Only the person who added it, or an admin, can remove it'});
    const c=await pool.connect();
    try{await c.query('BEGIN');for(const q of ['DELETE FROM notes WHERE thread_id=$1','DELETE FROM audit_events WHERE thread_id=$1','DELETE FROM threads WHERE id=$1'])await c.query(q,[t.id]);await c.query('COMMIT')}
    catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    console.log(JSON.stringify({event:'thread.unshared',by:req.actor.email,thread:t.id}));
    res.json({ok:true});
  }));

  // ---------- team management (admins) ----------
  const admin=(req:any,res:any)=>{if(req.actor.role!=='admin'){res.status(403).json({error:'Admins only'});return false}return true};
  app.get('/api/inboxes/:id/team',wrap(async(req:any,res:any)=>{
    if(!admin(req,res))return;if(!await memberOf(req.params.id,req.actor.id))return res.sendStatus(404);
    const {rows}=await pool.query(`SELECT u.id,u.email,u.display_name,u.role,u.active,(m.user_id IS NOT NULL) AS member FROM users u
      LEFT JOIN inbox_members m ON m.user_id=u.id AND m.inbox_id=$1 ORDER BY u.active DESC,lower(u.display_name)`,[req.params.id]);
    res.json(rows);
  }));
  app.post('/api/inboxes/:id/team',wrap(async(req:any,res:any)=>{
    if(!admin(req,res))return;if(!await memberOf(req.params.id,req.actor.id))return res.sendStatus(404);
    const domain=(process.env.ALLOWED_DOMAIN||'').toLowerCase();
    const i=z.object({email:z.string().trim().toLowerCase().refine(e=>!!domain&&e.endsWith('@'+domain)&&/^[^\s@]+@[^\s@]+$/.test(e),'Must be a company email'),
      displayName:z.string().trim().min(1).max(80),role:z.enum(['admin','agent']).default('agent')}).parse(req.body);
    if(i.email===sharedMailbox())return res.status(400).json({error:'The shared mailbox itself cannot be a team member'});
    const u=(await pool.query(`INSERT INTO users(email,display_name,role,active) VALUES($1,$2,$3,true)
      ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,active=true RETURNING id`,[i.email,i.displayName,i.role])).rows[0];
    await pool.query('INSERT INTO inbox_members(inbox_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,u.id]);
    console.log(JSON.stringify({event:'team.added',by:req.actor.email,email:i.email,role:i.role}));
    res.status(201).json(u);
  }));
  app.patch('/api/users/:uid',wrap(async(req:any,res:any)=>{
    if(!admin(req,res))return;if(!uuid.safeParse(req.params.uid).success)return res.sendStatus(404);
    const i=z.object({displayName:z.string().trim().min(1).max(80).optional(),role:z.enum(['admin','agent']).optional(),active:z.boolean().optional()}).parse(req.body);
    if(req.params.uid===req.actor.id&&(i.active===false||i.role==='agent'))return res.status(400).json({error:"You can't remove your own admin access"});
    await pool.query('UPDATE users SET display_name=COALESCE($1,display_name),role=COALESCE($2,role),active=COALESCE($3,active) WHERE id=$4',
      [i.displayName??null,i.role??null,i.active??null,req.params.uid]);
    if(i.active===false)await pool.query(`UPDATE threads SET assignee_id=NULL WHERE assignee_id=$1 AND status<>'closed'`,[req.params.uid]);
    console.log(JSON.stringify({event:'team.updated',by:req.actor.email,user:req.params.uid,...i}));
    res.json({ok:true});
  }));

  // ---------- settings ----------
  app.get('/api/inboxes/:id/settings',wrap(async(req:any,res:any)=>{
    if(!await memberOf(req.params.id,req.actor.id))return res.sendStatus(404);
    res.json((await pool.query('SELECT sla_hours FROM inboxes WHERE id=$1',[req.params.id])).rows[0]);
  }));
  app.patch('/api/inboxes/:id/settings',wrap(async(req:any,res:any)=>{
    if(!admin(req,res))return;if(!await memberOf(req.params.id,req.actor.id))return res.sendStatus(404);
    const {slaHours}=z.object({slaHours:z.number().int().min(1).max(168)}).parse(req.body);
    await pool.query('UPDATE inboxes SET sla_hours=$1 WHERE id=$2',[slaHours,req.params.id]);res.json({ok:true});
  }));

  // ---------- reports (last 30 days) ----------
  app.get('/api/inboxes/:id/reports',wrap(async(req:any,res:any)=>{
    if(!await memberOf(req.params.id,req.actor.id))return res.sendStatus(404);
    const id=req.params.id;
    const [daily,people,frt,now,overdue]=await Promise.all([
      pool.query(`SELECT to_char(d,'YYYY-MM-DD') AS day,(SELECT count(*) FROM threads t WHERE t.inbox_id=$1 AND t.first_message_at>=d AND t.first_message_at<d+interval '1 day')::int AS received
        FROM generate_series(date_trunc('day',now() AT TIME ZONE 'America/Los_Angeles')-interval '29 days',date_trunc('day',now() AT TIME ZONE 'America/Los_Angeles'),interval '1 day') d ORDER BY d`,[id]),
      pool.query(`SELECT u.display_name AS name,
          count(*) FILTER (WHERE a.action IN ('reply.sent','forward.sent','compose.sent'))::int AS sent,
          count(*) FILTER (WHERE a.action='thread.status' AND a.metadata->>'to'='closed')::int AS closed,
          (SELECT count(*) FROM threads t WHERE t.inbox_id=$1 AND t.assignee_id=u.id AND t.status='open')::int AS open_now,
          (SELECT count(*) FROM threads t WHERE t.inbox_id=$1 AND t.assignee_id=u.id AND t.status='pending')::int AS pending_now
        FROM users u JOIN inbox_members m ON m.user_id=u.id AND m.inbox_id=$1
        LEFT JOIN audit_events a ON a.actor_id=u.id AND a.created_at>now()-interval '30 days'
        WHERE u.active GROUP BY u.id ORDER BY sent DESC`,[id]),
      pool.query(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mins) AS median_minutes,avg(mins) AS avg_minutes,count(*)::int AS n FROM (
          SELECT extract(epoch FROM (min(a.created_at)-t.first_message_at))/60 AS mins FROM threads t
          JOIN audit_events a ON a.thread_id=t.id AND a.action IN ('reply.sent','forward.sent')
          WHERE t.inbox_id=$1 AND t.first_message_at>now()-interval '30 days' GROUP BY t.id,t.first_message_at HAVING min(a.created_at)>t.first_message_at) x`,[id]),
      pool.query(`SELECT count(*) FILTER (WHERE status='open')::int open,count(*) FILTER (WHERE status='pending')::int pending,
          count(*) FILTER (WHERE status<>'closed' AND assignee_id IS NULL)::int unassigned FROM threads WHERE inbox_id=$1`,[id]),
      pool.query(`SELECT count(*)::int n FROM threads t JOIN inboxes i ON i.id=t.inbox_id WHERE t.inbox_id=$1 AND ((t.status<>'closed' AND t.due_at IS NOT NULL AND t.due_at<now())
          OR (t.status='open' AND t.due_at IS NULL AND t.awaiting_reply AND t.last_client_message_at < now()-make_interval(hours=>i.sla_hours)))`,[id])]);
    res.json({daily:daily.rows,people:people.rows,firstResponse:frt.rows[0],now:{...now.rows[0],overdue:overdue.rows[0].n}});
  }));
}
