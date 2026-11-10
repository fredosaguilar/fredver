// Sending replies and new emails. Used by the API routes and by scheduled sends (sync job).
import {z} from 'zod';
import {pool} from './db.js';
import {GmailError,gmail,header,isInternal,messageParts,parseAddress,sharedMailbox,signatureFor,sendRaw} from './gmail.js';
import {buildMime,clean,encodeHeader,escapeHtml,htmlToText,newMessageId,textToHtml} from './mime.js';
import {cleanHtml} from './features.js';

export type Actor={id:string;email:string;role:string;display_name:string};
export const audit=(actor:string|null,thread:string,action:string,metadata:any={})=>pool.query('INSERT INTO audit_events(actor_id,thread_id,action,metadata) VALUES($1,$2,$3,$4)',[actor,thread,action,JSON.stringify(metadata)]);
export async function authorizedThread(threadId:string,actor:Actor){
  if(!z.string().uuid().safeParse(threadId).success)return undefined;
  const {rows}=await pool.query(`SELECT t.*,i.email AS inbox_email,i.name AS inbox_name FROM threads t JOIN inboxes i ON i.id=t.inbox_id JOIN inbox_members m ON m.inbox_id=t.inbox_id WHERE t.id=$1 AND m.user_id=$2`,[threadId,actor.id]);
  return rows[0];
}
export async function isMember(inboxId:string,userId:string){
  return !!(await pool.query('SELECT 1 FROM inbox_members WHERE inbox_id=$1 AND user_id=$2',[inboxId,userId])).rowCount;
}
// The sender's Gmail signature, as HTML and plain text, or nothing when turned off or unavailable.
export async function sig(email:string,on:boolean){
  if(!on)return {html:'',text:''};
  try{const html=await signatureFor(email);return {html,text:html?htmlToText(html):''}}catch(e){console.error('signature lookup failed',e);return {html:'',text:''}}
}

export const addrList=z.array(z.string().trim().toLowerCase().regex(/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/,'Invalid email address')).max(50);
const NOT_ENABLED='Sending is not enabled yet: an administrator must add the gmail.send scope to domain-wide delegation.';
const MAX_UPLOAD=20*1024*1024;
export const fileList=z.array(z.object({filename:z.string().trim().min(1).max(255),mimeType:z.string().max(200).default('application/octet-stream'),
  data:z.string().max(28*1024*1024)})).max(20).default([]);
export function decodeFiles(files:{filename?:string;mimeType?:string;data?:string}[]){
  const out=files.map(f=>({filename:f.filename||'attachment',mimeType:/^[\w.+-]+\/[\w.+-]+$/.test(f.mimeType)?f.mimeType:'application/octet-stream',data:Buffer.from(f.data||'','base64')}));
  if(out.reduce((n,f)=>n+f.data.length,0)>MAX_UPLOAD)throw new GmailError('Attachments are over the 20 MB limit.',413);
  return out;
}
// Message body: formatted HTML from the editor (cleaned) with a plain-text twin, or plain text.
function bodyOf(i:{body?:string;bodyHtml?:string}){
  if(i.bodyHtml){const html=cleanHtml(i.bodyHtml);return {html,text:htmlToText(html)}}
  const text=(i.body||'').trim();return {html:textToHtml(text),text};
}
const fromHeader=(name:string,email:string)=>`${encodeHeader(clean(name||''))} <${email}>`.trim();
async function send(raw:string,opts:{as?:string;threadId?:string}){
  try{return await sendRaw(raw,opts)}
  catch(e){if(e instanceof GmailError&&e.code==='unauthorized_client')throw new GmailError(NOT_ENABLED,503,e.code);throw e}
}

export const sendSchema=z.object({mode:z.enum(['reply','replyAll','forward']),from:z.enum(['shared','me']).default('shared'),
  to:addrList.min(1),cc:addrList.default([]),bcc:addrList.default([]),body:z.string().trim().max(50000).default(''),bodyHtml:z.string().max(200000).optional(),
  status:z.enum(['open','pending','closed']).optional(),includeAttachments:z.boolean().default(true),signature:z.boolean().default(true),files:fileList,
  sendAt:z.string().datetime({offset:true}).optional()});
export const composeSchema=z.object({from:z.enum(['shared','me']).default('shared'),to:addrList.min(1),cc:addrList.default([]),bcc:addrList.default([]),
  subject:z.string().trim().min(1).max(500),body:z.string().trim().max(50000).default(''),bodyHtml:z.string().max(200000).optional(),signature:z.boolean().default(true),files:fileList,
  sendAt:z.string().datetime({offset:true}).optional()});

// Reply, reply all or forward. "from: shared" sends as the shared mailbox inside its Gmail thread.
// "from: me" sends from the signed-in employee's own mailbox (never anyone else's) and Bccs the shared
// mailbox, so the message still lands in the shared conversation for the team.
export async function doSend(actor:Actor,threadId:string,input:z.infer<typeof sendSchema>){
  const uploads=decodeFiles(input.files);
  const body=bodyOf(input);if(!body.text&&input.mode!=='forward')throw new GmailError('Write a message first',400);
  const t=await authorizedThread(threadId,actor);if(!t)throw new GmailError('Conversation not found',404);
  const mailbox=sharedMailbox();
  if(t.inbox_email.toLowerCase()!==mailbox)throw new GmailError('Inbox is not connected to Gmail',409);
  // Conversations added from an employee's own mailbox ("linked") are read from that mailbox. Only that
  // employee may reply from their own address (the reply then stays in their Gmail thread); everyone else
  // replies from the shared address, and the client's answer moves the conversation into the shared mailbox.
  const src:string|null=t.source_mailbox;
  if(src&&input.from==='me'&&actor.email.toLowerCase()!==src.toLowerCase())
    throw new GmailError(`This conversation is in ${src}'s mailbox. Reply from the shared address instead.`,400);
  const full=await gmail('threads/'+encodeURIComponent(t.gmail_thread_id)+'?format=full',{as:src||undefined});
  const msgs=full.messages||[];if(!msgs.length)throw new GmailError('Conversation has no messages',400);
  const target=[...msgs].reverse().find((m:any)=>!isInternal(parseAddress(header(m,'From')).email))||msgs.at(-1);
  const subj0=header(msgs[0],'Subject')||'';
  const fwd=input.mode==='forward';
  const subject=fwd?(/^fwd?:/i.test(subj0)?subj0:'Fwd: '+subj0):(/^re:/i.test(subj0)?subj0:'Re: '+subj0);
  const parts=messageParts(target.payload);
  const original=(parts.text||htmlToText(parts.html)||target.snippet||'').slice(0,20000);
  const date=new Date(Number(target.internalDate)).toLocaleString('en-US',{timeZone:'America/Los_Angeles',dateStyle:'medium',timeStyle:'short'});
  const signature=await sig(actor.email,input.signature);
  const origHtml=parts.html||textToHtml(original);
  const meta=`From: ${header(target,'From')}\nDate: ${date}\nSubject: ${header(target,'Subject')}\nTo: ${header(target,'To')}${header(target,'Cc')?'\nCc: '+header(target,'Cc'):''}`;
  const sigText=signature.text?`\n\n-- \n${signature.text}`:'';
  const text=fwd
    ?`${body.text}${sigText}\n\n---------- Forwarded message ---------\n${meta}\n\n${original}`
    :`${body.text}${sigText}\n\nOn ${date}, ${header(target,'From')} wrote:\n${original.split('\n').map(l=>'> '+l).join('\n')}`;
  const sigHtml=signature.html?`<br><div class="gmail_signature">${signature.html}</div>`:'';
  const html=`<div dir="ltr">${body.html}</div>${sigHtml}<br>`+(fwd
    ?`<div class="gmail_quote">---------- Forwarded message ---------<br>${textToHtml(meta)}<br><br>${origHtml}</div>`
    :`<div class="gmail_quote"><div dir="ltr">On ${escapeHtml(date)}, ${escapeHtml(header(target,'From'))} wrote:</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">${origHtml}</blockquote></div>`);
  let attachments:{filename:string;mimeType:string;data:Buffer}[]=[];
  if(fwd&&input.includeAttachments&&parts.attachments.length){
    if(parts.attachments.reduce((n,a)=>n+a.size,0)>20*1024*1024)throw new GmailError('Attachments are too large to forward (over 20 MB).',413);
    attachments=await Promise.all(parts.attachments.map(async a=>{
      const r=await gmail(`messages/${encodeURIComponent(target.id)}/attachments/${encodeURIComponent(a.attachmentId)}`,{as:src||undefined});
      return {filename:a.filename,mimeType:a.mimeType,data:Buffer.from(r.data,'base64url')};
    }));
  }
  const me=input.from==='me';
  const bcc=[...input.bcc];
  if(me&&!src&&![...input.to,...input.cc,...bcc].includes(mailbox))bcc.push(mailbox);
  const msgId=header(target,'Message-ID');
  const rfcId=newMessageId((process.env.ALLOWED_DOMAIN||'mail.local'));
  const raw=buildMime({from:me?fromHeader(actor.display_name,actor.email):fromHeader(t.inbox_name,mailbox),
    to:input.to,cc:input.cc,bcc,subject,messageId:rfcId,
    inReplyTo:msgId||undefined,references:[header(target,'References'),msgId].filter(Boolean).join(' ')||undefined,text,html,attachments:[...attachments,...uploads]});
  const sent=await send(raw,src?(me?{as:actor.email,threadId:t.gmail_thread_id}:{}):(me?{as:actor.email}:{threadId:t.gmail_thread_id}));
  await audit(actor.id,t.id,fwd?'forward.sent':'reply.sent',{messageId:sent.id,rfcMessageId:rfcId,from:me?actor.email:mailbox,mode:input.mode,to:input.to,cc:input.cc});
  await pool.query(`UPDATE threads SET status=COALESCE($1,status),updated_at=now(),last_message_at=now(),awaiting_reply=false,gmail_history_id=NULL WHERE id=$2`,[input.status??null,t.id]);
  await pool.query('DELETE FROM drafts WHERE thread_id=$1',[t.id]);
  await pool.query('INSERT INTO thread_reads(user_id,thread_id,read_at) VALUES($1,$2,now()) ON CONFLICT(user_id,thread_id) DO UPDATE SET read_at=now()',[actor.id,t.id]);
  if(input.status&&input.status!==t.status)await audit(actor.id,t.id,'thread.status',{from:t.status,to:input.status});
  await pool.query('DELETE FROM presence WHERE thread_id=$1 AND user_id=$2',[t.id,actor.id]);
  return {id:sent.id,threadId:t.id};
}

// Start a new conversation from the shared mailbox (or the employee's own address, Bcc'ing the shared
// mailbox). The sender is assigned automatically.
export async function doCompose(actor:Actor,inboxId:string,input:z.infer<typeof composeSchema>){
  const uploads=decodeFiles(input.files);
  const body=bodyOf(input);if(!body.text)throw new GmailError('Write a message first',400);
  if(!z.string().uuid().safeParse(inboxId).success||!await isMember(inboxId,actor.id))throw new GmailError('Inbox not found',404);
  const inbox=(await pool.query('SELECT id,email,name FROM inboxes WHERE id=$1',[inboxId])).rows[0];
  const mailbox=sharedMailbox();
  if(inbox.email.toLowerCase()!==mailbox)throw new GmailError('Inbox is not connected to Gmail',409);
  const me=input.from==='me';
  const bcc=[...input.bcc];if(me&&![...input.to,...input.cc,...bcc].includes(mailbox))bcc.push(mailbox);
  const rfcId=newMessageId(process.env.ALLOWED_DOMAIN||'mail.local');
  const signature=await sig(actor.email,input.signature);
  const raw=buildMime({from:me?fromHeader(actor.display_name,actor.email):fromHeader(inbox.name,mailbox),to:input.to,cc:input.cc,bcc,
    subject:input.subject,messageId:rfcId,text:body.text+(signature.text?`\n\n-- \n${signature.text}`:''),
    html:`<div dir="ltr">${body.html}</div>`+(signature.html?`<br><div class="gmail_signature">${signature.html}</div>`:''),attachments:uploads});
  const sent=await send(raw,me?{as:actor.email}:{});
  // From the shared mailbox the Gmail thread id is known now; from "me" the copy reaches the shared
  // mailbox via Bcc and the next sync picks it up, so look it up by Message-ID.
  let threadId=me?null:sent.threadId;
  if(me){for(let i=0;i<5&&!threadId;i++){await new Promise(r=>setTimeout(r,1500));
    const found=await gmail('messages?maxResults=1&q='+encodeURIComponent('rfc822msgid:'+rfcId.slice(1,-1)));threadId=found.messages?.[0]?.threadId||null}}
  if(!threadId)return {pending:true,id:null as string|null};
  const {rows}=await pool.query(`INSERT INTO threads(inbox_id,gmail_thread_id,subject,from_name,from_email,snippet,last_message_at,message_count,status,assignee_id)
    VALUES($1,$2,$3,'',$4,$5,now(),1,'open',$6) ON CONFLICT(inbox_id,gmail_thread_id) DO UPDATE SET updated_at=now(),assignee_id=COALESCE(threads.assignee_id,EXCLUDED.assignee_id) RETURNING id`,
    [inbox.id,threadId,input.subject,input.to[0],body.text.slice(0,300),actor.id]);
  await audit(actor.id,rows[0].id,'compose.sent',{messageId:sent.id,rfcMessageId:rfcId,from:me?actor.email:mailbox,to:input.to,cc:input.cc});
  return {id:rows[0].id as string,pending:false};
}
