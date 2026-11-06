import {GoogleAuth} from 'google-auth-library';

// Keyless domain-wide delegation: the Cloud Run identity asks IAM to sign a JWT as the Gmail
// service account (no private key is stored anywhere), then exchanges it for a token that can
// act only on the configured shared mailbox, with only the requested scope.
export const READ='https://www.googleapis.com/auth/gmail.readonly';
export const SEND='https://www.googleapis.com/auth/gmail.send';
const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
const cache=new Map<string,{token:string;exp:number}>();

export class GmailError extends Error{constructor(msg:string,public status:number,public code?:string){super(msg)}}

export function sharedMailbox(){const m=process.env.SHARED_MAILBOX;if(!m)throw Error('SHARED_MAILBOX missing');return m.toLowerCase()}

async function token(scope:string,subject:string){
  const key=scope+'|'+subject;const hit=cache.get(key);if(hit&&hit.exp>Date.now()+60_000)return hit.token;
  const sa=process.env.GMAIL_SERVICE_ACCOUNT;if(!sa)throw Error('GMAIL_SERVICE_ACCOUNT missing');
  const now=Math.floor(Date.now()/1000);
  const claims={iss:sa,sub:subject,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600};
  const client=await auth.getClient();
  const signed:any=await client.request({url:`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(sa)}:signJwt`,method:'POST',data:{payload:JSON.stringify(claims)}});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signed.data.signedJwt})});
  const t:any=await r.json();
  if(!r.ok||!t.access_token)throw new GmailError('Gmail authorization failed: '+(t.error_description||t.error||r.status),503,t.error);
  cache.set(key,{token:t.access_token,exp:Date.now()+(t.expires_in||3600)*1000});
  return t.access_token as string;
}

// `as` lets the backend act as the signed-in employee (only ever their own, already-verified address);
// by default every call acts as the shared mailbox.
export async function gmail(path:string,opts:{scope?:string;method?:string;body?:any;as?:string}={}){
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{method:opts.method||'GET',
    headers:{Authorization:'Bearer '+await token(opts.scope||READ,(opts.as||sharedMailbox()).toLowerCase()),...(opts.body?{'Content-Type':'application/json'}:{})},
    body:opts.body?JSON.stringify(opts.body):undefined});
  if(!r.ok)throw new GmailError(`Gmail API ${r.status}`,r.status===404?404:502);
  return r.json() as Promise<any>;
}

export const header=(msg:any,name:string)=>msg?.payload?.headers?.find((h:any)=>h.name.toLowerCase()===name.toLowerCase())?.value||'';

export function parseAddress(v:string){
  const m=v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if(m)return {name:m[1].trim(),email:m[2].trim().toLowerCase()};
  return {name:'',email:v.trim().toLowerCase()};
}

const b64=(s:string)=>Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');

// Many senders label PDFs/images as application/octet-stream; use the file extension so they open in the browser.
const EXT:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',txt:'text/plain',csv:'text/csv',
  doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
function guessType(name:string,type:string){
  if(type&&type!=='application/octet-stream'&&type!=='application/x-download')return type;
  return EXT[(name.split('.').pop()||'').toLowerCase()]||type||'application/octet-stream';
}

export function messageParts(payload:any){
  let text='',html='';const attachments:{filename:string;size:number;mimeType:string;attachmentId:string;partId:string}[]=[];
  (function walk(p:any){
    if(!p)return;
    if(p.filename&&p.body?.attachmentId){attachments.push({filename:p.filename,size:p.body.size||0,mimeType:guessType(p.filename,p.mimeType),attachmentId:p.body.attachmentId,partId:p.partId});return}
    if(p.mimeType==='text/plain'&&p.body?.data&&!text)text=b64(p.body.data);
    else if(p.mimeType==='text/html'&&p.body?.data&&!html)html=b64(p.body.data);
    (p.parts||[]).forEach(walk);
  })(payload);
  return {text,html,attachments};
}

// Ask Gmail to publish a Pub/Sub message whenever the shared mailbox's INBOX changes.
// A watch expires after 7 days, so it is renewed by the daily job.
export async function startWatch(topicName:string){
  return gmail('watch',{method:'POST',body:{topicName,labelIds:['INBOX'],labelFilterBehavior:'INCLUDE'}});
}

// True for the shared mailbox and for any employee address (internal senders never count as the client).
export function isInternal(email:string){
  const e=email.toLowerCase(),d=(process.env.ALLOWED_DOMAIN||'').toLowerCase();
  return e===sharedMailbox()||(!!d&&e.endsWith('@'+d));
}

// The employee's own Gmail signature (HTML), read with the read-only scope. Cached for 10 minutes.
const sigCache=new Map<string,{html:string;at:number}>();
export async function signatureFor(email:string){
  const e=email.toLowerCase();const hit=sigCache.get(e);
  if(hit&&Date.now()-hit.at<600_000)return hit.html;
  const r=await gmail('settings/sendAs',{as:e});
  const sa=(r.sendAs||[]).find((x:any)=>x.sendAsEmail?.toLowerCase()===e)||(r.sendAs||[]).find((x:any)=>x.isDefault);
  const html=sa?.signature||'';sigCache.set(e,{html,at:Date.now()});return html;
}

// Send a complete MIME message through Gmail's upload endpoint, which accepts messages up to 35 MB
// (the plain JSON endpoint is limited to a few MB, too small for attachments).
export async function sendRaw(raw:string,opts:{as?:string;threadId?:string}={}){
  const boundary='fvu_'+Math.random().toString(36).slice(2);
  const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(opts.threadId?{threadId:opts.threadId}:{})}\r\n--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`),
    Buffer.from(raw),Buffer.from(`\r\n--${boundary}--`)]);
  const r=await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart',{method:'POST',
    headers:{Authorization:'Bearer '+await token(SEND,(opts.as||sharedMailbox()).toLowerCase()),'Content-Type':`multipart/related; boundary=${boundary}`},body});
  if(!r.ok){const t=await r.text();console.error('gmail send failed',r.status,t.slice(0,500));throw new GmailError(r.status===413?'The email is too large for Gmail (25 MB limit).':`Gmail API ${r.status}`,r.status===413?413:502)}
  return r.json() as Promise<any>;
}
