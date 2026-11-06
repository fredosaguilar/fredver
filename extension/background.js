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
