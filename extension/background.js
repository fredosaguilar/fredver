importScripts('config.js');
const redirect=chrome.identity.getRedirectURL('oauth');

// ID tokens live in chrome.storage.session: memory-only, cleared when Chrome closes, and not
// readable by content scripts. Expired tokens are renewed silently when Google allows it.
const decode=t=>JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
async function saved(){const {idToken,email}=await chrome.storage.session.get(['idToken','email']);return {idToken,email}}

async function signIn(interactive,hint){
  const state=crypto.randomUUID(),nonce=crypto.randomUUID();
  const params=new URLSearchParams({client_id:CONFIG.clientId,redirect_uri:redirect,response_type:'id_token',scope:'openid email profile',state,nonce,
    prompt:interactive?'select_account':'none',hd:CONFIG.domain});
  if(hint)params.set('login_hint',hint);
  const url=await chrome.identity.launchWebAuthFlow({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params,interactive});
  if(!url)throw Error('Sign in cancelled');
  const out=new URLSearchParams(new URL(url).hash.slice(1));
  if(out.get('state')!==state||!out.get('id_token'))throw Error(out.get('error')||'Sign-in failed');
  const idToken=out.get('id_token');const body=decode(idToken);
  if(body.nonce!==nonce)throw Error('Sign-in failed (nonce mismatch)');
  await chrome.storage.session.set({idToken,email:body.email});
  return idToken;
}

async function token(){
  const {idToken,email}=await saved();
  if(idToken&&decode(idToken).exp*1000>Date.now()+120000)return idToken;
  if(email){try{return await signIn(false,email)}catch{}}
  await chrome.storage.session.remove(['idToken']);
  const e=Error('Sign in required');e.code='auth';throw e;
}

async function api(m){
  const send=async t=>fetch(CONFIG.api+m.path,{method:m.method||'GET',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:m.body?JSON.stringify(m.body):undefined});
  let r=await send(await token());
  if(r.status===401){await chrome.storage.session.remove(['idToken']);r=await send(await token())}
  const data=await r.json().catch(()=>({}));
  if(!r.ok){const e=Error(data.error||`Request failed (HTTP ${r.status})`);if(r.status===401)e.code='auth';throw e}
  return data;
}

// Attachment download: returns the file as base64 so the Gmail page can open or save it.
async function download(path){
  const get=async t=>fetch(CONFIG.api+path,{headers:{Authorization:'Bearer '+t}});
  let r=await get(await token());
  if(r.status===401){await chrome.storage.session.remove(['idToken']);r=await get(await token())}
  if(!r.ok){const e=Error(r.status===404?'Attachment not found':`Download failed (HTTP ${r.status})`);if(r.status===401)e.code='auth';throw e}
  const buf=new Uint8Array(await r.arrayBuffer());let bin='';
  for(let i=0;i<buf.length;i+=0x8000)bin+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));
  return {base64:btoa(bin),type:r.headers.get('Content-Type')||'application/octet-stream',name:decodeURIComponent(r.headers.get('X-Filename')||'attachment')};
}

// ---------- desktop notifications ----------
// Every minute, check for new Fredver notifications (assigned, @mentioned, client replied, draft review)
// and show them as Chrome notifications. Clicking one opens the conversation in Gmail.
const TEXT={assigned:n=>`${n.actor||'Someone'} assigned you`,mention:n=>`${n.actor||'Someone'} mentioned you`,
  reply:n=>`New reply from ${n.detail||'a client'}`,draft:n=>`${n.actor||'Someone'} asked you to review a draft`};
async function pollNotifications(){
  const {idToken}=await saved();if(!idToken)return;
  let data;try{data=await api({path:'/api/notifications'})}catch{return}
  const {lastNotified=0}=await chrome.storage.local.get('lastNotified');
  const fresh=data.items.filter(n=>!n.read_at&&n.id>lastNotified).slice(0,5).reverse();
  for(const n of fresh)chrome.notifications.create('fredver|'+n.id+'|'+(n.thread_id||''),{type:'basic',iconUrl:'icons/icon128.png',
    title:(TEXT[n.kind]||TEXT.assigned)(n),message:(n.subject||'')+(n.kind==='mention'&&n.detail?'\n“'+n.detail.slice(0,120)+'”':''),priority:1});
  const max=Math.max(lastNotified,...data.items.map(n=>n.id));
  if(max>lastNotified)await chrome.storage.local.set({lastNotified:max});
  chrome.action?.setBadgeText?.({text:data.unread?String(Math.min(data.unread,99)):''});
}
chrome.alarms.create('fredver-poll',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='fredver-poll')pollNotifications()});
chrome.notifications.onClicked.addListener(async id=>{
  const [,nid,threadId]=id.split('|');chrome.notifications.clear(id);
  api({path:'/api/notifications/read',method:'POST',body:{ids:[Number(nid)]}}).catch(()=>{});
  if(threadId)await chrome.storage.local.set({fredverOpen:{threadId,at:Date.now()}});
  const tabs=await chrome.tabs.query({url:'https://mail.google.com/*'});
  if(tabs[0]){await chrome.tabs.update(tabs[0].id,{active:true});await chrome.windows.update(tabs[0].windowId,{focused:true})}
  else await chrome.tabs.create({url:'https://mail.google.com/mail/u/0/#inbox'});
});

chrome.runtime.onMessage.addListener((m,_sender,reply)=>{
  (async()=>{
    if(m.type==='status'){const {idToken,email}=await saved();return {signedIn:!!idToken,email}}
    if(m.type==='auth'){await signIn(true);return {ok:true}}
    if(m.type==='signout'){await chrome.storage.session.clear();return {ok:true}}
    if(m.type==='api')return {data:await api(m)};
    if(m.type==='download')return {data:await download(m.path)};
    if(m.type==='view'){await chrome.tabs.create({url:chrome.runtime.getURL('viewer.html')+'?p='+encodeURIComponent(m.path)});return {ok:true}}
    throw Error('Unknown command');
  })().then(reply,e=>reply({error:e.message,code:e.code}));
  return true;
});
