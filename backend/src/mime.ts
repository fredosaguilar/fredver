import {randomUUID} from 'node:crypto';

export const clean=(s:string)=>s.replace(/[\r\n]+/g,' ').trim();
export const encodeHeader=(s:string)=>/^[\x20-\x7e]*$/.test(s)?s:'=?UTF-8?B?'+Buffer.from(s).toString('base64')+'?=';
const b64lines=(b:Buffer)=>b.toString('base64').replace(/.{76}/g,'$&\r\n');

export function newMessageId(domain:string){return `<${randomUUID()}@${domain}>`}

export const escapeHtml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const textToHtml=(s:string)=>escapeHtml(s).replace(/\r?\n/g,'<br>');

export function htmlToText(html:string){
  return html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|tr|h\d|li)>/gi,'\n')
    .replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/\n{3,}/g,'\n\n').trim();
}

export function buildMime(o:{from:string;to:string[];cc?:string[];bcc?:string[];subject:string;messageId:string;inReplyTo?:string;references?:string;
  text:string;html?:string;attachments?:{filename:string;mimeType:string;data:Buffer}[]}){
  const head=[`From: ${o.from}`,`To: ${o.to.join(', ')}`,...(o.cc?.length?[`Cc: ${o.cc.join(', ')}`]:[]),...(o.bcc?.length?[`Bcc: ${o.bcc.join(', ')}`]:[]),
    `Subject: ${encodeHeader(clean(o.subject))}`,`Message-ID: ${o.messageId}`,
    ...(o.inReplyTo?[`In-Reply-To: ${clean(o.inReplyTo)}`]:[]),...(o.references?[`References: ${clean(o.references)}`]:[]),'MIME-Version: 1.0'];
  const plain=['Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',b64lines(Buffer.from(o.text.replace(/\r?\n/g,'\r\n')))];
  // With HTML, the body is multipart/alternative (plain text for old clients, HTML for everyone else).
  let textPart=plain;
  if(o.html){
    const alt='fva_'+randomUUID().replace(/-/g,'');
    textPart=[`Content-Type: multipart/alternative; boundary="${alt}"`,'','--'+alt,...plain,'--'+alt,
      'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',b64lines(Buffer.from(o.html)),'--'+alt+'--',''];
  }
  if(!o.attachments?.length)return [...head,...textPart].join('\r\n');
  const boundary='fv_'+randomUUID().replace(/-/g,'');
  const parts=[['--'+boundary,...textPart].join('\r\n')];
  for(const a of o.attachments){
    const name=encodeHeader(clean(a.filename)).replace(/"/g,'');
    parts.push(['--'+boundary,`Content-Type: ${clean(a.mimeType)||'application/octet-stream'}; name="${name}"`,`Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64','',b64lines(a.data)].join('\r\n'));
  }
  return [...head,`Content-Type: multipart/mixed; boundary="${boundary}"`,'',...parts,'--'+boundary+'--',''].join('\r\n');
}
