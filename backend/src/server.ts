import express from 'express';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=promisify(execFile);
import cors from 'cors';
import {rateLimit} from 'express-rate-limit';
import {cleanHtml,notify,notifyMentions,registerFeatures} from './features.js';
import {type Actor,audit,authorizedThread,composeSchema,doCompose,doSend,isMember,sendSchema} from './sending.js';
import {maybeProcessScheduled,registerScheduled,scheduleSend} from './scheduled.js';
import helmet from 'helmet';
import {OAuth2Client} from 'google-auth-library';
import {z} from 'zod';
import {pool} from './db.js';
import {syncInbox} from './sync.js';
import {embedInline,gmail,GmailError,header,isInternal,messageParts,parseAddress,sharedMailbox,signatureFor,sendRaw} from './gmail.js';
import {buildMime,clean,encodeHeader,escapeHtml,htmlToText,newMessageId,textToHtml} from './mime.js';

const app=express();
app.set('trust proxy',1); // Cloud Run's front end; needed for per-IP limits
const google=new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID);
app.use(helmet());
// Rate limits: per IP before sign-in (blunts token-guessing floods), per employee after.
const limitJson=(msg:string)=>({standardHeaders:'draft-7' as const,legacyHeaders:false,message:{error:msg}});
app.use('/api',rateLimit({windowMs:60_000,limit:600,...limitJson('Too many requests, slow down')}));
app.use(cors({origin:process.env.ALLOWED_ORIGIN?.split(',')||false}));
// Sending can carry attachments (base64 in JSON); everything else stays small.
app.use(['/api/threads/:id/send','/api/inboxes/:id/compose'],express.json({limit:'30mb'}));
app.use(express.json({limit:'256kb'}));
declare global {namespace Express {interface Request {actor?:Actor}}}

app.get('/health',(_req,res)=>res.json({ok:true}));

// Gmail push notifications arrive from Pub/Sub with a Google-signed OIDC token for a dedicated
// service account. Anything else is rejected. A notification just triggers a short incremental sync.
let syncing:Promise<unknown>|null=null,again=false;
async function notifiedSync(){
  if(syncing){again=true;return syncing}
  syncing=(async()=>{do{again=false;await syncInbox({maxThreads:25})}while(again)})().finally(()=>{syncing=null});
  return syncing;
}
app.post('/pubsub/gmail',async(req,res)=>{
  try{
    const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const audience=process.env.PUBSUB_AUDIENCE,sa=process.env.PUBSUB_SERVICE_ACCOUNT;
    if(!token||!audience||!sa)return res.sendStatus(401);
    const p=(await google.verifyIdToken({idToken:token,audience})).getPayload();
    if(!p?.email_verified||p.email!==sa)return res.sendStatus(403);
  }catch{return res.sendStatus(401)}
  try{await notifiedSync();res.sendStatus(204)}
  catch(e){console.error('push sync failed',e);res.sendStatus(500)} // non-2xx makes Pub/Sub retry
});

// Every /api request must carry a Google ID token for a verified, provisioned, active employee
// of the allowed Workspace domain.
app.use('/api',async(req,res,next)=>{
  try{
    const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if(!token)return res.status(401).json({error:'Missing Google ID token'});
    let payload;
    try{payload=(await google.verifyIdToken({idToken:token,audience:process.env.GOOGLE_OAUTH_CLIENT_ID})).getPayload()}
    catch{return res.status(401).json({error:'Sign-in expired'})}
    if(!payload?.email_verified||!payload.email||!payload.sub)return res.sendStatus(401);
    const domain=process.env.ALLOWED_DOMAIN;
    if(!domain||payload.hd!==domain||!payload.email.toLowerCase().endsWith('@'+domain.toLowerCase()))return res.sendStatus(403);
    const {rows}=await pool.query('SELECT id,email,role,display_name FROM users WHERE lower(email)=lower($1) AND active=true',[payload.email]);
    if(!rows[0])return res.status(403).json({error:'User not provisioned'});
    req.actor=rows[0];next();
  }catch(e){next(e)}
});
app.use('/api',rateLimit({windowMs:60_000,limit:300,keyGenerator:(req:any)=>req.actor?.id||req.ip,...limitJson('Too many requests, slow down')}));
app.use(['/api/threads/:id/send','/api/inboxes/:id/compose'],rateLimit({windowMs:60_000,limit:20,keyGenerator:(req:any)=>req.actor?.id||req.ip,...limitJson('Sending too fast; wait a minute')}));
const wrap=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next);


app.get('/api/me',(req,res)=>res.json(req.actor));
app.get('/api/me/signature',wrap(async(req:any,res:any)=>{
  try{res.json({html:await signatureFor(req.actor.email)})}catch(e){console.error('signature lookup failed',e);res.json({html:'',error:'Could not read your Gmail signature'})}
}));

app.get('/api/inboxes',wrap(async(req:any,res:any)=>{
  const {rows}=await pool.query('SELECT i.id,i.email,i.name FROM inboxes i JOIN inbox_members m ON m.inbox_id=i.id WHERE m.user_id=$1 ORDER BY i.name',[req.actor.id]);res.json(rows);
}));

app.get('/api/inboxes/:id/members',wrap(async(req:any,res:any)=>{
  if(!z.string().uuid().safeParse(req.params.id).success||!await isMember(req.params.id,req.actor.id))return res.sendStatus(404);
  const {rows}=await pool.query('SELECT u.id,u.display_name,u.email FROM users u JOIN inbox_members m ON m.user_id=u.id WHERE m.inbox_id=$1 AND u.active=true ORDER BY u.display_name',[req.params.id]);res.json(rows);
}));

app.get('/api/inboxes/:id/counts',wrap(async(req:any,res:any)=>{
  await maybeProcessScheduled();
  if(!z.string().uuid().safeParse(req.params.id).success||!await isMember(req.params.id,req.actor.id))return res.sendStatus(404);
  const {rows}=await pool.query(`SELECT
    count(*) FILTER (WHERE assignee_id IS NULL AND status<>'closed')::int unassigned,
    count(*) FILTER (WHERE assignee_id=$2 AND status<>'closed')::int mine,
    count(*) FILTER (WHERE status='open')::int open,
    count(*) FILTER (WHERE status='pending')::int pending,
    count(*) FILTER (WHERE status='closed')::int closed,
    count(*)::int "all",
    count(*) FILTER (WHERE (status<>'closed' AND due_at IS NOT NULL AND due_at<now()) OR (status='open' AND due_at IS NULL AND awaiting_reply AND last_client_message_at < now()-make_interval(hours=>(SELECT sla_hours FROM inboxes WHERE id=$1))))::int overdue,
    (SELECT count(*) FROM scheduled_sends WHERE inbox_id=$1 AND status IN ('pending','sending','failed') AND (status<>'failed' OR created_at>now()-interval '7 days'))::int scheduled
    FROM threads WHERE inbox_id=$1`,[req.params.id,req.actor.id]);
  const team=await pool.query(`SELECT assignee_id,count(*)::int n FROM threads WHERE inbox_id=$1 AND assignee_id IS NOT NULL AND status<>'closed' GROUP BY assignee_id`,[req.params.id]);
  res.json({...rows[0],byAssignee:Object.fromEntries(team.rows.map(r=>[r.assignee_id,r.n]))});
}));

const VIEWS=['unassigned','mine','open','pending','closed','all','assignee','sent','overdue','tag','search','day'] as const;
app.get('/api/threads',wrap(async(req:any,res:any)=>{
  const input=z.object({inboxId:z.string().uuid(),view:z.enum(VIEWS).default('all'),assigneeId:z.string().uuid().optional(),tagId:z.string().uuid().optional(),
    ids:z.string().max(2000).optional(),day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),q:z.string().trim().max(200).optional()}).parse(req.query);
  const ids=(input.ids||'').split(',').filter(x=>/^[0-9a-f]{6,32}$/i.test(x)).slice(0,50);
  if(input.view==='assignee'&&!input.assigneeId)return res.status(400).json({error:'assigneeId required'});
  const q=input.q?'%'+input.q.replace(/[\\%_]/g,m=>'\\'+m)+'%':null;
  const {rows}=await pool.query(`SELECT t.id,t.subject,t.status,t.assignee_id,t.from_name,t.from_email,t.snippet,t.last_message_at,t.message_count,t.updated_at,
      u.display_name AS assignee_name,u.email AS assignee_email,
      (SELECT count(*) FROM notes n WHERE n.thread_id=t.id)::int AS note_count,s.sent_at,s.sent_by,
      t.awaiting_reply,t.last_client_message_at,i.sla_hours,t.source_mailbox,t.due_at,
      (t.last_message_at > greatest(coalesce(r.read_at,'-infinity'::timestamptz),me.read_baseline)) AS unread,
      coalesce((SELECT json_agg(json_build_object('id',g.id,'name',g.name,'color',g.color) ORDER BY g.name) FROM thread_tags x JOIN tags g ON g.id=x.tag_id WHERE x.thread_id=t.id),'[]') AS tags,
      (SELECT du.display_name FROM drafts d JOIN users du ON du.id=d.updated_by WHERE d.thread_id=t.id) AS draft_by
    FROM threads t JOIN inbox_members m ON m.inbox_id=t.inbox_id AND m.user_id=$1 JOIN inboxes i ON i.id=t.inbox_id JOIN users me ON me.id=$1
    LEFT JOIN thread_reads r ON r.thread_id=t.id AND r.user_id=$1 LEFT JOIN users u ON u.id=t.assignee_id
    LEFT JOIN LATERAL (SELECT a.created_at AS sent_at,su.display_name AS sent_by FROM audit_events a JOIN users su ON su.id=a.actor_id
      WHERE a.thread_id=t.id AND a.action IN ('reply.sent','forward.sent','compose.sent') ORDER BY a.created_at DESC LIMIT 1) s ON true
    WHERE t.inbox_id=$2 AND (
      $3::text='all' OR ($3::text='unassigned' AND t.assignee_id IS NULL AND t.status<>'closed')
      OR ($3::text='mine' AND t.assignee_id=$1 AND t.status<>'closed')
      OR ($3::text='assignee' AND t.assignee_id=$5::uuid AND t.status<>'closed')
      OR ($3::text='sent' AND s.sent_at IS NOT NULL) OR t.status=$3::text
      OR ($3::text='overdue' AND ((t.status<>'closed' AND t.due_at IS NOT NULL AND t.due_at<now()) OR (t.status='open' AND t.due_at IS NULL AND t.awaiting_reply AND t.last_client_message_at < now()-make_interval(hours=>i.sla_hours))))
      OR ($3::text='tag' AND EXISTS(SELECT 1 FROM thread_tags x WHERE x.thread_id=t.id AND x.tag_id=$6::uuid))
      OR ($3::text='search' AND t.gmail_thread_id=ANY($7::text[]))
      OR ($3::text='day' AND (t.first_message_at AT TIME ZONE 'America/Los_Angeles')::date=$8::date))
    AND ($4::text IS NULL OR t.subject ILIKE $4 OR t.from_email ILIKE $4 OR t.from_name ILIKE $4 OR t.snippet ILIKE $4)
    ORDER BY CASE WHEN $3::text='sent' THEN s.sent_at END DESC NULLS LAST,CASE WHEN $3::text='overdue' THEN coalesce(t.due_at,t.last_client_message_at+make_interval(hours=>i.sla_hours)) END ASC,t.last_message_at DESC NULLS LAST,t.updated_at DESC LIMIT 200`,
    [req.actor.id,input.inboxId,input.view,q,input.assigneeId??null,input.tagId??null,ids,input.day??null]);
  res.json(rows);
}));

async function viewers(threadId:string,actorId:string){
  const {rows}=await pool.query(`SELECT u.display_name,u.email,p.activity FROM presence p JOIN users u ON u.id=p.user_id WHERE p.thread_id=$1 AND p.user_id<>$2 AND p.seen_at>now()-interval '40 seconds'`,[threadId,actorId]);
  return rows;
}

app.get('/api/threads/:id',wrap(async(req:any,res:any)=>{
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
  if(t.inbox_email.toLowerCase()!==sharedMailbox())return res.status(409).json({error:'Inbox is not connected to Gmail'});
  const full=await gmail('threads/'+encodeURIComponent(t.gmail_thread_id)+'?format=full',{as:t.source_mailbox||undefined});
  const messages=await Promise.all((full.messages||[]).map(async(m:any)=>{
    const {attachments,inline,html,...p}=messageParts(m.payload);
    return {id:m.id,from:header(m,'From'),to:header(m,'To'),cc:header(m,'Cc'),replyTo:header(m,'Reply-To'),rfcId:header(m,'Message-ID'),
      date:m.internalDate?new Date(Number(m.internalDate)).toISOString():header(m,'Date'),subject:header(m,'Subject'),snippet:m.snippet||'',...p,
      html:await embedInline(html,inline,m.id,t.source_mailbox||undefined),
      attachments:attachments.map(({attachmentId,data,contentId,...a})=>a)};
  }));
  // attachments keep their partId (stable), which the download endpoint uses.
  const [notes,activity,members,senders]=await Promise.all([
    pool.query('SELECT n.id,n.body,n.created_at,u.display_name,u.email FROM notes n JOIN users u ON u.id=n.author_id WHERE n.thread_id=$1 ORDER BY n.created_at',[t.id]),
    pool.query(`SELECT a.action,a.metadata,a.created_at,u.display_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.thread_id=$1 AND a.action<>'note.created' ORDER BY a.created_at DESC LIMIT 50`,[t.id]),
    pool.query('SELECT u.id,u.display_name FROM users u WHERE u.id=$1',[t.assignee_id]),
    pool.query(`SELECT a.metadata->>'messageId' AS id,a.metadata->>'rfcMessageId' AS rfc,u.display_name FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.thread_id=$1 AND a.action IN ('reply.sent','forward.sent','compose.sent')`,[t.id])]);
  const [tags,draft,sla,scheduled]=await Promise.all([
    pool.query('SELECT g.id,g.name,g.color FROM thread_tags x JOIN tags g ON g.id=x.tag_id WHERE x.thread_id=$1 ORDER BY g.name',[t.id]),
    pool.query(`SELECT d.mode,d.from_addr,d.to_addrs,d.cc_addrs,d.bcc_addrs,d.body_html,d.updated_at,a.display_name AS author,b.display_name AS updated_by
      FROM drafts d JOIN users a ON a.id=d.author_id JOIN users b ON b.id=d.updated_by WHERE d.thread_id=$1`,[t.id]),
    pool.query('SELECT sla_hours FROM inboxes WHERE id=$1',[t.inbox_id]),
    pool.query(`SELECT s.id,s.summary,s.send_at,s.status,s.error,s.actor_id,u.display_name AS by_name FROM scheduled_sends s JOIN users u ON u.id=s.actor_id
      WHERE s.thread_id=$1 AND (s.status IN ('pending','sending') OR (s.status='failed' AND s.created_at>now()-interval '7 days')) ORDER BY s.send_at`,[t.id])]);
  await pool.query('INSERT INTO thread_reads(user_id,thread_id,read_at) VALUES($1,$2,now()) ON CONFLICT(user_id,thread_id) DO UPDATE SET read_at=now()',[req.actor.id,t.id]);
  await pool.query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND thread_id=$2 AND read_at IS NULL`,[req.actor.id,t.id]);
  await pool.query(`INSERT INTO presence(thread_id,user_id,activity,seen_at) VALUES($1,$2,'viewing',now()) ON CONFLICT(thread_id,user_id) DO UPDATE SET activity='viewing',seen_at=now()`,[t.id,req.actor.id]);
  const {inbox_email,inbox_name,gmail_history_id,...thread}=t;
  res.json({thread:{...thread,assignee_name:members.rows[0]?.display_name||null,inbox_email,inbox_name,sla_hours:sla.rows[0]?.sla_hours},tags:tags.rows,draft:draft.rows[0]||null,scheduled:scheduled.rows,messages,sentBy:Object.fromEntries(senders.rows.flatMap(r=>[[r.id,r.display_name],[r.rfc,r.display_name]]).filter(([k])=>k)),notes:notes.rows,activity:activity.rows,viewers:await viewers(t.id,req.actor.id)});
}));

// Fetch one attachment from a message in a conversation the user can see.
async function loadAttachment(req:any){
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return null;
  if(!/^[\w-]{1,64}$/.test(req.params.messageId)||!/^[\d.]{1,32}$/.test(req.params.partId))return null;
  const as=t.source_mailbox||undefined;
  const m=await gmail('messages/'+encodeURIComponent(req.params.messageId)+'?format=full',{as});
  if(m.threadId!==t.gmail_thread_id)return null;
  const a=messageParts(m.payload).attachments.find(x=>x.partId===req.params.partId);if(!a)return null;
  const r=await gmail(`messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.attachmentId)}`,{as});
  return {...a,mimeType:/^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType)?a.mimeType:'application/octet-stream',data:Buffer.from(r.data,'base64url')};
}
app.get('/api/threads/:id/attachments/:messageId/:partId',wrap(async(req:any,res:any)=>{
  const a=await loadAttachment(req);if(!a)return res.sendStatus(404);
  res.set({'Content-Type':a.mimeType,'X-Filename':encodeURIComponent(a.filename),'Cache-Control':'private, no-store'});
  res.send(a.data);
}));
// Small preview image: first page of a PDF (rendered with poppler's pdftoppm, 15 s limit), or the
// image itself for small images. Anything else has no preview.
app.get('/api/threads/:id/attachments/:messageId/:partId/thumb',wrap(async(req:any,res:any)=>{
  const a=await loadAttachment(req);if(!a)return res.sendStatus(404);
  res.set('Cache-Control','private, max-age=86400');
  if(/^image\/(png|jpeg|gif|webp)$/.test(a.mimeType)&&a.data.length<=4*1024*1024)return res.type(a.mimeType).send(a.data);
  if(a.mimeType!=='application/pdf'||a.data.length>15*1024*1024)return res.sendStatus(404);
  const dir=await mkdtemp(join(tmpdir(),'thumb-'));
  try{
    await writeFile(join(dir,'in.pdf'),a.data);
    await run('pdftoppm',['-png','-f','1','-l','1','-singlefile','-scale-to','360',join(dir,'in.pdf'),join(dir,'out')],{timeout:15000});
    res.type('image/png').send(await readFile(join(dir,'out.png')));
  }catch(e){console.error('thumbnail failed',(e as Error).message);res.sendStatus(404)}
  finally{rm(dir,{recursive:true,force:true}).catch(()=>{})}
}));

app.post('/api/threads/:id/presence',wrap(async(req:any,res:any)=>{
  const {activity}=z.object({activity:z.enum(['viewing','replying','left'])}).parse(req.body);
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
  if(activity==='left')await pool.query('DELETE FROM presence WHERE thread_id=$1 AND user_id=$2',[t.id,req.actor.id]);
  else await pool.query(`INSERT INTO presence(thread_id,user_id,activity,seen_at) VALUES($1,$2,$3,now()) ON CONFLICT(thread_id,user_id) DO UPDATE SET activity=$3,seen_at=now()`,[t.id,req.actor.id,activity]);
  res.json({viewers:await viewers(t.id,req.actor.id)});
}));

app.patch('/api/threads/:id',wrap(async(req:any,res:any)=>{
  const input=z.object({status:z.enum(['open','pending','closed']).optional(),assigneeId:z.string().uuid().nullable().optional(),
    dueAt:z.string().datetime({offset:true}).nullable().optional()}).refine(v=>v.status!==undefined||v.assigneeId!==undefined||v.dueAt!==undefined).parse(req.body);
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
  let assigneeName:string|null=null;
  if(input.assigneeId){
    const {rows}=await pool.query('SELECT u.display_name FROM inbox_members m JOIN users u ON u.id=m.user_id WHERE m.inbox_id=$1 AND m.user_id=$2 AND u.active',[t.inbox_id,input.assigneeId]);
    if(!rows[0])return res.status(400).json({error:'Assignee is not an inbox member'});assigneeName=rows[0].display_name;
  }
  const hasAssignee=Object.prototype.hasOwnProperty.call(input,'assigneeId');
  if(input.dueAt!==undefined){
    await pool.query('UPDATE threads SET due_at=$1,due_notified_at=NULL,updated_at=now() WHERE id=$2',[input.dueAt,t.id]);
    await audit(req.actor.id,t.id,'thread.due',{to:input.dueAt});
    if(input.status===undefined&&!hasAssignee)return res.json({id:t.id,due_at:input.dueAt});
  }
  const {rows}=await pool.query('UPDATE threads SET status=COALESCE($1,status),assignee_id=CASE WHEN $2 THEN $3::uuid ELSE assignee_id END,updated_at=now() WHERE id=$4 RETURNING id,status,assignee_id',[input.status??null,hasAssignee,input.assigneeId??null,t.id]);
  if(input.status&&input.status!==t.status)await audit(req.actor.id,t.id,'thread.status',{from:t.status,to:input.status});
  if(hasAssignee&&(input.assigneeId??null)!==t.assignee_id){
    await audit(req.actor.id,t.id,'thread.assigned',{to:assigneeName});
    await notify(input.assigneeId,t.id,'assigned',req.actor.id,t.subject);
  }
  res.json(rows[0]);
}));

// Bulk actions on several conversations at once (assign, status, tag, read/unread).
app.post('/api/threads/bulk',wrap(async(req:any,res:any)=>{
  const input=z.object({ids:z.array(z.string().uuid()).min(1).max(200),status:z.enum(['open','pending','closed']).optional(),
    assigneeId:z.string().uuid().nullable().optional(),tagId:z.string().uuid().optional(),read:z.boolean().optional()})
    .refine(v=>v.status!==undefined||v.assigneeId!==undefined||v.tagId!==undefined||v.read!==undefined,'Choose an action').parse(req.body);
  const threads=(await Promise.all([...new Set(input.ids)].map(id=>authorizedThread(id,req.actor)))).filter(Boolean);
  if(!threads.length)return res.sendStatus(404);
  const inboxId=threads[0].inbox_id;
  if(threads.some(t=>t.inbox_id!==inboxId))return res.status(400).json({error:'Conversations are in different inboxes'});
  let assigneeName:string|null=null;
  if(input.assigneeId){
    const {rows}=await pool.query('SELECT u.display_name FROM inbox_members m JOIN users u ON u.id=m.user_id WHERE m.inbox_id=$1 AND m.user_id=$2 AND u.active',[inboxId,input.assigneeId]);
    if(!rows[0])return res.status(400).json({error:'Assignee is not an inbox member'});assigneeName=rows[0].display_name;
  }
  let tagName:string|null=null;
  if(input.tagId){
    const g=(await pool.query('SELECT name FROM tags WHERE id=$1 AND inbox_id=$2',[input.tagId,inboxId])).rows[0];
    if(!g)return res.status(400).json({error:'Unknown tag'});tagName=g.name;
  }
  let changed=0;
  for(const t of threads){
    if(input.status&&input.status!==t.status){
      await pool.query('UPDATE threads SET status=$1,updated_at=now() WHERE id=$2',[input.status,t.id]);
      await audit(req.actor.id,t.id,'thread.status',{from:t.status,to:input.status,bulk:true});changed++;
    }
    if(input.assigneeId!==undefined&&(input.assigneeId??null)!==t.assignee_id){
      await pool.query('UPDATE threads SET assignee_id=$1,updated_at=now() WHERE id=$2',[input.assigneeId,t.id]);
      await audit(req.actor.id,t.id,'thread.assigned',{to:assigneeName,bulk:true});
      await notify(input.assigneeId,t.id,'assigned',req.actor.id,t.subject);changed++;
    }
    if(input.tagId){
      const r=await pool.query('INSERT INTO thread_tags(thread_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[t.id,input.tagId]);
      if(r.rowCount){await audit(req.actor.id,t.id,'tag.added',{tag:tagName,bulk:true});changed++}
    }
    if(input.read===true)await pool.query('INSERT INTO thread_reads(user_id,thread_id,read_at) VALUES($1,$2,now()) ON CONFLICT(user_id,thread_id) DO UPDATE SET read_at=now()',[req.actor.id,t.id]);
    if(input.read===false)await pool.query('DELETE FROM thread_reads WHERE user_id=$1 AND thread_id=$2',[req.actor.id,t.id]);
  }
  res.json({updated:threads.length,changed});
}));

app.post('/api/threads/:id/notes',wrap(async(req:any,res:any)=>{
  const {body}=z.object({body:z.string().trim().min(1).max(10000)}).parse(req.body);
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
  const {rows}=await pool.query('INSERT INTO notes(thread_id,author_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[t.id,req.actor.id,body]);
  await audit(req.actor.id,t.id,'note.created');
  await notifyMentions(body,t.id,t.inbox_id,req.actor);
  res.status(201).json({...rows[0],display_name:req.actor.display_name,email:req.actor.email});
}));

app.post('/api/threads/:id/send',wrap(async(req:any,res:any)=>{
  const input=sendSchema.parse(req.body);
  if(input.sendAt)return res.status(201).json(await scheduleSend(req.actor,'reply',input,{threadId:req.params.id}));
  res.json(await doSend(req.actor,req.params.id,input));
}));
app.post('/api/inboxes/:id/compose',wrap(async(req:any,res:any)=>{
  const input=composeSchema.parse(req.body);
  if(input.sendAt)return res.status(201).json(await scheduleSend(req.actor,'compose',input,{inboxId:req.params.id}));
  const r=await doCompose(req.actor,req.params.id,input);
  res.status(r.pending?202:201).json(r);
}));

registerFeatures(app,{authorizedThread,audit});
registerScheduled(app);

app.post('/api/admin/sync',wrap(async(req:any,res:any)=>{
  if(req.actor.role!=='admin')return res.sendStatus(403);
  res.json(await syncInbox({maxThreads:500}));
}));

app.use((err:any,_req:any,res:any,_next:any)=>{
  if(err instanceof z.ZodError){const i=err.issues[0];return res.status(400).json({error:i?.code==='custom'?i.message:'Invalid request'+(i?.path?.length?` (${i.path.join('.')})`:''),issues:err.issues})}
  if(err instanceof GmailError)return res.status(err.status).json({error:err.message});
  console.error(err);res.status(500).json({error:'Internal error'});
});
app.listen(Number(process.env.PORT||8080),()=>console.log('CBI Mail API listening'));
