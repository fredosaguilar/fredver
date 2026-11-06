// Fetches one attachment through the extension's signed-in background worker and shows it with
// Chrome's built-in viewer (PDFs, images, text). Only Fredver attachment paths are accepted.
const path=new URLSearchParams(location.search).get('p')||'';
const msg=document.getElementById('msg');
if(!/^\/api\/threads\/[0-9a-f-]{36}\/attachments\/[\w-]{1,64}\/[\d.]{1,32}$/.test(path)){msg.textContent='Invalid attachment link.'}
else chrome.runtime.sendMessage({type:'download',path},r=>{
  if(chrome.runtime.lastError||!r||r.error){msg.textContent='Could not open the attachment: '+(r?.error||chrome.runtime.lastError?.message||'unknown error');return}
  const f=r.data;document.title=f.name;
  const bytes=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0));
  location.replace(URL.createObjectURL(new Blob([bytes],{type:f.type})));
});
