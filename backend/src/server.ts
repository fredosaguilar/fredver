import express from 'express';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=promisify(execFile);
import cors from 'cors';
import helmet from 'helmet';
import {OAuth2Client} from 'google-auth-library';
import {z} from 'zod';
import {pool} from './db.js';
import {syncInbox} from './sync.js';
import {gmail,GmailError,header,isInternal,messageParts,parseAddress,sharedMailbox,signatureFor,sendRaw} from './gmail.js';
import {buildMime,clean,encodeHeader,escapeHtml,htmlToText,newMessageId,textToHtml} from './mime.js';

const app=express();
const google=new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID);
app.use(helmet());
app.use(cors({origin:process.env.ALLOWED_ORIGIN?.split(',')||false}));
// Sending can carry attachments (base64 in JSON); everything else stays small.
app.use(['/api/threads/:id/send','/api/inboxes/:id/compose'],express.json({limit:'30mb'}));
app.use(express.json({limit:'256kb'}));
type Actor={id:string;email:string;role:string;display_name:string};
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
const wrap=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next);
const audit=(actor:string|null,thread:string,action:string,metadata:any={})=>pool.query('INSERT INTO audit_events(actor_id,thread_id,action,metadata) VALUES($1,$2,$3,$4)',[actor,thread,action,JSON.stringify(metadata)]);

async function authorizedThread(threadId:string,actor:Actor){
  if(!z.string().uuid().safeParse(threadId).success)return undefined;
  const {rows}=await pool.query(`SELECT t.*,i.email AS inbox_email,i.name AS inbox_name FROM threads t JOIN inboxes i ON i.id=t.inbox_id JOIN inbox_members m ON m.inbox_id=t.inbox_id WHERE t.id=$1 AND m.user_id=$2`,[threadId,actor.id]);
  return rows[0];
}
async function isMember(inboxId:string,userId:string){
  return !!(await pool.query('SELECT 1 FROM inbox_members WHERE inbox_id=$1 AND user_id=$2',[inboxId,userId])).rowCount;
}

app.get('/api/me',(req,res)=>res.json(req.actor));
app.get('/api/me/signature',wrap(async(req:any,res:any)=>{
  try{res.json({html:await signatureFor(req.actor.email)})}catch(e){console.error('signature lookup failed',e);res.json({html:'',error:'Could not read your Gmail signature'})}
}));
// The sender's Gmail signature, as HTML and plain text, or nothing when turned off or unavailable.
async function sig(email:string,on:boolean){
  if(!on)return {html:'',text:''};
  try{const html=await signatureFor(email);return {html,text:html?htmlToText(html):''}}catch(e){console.error('signature lookup failed',e);return {html:'',text:''}}
}

app.get('/api/inboxes',wrap(async(req:any,res:any)=>{
  const {rows}=await pool.query('SELECT i.id,i.email,i.name FROM inboxes i JOIN inbox_members m ON m.inbox_id=i.id WHERE m.user_id=$1 ORDER BY i.name',[req.actor.id]);res.json(rows);
}));

app.get('/api/inboxes/:id/members',wrap(async(req:any,res:any)=>{
  if(!z.string().uuid().safeParse(req.params.id).success||!await isMember(req.params.id,req.actor.id))return res.sendStatus(404);
  const {rows}=await pool.query('SELECT u.id,u.display_name,u.email FROM users u JOIN inbox_members m ON m.user_id=u.id WHERE m.inbox_id=$1 AND u.active=true ORDER BY u.display_name',[req.params.id]);res.json(rows);
}));

app.get('/api/inboxes/:id/counts',wrap(async(req:any,res:any)=>{
  if(!z.string().uuid().safeParse(req.params.id).success||!await isMember(req.params.id,req.actor.id))return res.sendStatus(404);
  const {rows}=await pool.query(`SELECT
    count(*) FILTER (WHERE assignee_id IS NULL AND status<>'closed')::int unassigned,
    count(*) FILTER (WHERE assignee_id=$2 AND status<>'closed')::int mine,
    count(*) FILTER (WHERE status='open')::int open,
    count(*) FILTER (WHERE status='pending')::int pending,
    count(*) FILTER (WHERE status='closed')::int closed,
    count(*)::int "all"
    FROM threads WHERE inbox_id=$1`,[req.params.id,req.actor.id]);
  const team=await pool.query(`SELECT assignee_id,count(*)::int n FROM threads WHERE inbox_id=$1 AND assignee_id IS NOT NULL AND status<>'closed' GROUP BY assignee_id`,[req.params.id]);
  res.json({...rows[0],byAssignee:Object.fromEntries(team.rows.map(r=>[r.assignee_id,r.n]))});
}));

const VIEWS=['unassigned','mine','open','pending','closed','all','assignee','sent'] as const;
app.get('/api/threads',wrap(async(req:any,res:any)=>{
  const input=z.object({inboxId:z.string().uuid(),view:z.enum(VIEWS).default('all'),assigneeId:z.string().uuid().optional(),q:z.string().trim().max(200).optional()}).parse(req.query);
  if(input.view==='assignee'&&!input.assigneeId)return res.status(400).json({error:'assigneeId required'});
  const q=input.q?'%'+input.q.replace(/[\\%_]/g,m=>'\\'+m)+'%':null;
  const {rows}=await pool.query(`SELECT t.id,t.subject,t.status,t.assignee_id,t.from_name,t.from_email,t.snippet,t.last_message_at,t.message_count,t.updated_at,
      u.display_name AS assignee_name,u.email AS assignee_email,
      (SELECT count(*) FROM notes n WHERE n.thread_id=t.id)::int AS note_count,s.sent_at,s.sent_by
    FROM threads t JOIN inbox_members m ON m.inbox_id=t.inbox_id AND m.user_id=$1 LEFT JOIN users u ON u.id=t.assignee_id
    LEFT JOIN LATERAL (SELECT a.created_at AS sent_at,su.display_name AS sent_by FROM audit_events a JOIN users su ON su.id=a.actor_id
      WHERE a.thread_id=t.id AND a.action IN ('reply.sent','forward.sent','compose.sent') ORDER BY a.created_at DESC LIMIT 1) s ON true
    WHERE t.inbox_id=$2 AND (
      $3::text='all' OR ($3::text='unassigned' AND t.assignee_id IS NULL AND t.status<>'closed')
      OR ($3::text='mine' AND t.assignee_id=$1 AND t.status<>'closed')
      OR ($3::text='assignee' AND t.assignee_id=$5::uuid AND t.status<>'closed')
      OR ($3::text='sent' AND s.sent_at IS NOT NULL) OR t.status=$3::text)
    AND ($4::text IS NULL OR t.subject ILIKE $4 OR t.from_email ILIKE $4 OR t.from_name ILIKE $4 OR t.snippet ILIKE $4)
    ORDER BY CASE WHEN $3::text='sent' THEN s.sent_at END DESC NULLS LAST,t.last_message_at DESC NULLS LAST,t.updated_at DESC LIMIT 200`,[req.actor.id,input.inboxId,input.view,q,input.assigneeId??null]);
  res.json(rows);
}));

async function viewers(threadId:string,actorId:string){
  const {rows}=await pool.query(`SELECT u.display_name,u.email,p.activity FROM presence p JOIN users u ON u.id=p.user_id WHERE p.thread_id=$1 AND p.user_id<>$2 AND p.seen_at>now()-interval '40 seconds'`,[threadId,actorId]);
  return rows;
}

app.get('/api/threads/:id',wrap(async(req:any,res:any)=>{
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
  if(t.inbox_email.toLowerCase()!==sharedMailbox())return res.status(409).json({error:'Inbox is not connected to Gmail'});
  const full=await gmail('threads/'+encodeURIComponent(t.gmail_thread_id)+'?format=full');
  const messages=(full.messages||[]).map((m:any)=>({id:m.id,from:header(m,'From'),to:header(m,'To'),cc:header(m,'Cc'),replyTo:header(m,'Reply-To'),rfcId:header(m,'Message-ID'),date:m.internalDate?new Date(Number(m.internalDate)).toISOString():header(m,'Date'),
    subject:header(m,'Subject'),snippet:m.snippet||'',...(({attachments,...p})=>({...p,attachments:attachments.map(({attachmentId,...a})=>a)}))(messageParts(m.payload))}));
  // attachments keep their partId (stable), which the download endpoint uses.
  const [notes,activity,members,senders]=await Promise.all([
    pool.query('SELECT n.id,n.body,n.created_at,u.display_name,u.email FROM notes n JOIN users u ON u.id=n.author_id WHERE n.thread_id=$1 ORDER BY n.created_at',[t.id]),
    pool.query(`SELECT a.action,a.metadata,a.created_at,u.display_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.thread_id=$1 AND a.action<>'note.created' ORDER BY a.created_at DESC LIMIT 50`,[t.id]),
    pool.query('SELECT u.id,u.display_name FROM users u WHERE u.id=$1',[t.assignee_id]),
    pool.query(`SELECT a.metadata->>'messageId' AS id,a.metadata->>'rfcMessageId' AS rfc,u.display_name FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.thread_id=$1 AND a.action IN ('reply.sent','forward.sent','compose.sent')`,[t.id])]);
  await pool.query(`INSERT INTO presence(thread_id,user_id,activity,seen_at) VALUES($1,$2,'viewing',now()) ON CONFLICT(thread_id,user_id) DO UPDATE SET activity='viewing',seen_at=now()`,[t.id,req.actor.id]);
  const {inbox_email,inbox_name,gmail_history_id,...thread}=t;
  res.json({thread:{...thread,assignee_name:members.rows[0]?.display_name||null,inbox_email,inbox_name},messages,sentBy:Object.fromEntries(senders.rows.flatMap(r=>[[r.id,r.display_name],[r.rfc,r.display_name]]).filter(([k])=>k)),notes:notes.rows,activity:activity.rows,viewers:await viewers(t.id,req.actor.id)});
}));

// Fetch one attachment from a message in a conversation the user can see.
async function loadAttachment(req:any){
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return null;
  if(!/^[\w-]{1,64}$/.test(req.params.messageId)||!/^[\d.]{1,32}$/.test(req.params.partId))return null;
  const m=await gmail('messages/'+encodeURIComponent(req.params.messageId)+'?format=full');
  if(m.threadId!==t.gmail_thread_id)return null;
  const a=messageParts(m.payload).attachments.find(x=>x.partId===req.params.partId);if(!a)return null;
  const r=await gmail(`messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.attachmentId)}`);
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
  const input=z.object({status:z.enum(['open','pending','closed']).optional(),assigneeId:z.string().uuid().nullable().optional()}).refine(v=>v.status!==undefined||v.assigneeId!==undefined).parse(req.body);
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
  let assigneeName:string|null=null;
  if(input.assigneeId){
    const {rows}=await pool.query('SELECT u.display_name FROM inbox_members m JOIN users u ON u.id=m.user_id WHERE m.inbox_id=$1 AND m.user_id=$2 AND u.active',[t.inbox_id,input.assigneeId]);
    if(!rows[0])return res.status(400).json({error:'Assignee is not an inbox member'});assigneeName=rows[0].display_name;
  }
  const hasAssignee=Object.prototype.hasOwnProperty.call(input,'assigneeId');
  const {rows}=await pool.query('UPDATE threads SET status=COALESCE($1,status),assignee_id=CASE WHEN $2 THEN $3::uuid ELSE assignee_id END,updated_at=now() WHERE id=$4 RETURNING id,status,assignee_id',[input.status??null,hasAssignee,input.assigneeId??null,t.id]);
  if(input.status&&input.status!==t.status)await audit(req.actor.id,t.id,'thread.status',{from:t.status,to:input.status});
  if(hasAssignee&&(input.assigneeId??null)!==t.assignee_id)await audit(req.actor.id,t.id,'thread.assigned',{to:assigneeName});
  res.json(rows[0]);
}));

app.post('/api/threads/:id/notes',wrap(async(req:any,res:any)=>{
  const {body}=z.object({body:z.string().trim().min(1).max(10000)}).parse(req.body);
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
  const {rows}=await pool.query('INSERT INTO notes(thread_id,author_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[t.id,req.actor.id,body]);
  await audit(req.actor.id,t.id,'note.created');
  res.status(201).json({...rows[0],display_name:req.actor.display_name,email:req.actor.email});
}));

const addrList=z.array(z.string().trim().toLowerCase().regex(/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/,'Invalid email address')).max(50);
const NOT_ENABLED='Sending is not enabled yet: an administrator must add the gmail.send scope to domain-wide delegation.';
const MAX_UPLOAD=20*1024*1024;
const fileList=z.array(z.object({filename:z.string().trim().min(1).max(255),mimeType:z.string().max(200).default('application/octet-stream'),
  data:z.string().max(28*1024*1024)})).max(20).default([]);
function decodeFiles(files:{filename?:string;mimeType?:string;data?:string}[]){
  const out=files.map(f=>({filename:f.filename||'attachment',mimeType:/^[\w.+-]+\/[\w.+-]+$/.test(f.mimeType)?f.mimeType:'application/octet-stream',data:Buffer.from(f.data||'','base64')}));
  if(out.reduce((n,f)=>n+f.data.length,0)>MAX_UPLOAD)throw new GmailError('Attachments are over the 20 MB limit.',413);
  return out;
}
const fromHeader=(name:string,email:string)=>`${encodeHeader(clean(name||''))} <${email}>`.trim();
async function send(raw:string,opts:{as?:string;threadId?:string}){
  try{return await sendRaw(raw,opts)}
  catch(e){if(e instanceof GmailError&&e.code==='unauthorized_client')throw new GmailError(NOT_ENABLED,503,e.code);throw e}
}

// Reply, reply all or forward. "from: shared" sends as the shared mailbox inside its Gmail thread.
// "from: me" sends from the signed-in employee's own mailbox (never anyone else's) and Bccs the shared
// mailbox, so the message still lands in the shared conversation for the team.
app.post('/api/threads/:id/send',wrap(async(req:any,res:any)=>{
  const input=z.object({mode:z.enum(['reply','replyAll','forward']),from:z.enum(['shared','me']).default('shared'),
    to:addrList.min(1),cc:addrList.default([]),bcc:addrList.default([]),body:z.string().trim().min(1).max(50000),
    status:z.enum(['open','pending','closed']).optional(),includeAttachments:z.boolean().default(true),signature:z.boolean().default(true),files:fileList}).parse(req.body);
  const uploads=decodeFiles(input.files);
  const t=await authorizedThread(req.params.id,req.actor);if(!t)return res.sendStatus(404);
  const mailbox=sharedMailbox();
  if(t.inbox_email.toLowerCase()!==mailbox)return res.status(409).json({error:'Inbox is not connected to Gmail'});
  const full=await gmail('threads/'+encodeURIComponent(t.gmail_thread_id)+'?format=full');
  const msgs=full.messages||[];if(!msgs.length)return res.status(400).json({error:'Conversation has no messages'});
  const target=[...msgs].reverse().find((m:any)=>!isInternal(parseAddress(header(m,'From')).email))||msgs.at(-1);
  const subj0=header(msgs[0],'Subject')||'';
  const fwd=input.mode==='forward';
  const subject=fwd?(/^fwd?:/i.test(subj0)?subj0:'Fwd: '+subj0):(/^re:/i.test(subj0)?subj0:'Re: '+subj0);
  const parts=messageParts(target.payload);
  const original=(parts.text||htmlToText(parts.html)||target.snippet||'').slice(0,20000);
  const date=new Date(Number(target.internalDate)).toLocaleString('en-US',{timeZone:'America/Los_Angeles',dateStyle:'medium',timeStyle:'short'});
  const signature=await sig(req.actor.email,input.signature);
  const origHtml=parts.html||textToHtml(original);
  const meta=`From: ${header(target,'From')}\nDate: ${date}\nSubject: ${header(target,'Subject')}\nTo: ${header(target,'To')}${header(target,'Cc')?'\nCc: '+header(target,'Cc'):''}`;
  const sigText=signature.text?`\n\n-- \n${signature.text}`:'';
  const text=fwd
    ?`${input.body}${sigText}\n\n---------- Forwarded message ---------\n${meta}\n\n${original}`
    :`${input.body}${sigText}\n\nOn ${date}, ${header(target,'From')} wrote:\n${original.split('\n').map(l=>'> '+l).join('\n')}`;
  const sigHtml=signature.html?`<br><div class="gmail_signature">${signature.html}</div>`:'';
  const html=`<div dir="ltr">${textToHtml(input.body)}</div>${sigHtml}<br>`+(fwd
    ?`<div class="gmail_quote">---------- Forwarded message ---------<br>${textToHtml(meta)}<br><br>${origHtml}</div>`
    :`<div class="gmail_quote"><div dir="ltr">On ${escapeHtml(date)}, ${escapeHtml(header(target,'From'))} wrote:</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">${origHtml}</blockquote></div>`);
  let attachments:{filename:string;mimeType:string;data:Buffer}[]=[];
  if(fwd&&input.includeAttachments&&parts.attachments.length){
    if(parts.attachments.reduce((n,a)=>n+a.size,0)>20*1024*1024)return res.status(413).json({error:'Attachments are too large to forward (over 20 MB).'});
    attachments=await Promise.all(parts.attachments.map(async a=>{
      const r=await gmail(`messages/${encodeURIComponent(target.id)}/attachments/${encodeURIComponent(a.attachmentId)}`);
      return {filename:a.filename,mimeType:a.mimeType,data:Buffer.from(r.data,'base64url')};
    }));
  }
  const me=input.from==='me';
  const bcc=[...input.bcc];
  if(me&&![...input.to,...input.cc,...bcc].includes(mailbox))bcc.push(mailbox);
  const msgId=header(target,'Message-ID');
  const rfcId=newMessageId((process.env.ALLOWED_DOMAIN||'mail.local'));
  const raw=buildMime({from:me?fromHeader(req.actor.display_name,req.actor.email):fromHeader(t.inbox_name,mailbox),
    to:input.to,cc:input.cc,bcc,subject,messageId:rfcId,
    inReplyTo:msgId||undefined,references:[header(target,'References'),msgId].filter(Boolean).join(' ')||undefined,text,html,attachments:[...attachments,...uploads]});
  const sent=await send(raw,me?{as:req.actor.email}:{threadId:t.gmail_thread_id});
  await audit(req.actor.id,t.id,fwd?'forward.sent':'reply.sent',{messageId:sent.id,rfcMessageId:rfcId,from:me?req.actor.email:mailbox,mode:input.mode,to:input.to,cc:input.cc});
  await pool.query(`UPDATE threads SET status=COALESCE($1,status),updated_at=now(),last_message_at=now(),gmail_history_id=NULL WHERE id=$2`,[input.status??null,t.id]);
  if(input.status&&input.status!==t.status)await audit(req.actor.id,t.id,'thread.status',{from:t.status,to:input.status});
  await pool.query('DELETE FROM presence WHERE thread_id=$1 AND user_id=$2',[t.id,req.actor.id]);
  res.json({id:sent.id});
}));

// Start a new conversation from the shared mailbox (or the employee's own address, Bcc'ing the shared
// mailbox). The sender is assigned automatically.
app.post('/api/inboxes/:id/compose',wrap(async(req:any,res:any)=>{
  const input=z.object({from:z.enum(['shared','me']).default('shared'),to:addrList.min(1),cc:addrList.default([]),bcc:addrList.default([]),
    subject:z.string().trim().min(1).max(500),body:z.string().trim().min(1).max(50000),signature:z.boolean().default(true),files:fileList}).parse(req.body);
  const uploads=decodeFiles(input.files);
  if(!z.string().uuid().safeParse(req.params.id).success||!await isMember(req.params.id,req.actor.id))return res.sendStatus(404);
  const inbox=(await pool.query('SELECT id,email,name FROM inboxes WHERE id=$1',[req.params.id])).rows[0];
  const mailbox=sharedMailbox();
  if(inbox.email.toLowerCase()!==mailbox)return res.status(409).json({error:'Inbox is not connected to Gmail'});
  const me=input.from==='me';
  const bcc=[...input.bcc];if(me&&![...input.to,...input.cc,...bcc].includes(mailbox))bcc.push(mailbox);
  const rfcId=newMessageId(process.env.ALLOWED_DOMAIN||'mail.local');
  const signature=await sig(req.actor.email,input.signature);
  const raw=buildMime({from:me?fromHeader(req.actor.display_name,req.actor.email):fromHeader(inbox.name,mailbox),to:input.to,cc:input.cc,bcc,
    subject:input.subject,messageId:rfcId,text:input.body+(signature.text?`\n\n-- \n${signature.text}`:''),
    html:`<div dir="ltr">${textToHtml(input.body)}</div>`+(signature.html?`<br><div class="gmail_signature">${signature.html}</div>`:''),attachments:uploads});
  const sent=await send(raw,me?{as:req.actor.email}:{});
  // From the shared mailbox the Gmail thread id is known now; from "me" the copy reaches the shared
  // mailbox via Bcc and the next sync picks it up, so look it up by Message-ID.
  let threadId=me?null:sent.threadId;
  if(me){for(let i=0;i<5&&!threadId;i++){await new Promise(r=>setTimeout(r,1500));
    const found=await gmail('messages?maxResults=1&q='+encodeURIComponent('rfc822msgid:'+rfcId.slice(1,-1)));threadId=found.messages?.[0]?.threadId||null}}
  if(!threadId)return res.status(202).json({pending:true});
  const {rows}=await pool.query(`INSERT INTO threads(inbox_id,gmail_thread_id,subject,from_name,from_email,snippet,last_message_at,message_count,status,assignee_id)
    VALUES($1,$2,$3,'',$4,$5,now(),1,'open',$6) ON CONFLICT(inbox_id,gmail_thread_id) DO UPDATE SET updated_at=now(),assignee_id=COALESCE(threads.assignee_id,EXCLUDED.assignee_id) RETURNING id`,
    [inbox.id,threadId,input.subject,input.to[0],input.body.slice(0,300),req.actor.id]);
  await audit(req.actor.id,rows[0].id,'compose.sent',{messageId:sent.id,rfcMessageId:rfcId,from:me?req.actor.email:mailbox,to:input.to,cc:input.cc});
  res.status(201).json({id:rows[0].id});
}));

app.post('/api/admin/sync',wrap(async(req:any,res:any)=>{
  if(req.actor.role!=='admin')return res.sendStatus(403);
  res.json(await syncInbox({maxThreads:500}));
}));

app.use((err:any,_req:any,res:any,_next:any)=>{
  if(err instanceof z.ZodError)return res.status(400).json({error:'Invalid request',issues:err.issues});
  if(err instanceof GmailError)return res.status(err.status).json({error:err.message});
  console.error(err);res.status(500).json({error:'Internal error'});
});
app.listen(Number(process.env.PORT||8080),()=>console.log('CBI Mail API listening'));
