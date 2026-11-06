(()=>{
if(window.__fredvir)return;window.__fredvir=true;

const VIEWS=[['unassigned','Unassigned'],['mine','Assigned to me'],['open','Open'],['pending','Pending'],['closed','Closed'],['sent','Sent'],['all','All conversations']];
const S={signedIn:false,email:'',me:null,signature:null,inboxes:[],inbox:null,view:'unassigned',viewAssignee:null,compose:null,q:'',threads:[],counts:{},members:[],open:false,
  threadId:null,detail:null,expanded:new Set(),replying:false,reply:null,listLoading:false,error:''};

// ---------- helpers ----------
const call=(type,rest={})=>new Promise((res,rej)=>chrome.runtime.sendMessage({type,...rest},r=>{
  const le=chrome.runtime.lastError;if(le)return rej(Error(le.message));
  if(r?.error){const e=Error(r.error);e.code=r.code;return rej(e)}res(r?.data??r)}));
const api=(path,method,body)=>call('api',{path,method,body}).catch(e=>{if(e.code==='auth'){S.signedIn=false;renderNav();renderMain()}throw e});
function h(tag,attrs,...kids){
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(v==null||v===false)continue;
    if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(k==='class')e.className=v;else e.setAttribute(k,v===true?'':v);
  }
  for(const k of kids.flat())if(k!=null&&k!==false)e.append(k instanceof Node?k:String(k));
  return e;
}
const svg=d=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('width','20');s.setAttribute('height','20');
  const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);p.setAttribute('fill','currentColor');s.append(p);return s};
const ICON={
  back:'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  close:'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  refresh:'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  inbox:'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10z',
  attach:'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z'};
const iconBtn=(icon,title,onclick)=>h('button',{class:'icon',title,'aria-label':title,onclick},svg(ICON[icon]));
function when(iso){if(!iso)return '';const d=new Date(iso),n=new Date();
  if(d.toDateString()===n.toDateString())return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  if(d.getFullYear()===n.getFullYear())return d.toLocaleDateString([],{month:'short',day:'numeric'});
  return d.toLocaleDateString();}
const full=iso=>iso?new Date(iso).toLocaleString():'';
const nameOf=v=>{const m=(v||'').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);return m&&m[1]?m[1]:(m?m[2]:v||'')};
const initials=s=>(s||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
const STATUS={open:'Open',pending:'Pending',closed:'Closed'};

const BASE=`:host{all:initial}
*{box-sizing:border-box}
:host{--g:#164536;--g2:#1f6b52;--gl:#e3efe9;--ink:#202124;--mut:#5f6368;--line:#e0e3e7;--bg:#fff;--soft:#f6f8fc;--warn:#fef7e0;--warnink:#7a4b00;
  --open:#1a73e8;--pending:#e37400;--closed:#5f6368;font:14px/1.4 "Google Sans",Roboto,Arial,sans-serif;color:var(--ink)}
button{font:inherit;cursor:pointer;border:0;background:none;color:inherit}
button:disabled{opacity:.5;cursor:default}
.icon{width:36px;height:36px;border-radius:50%;display:inline-grid;place-items:center;color:var(--mut)}
.icon:hover{background:#0000000f}
.btn{background:var(--g);color:#fff;padding:8px 16px;border-radius:18px;font-weight:500}
.btn:hover{background:var(--g2)}
.btn.ghost{background:transparent;color:var(--g);border:1px solid var(--line)}
.btn.ghost:hover{background:var(--gl)}
input,select,textarea{font:inherit;color:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#fff;width:100%}
input:focus,select:focus,textarea:focus{outline:2px solid var(--g);outline-offset:-1px;border-color:transparent}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:500;white-space:nowrap}
.pill.open{background:#e8f0fe;color:var(--open)}.pill.pending{background:#fef0e0;color:var(--pending)}.pill.closed{background:#f1f3f4;color:var(--closed)}
.err{background:#fce8e6;color:#a50e0e;padding:8px 12px;border-radius:8px;margin:8px 0;font-size:13px}`;

// ---------- left sidebar section (inside Gmail's label list, styled like Gmail's own rows) ----------
const navHost=h('div',{id:'fredvir-nav'});const nav=navHost.attachShadow({mode:'open'});
const NAV_ICON={
  chevD:'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',chevR:'M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z',
  edit:'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  unassigned:ICON.inbox,
  mine:'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  open:'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10zm-8-7L4 6h16l-8 5z',
  pending:'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  closed:'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  sent:'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
  all:'M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z',
  team:'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z'};
const NAV_LABEL={unassigned:'Unassigned',mine:'Mine',open:'Open',pending:'Pending',closed:'Closed',sent:'Sent',all:'All conversations'};
const NAVCSS=BASE+`
:host{display:block;font:14px/20px "Google Sans",Roboto,Arial,sans-serif;color:#1f1f1f}
.sec{padding:4px 0 8px}
.row{display:flex;align-items:center;width:calc(100% - 12px);height:32px;border-radius:16px;font-size:14px;color:#1f1f1f;text-align:left;padding-right:12px;gap:0}
.row:hover{background:#0000000f}
.row.on{background:#d3e9de;font-weight:700;color:#0b3326}
.row svg{width:20px;height:20px;flex:none;color:#444746}
.row.on svg{color:#0b3326}
.row .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .n{font-size:12px;letter-spacing:.3px;margin-left:8px}
.row .n.b{font-weight:700}
.top{padding-left:8px}
.top .chev{width:20px;height:20px;display:grid;place-items:center;margin-right:6px}
.top .chev svg{width:18px;height:18px}
.top .ic{margin-right:16px}
.top .t{font-weight:500}
.top .brand{font-size:11px;font-weight:700;letter-spacing:.06em;color:#164536;background:#d3e9de;border-radius:8px;padding:0 6px;margin-left:6px}
.kid{margin-left:12px;width:calc(100% - 24px);padding-left:30px}
.kid svg{margin-right:14px;width:18px;height:18px}
.kid2{margin-left:12px;width:calc(100% - 24px);padding-left:62px}
.av{width:20px;height:20px;border-radius:50%;background:#164536;color:#fff;font-size:9px;display:inline-grid;place-items:center;font-weight:700;margin-right:10px;flex:none}
.signin{margin:4px 0 4px 42px;background:#164536;color:#fff;padding:6px 16px;border-radius:16px;font-weight:500}
.msg{margin:4px 16px 4px 42px;font-size:12px;color:#a50e0e;line-height:16px}
.acct{display:flex;align-items:center;gap:6px;margin:6px 16px 0 42px;font-size:12px;color:#5f6368}
.acct span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.acct button{color:#164536;font-weight:600;font-size:12px;white-space:nowrap}
.inbox{margin:2px 16px 4px 42px;width:calc(100% - 58px);padding:3px 6px;font-size:13px}
.float{position:fixed;left:12px;bottom:12px;width:256px;background:#fff;border-radius:16px;box-shadow:0 4px 24px #0003;z-index:2147483000;padding:8px 0}`;

// Gmail's sidebar is found by its Inbox link (role="navigation" also matches the narrow Mail/Chat/Meet
// rail). Fredver sits right after the block of Gmail's system labels (Inbox, Starred, Sent, Drafts…),
// like other shared-inbox tools. Falls back to a floating box when the sidebar is collapsed.
function findNavSpot(){
  // Gmail's logo also links to #inbox, so try every visible Inbox link (outside the top bar) and keep the
  // first one that sits in a sidebar-width list together with Sent/Drafts.
  const links=[...document.querySelectorAll('a[href*="#inbox"]')].filter(a=>{
    if(a.closest('header,[role="banner"]'))return false;
    const r=a.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<420;
  }).sort((x,y)=>Number(!!y.closest('[role="navigation"]'))-Number(!!x.closest('[role="navigation"]')));
  for(const inbox of links){
    let list=inbox.parentElement;
    while(list&&list!==document.body&&!list.querySelector('a[href*="#sent"],a[href*="#drafts"]'))list=list.parentElement;
    if(!list||list===document.body)continue;
    const w=list.getBoundingClientRect().width;
    if(w>=150&&w<=500)return list;
  }
  return null;
}
let navMisses=0;
function placeNav(){
  const spot=findNavSpot();
  if(spot){
    navMisses=0;
    if(navHost.previousElementSibling!==spot){delete navHost.dataset.floating;spot.after(navHost);renderNav()}
    return;
  }
  if(++navMisses>=5&&!navHost.dataset.floating){navHost.dataset.floating='1';document.documentElement.append(navHost);renderNav()}
}
setInterval(placeNav,1000);

const store={get:k=>{try{return localStorage.getItem('fredvir.'+k)}catch{return null}},set:(k,v)=>{try{localStorage.setItem('fredvir.'+k,v)}catch{}}};
let navCollapsed=store.get('collapsed')==='1',teamOpen=store.get('team')==='1';

function renderNav(){
  const wrap=h('div',{class:'sec'+(navHost.dataset.floating?' float':'')});
  const title=S.inbox?.name||'Shared inbox';
  wrap.append(h('button',{class:'row top',title:'Fredver · '+(S.inbox?.email||''),'aria-expanded':String(!navCollapsed),
      onclick:()=>{navCollapsed=!navCollapsed;store.set('collapsed',navCollapsed?'1':'0');renderNav()}},
    h('span',{class:'chev'},svg(navCollapsed?NAV_ICON.chevR:NAV_ICON.chevD)),h('span',{class:'ic'},svg(ICON.inbox)),
    h('span',{class:'t'},title),h('span',{class:'brand'},'FREDVER'),
    navCollapsed&&S.counts.unassigned?h('span',{class:'n b'},S.counts.unassigned):null));
  if(navCollapsed)return nav.replaceChildren(h('style',{},NAVCSS),wrap);
  if(!S.signedIn){
    wrap.append(h('button',{class:'signin',onclick:()=>doSignIn()},'Sign in to Fredver'));
  }else if(S.authError){
    wrap.append(h('div',{class:'msg'},S.authError));
  }else if(!S.inboxes.length){
    wrap.append(h('div',{class:'msg',style:'color:#5f6368'},'Loading…'));
  }else{
    if(S.inboxes.length>1)wrap.append(h('select',{class:'inbox','aria-label':'Shared inbox',onchange:e=>{S.inbox=S.inboxes.find(i=>i.id===e.target.value);loadInbox()}},
      S.inboxes.map(i=>h('option',{value:i.id,selected:i.id===S.inbox?.id},i.name))));
    const active=(v,a=null)=>S.open&&!S.threadId&&!S.compose&&S.view===v&&(v!=='assignee'||S.viewAssignee===a);
    wrap.append(h('button',{class:'row kid'+(S.open&&S.compose?' on':''),onclick:()=>openCompose()},svg(NAV_ICON.edit),h('span',{class:'t'},'New email')));
    for(const v of ['unassigned','mine','open','pending','closed','sent','all']){
      const n=S.counts[v],show=n>0&&['unassigned','mine','pending'].includes(v);
      wrap.append(h('button',{class:'row kid'+(active(v)?' on':''),onclick:()=>openView(v)},svg(NAV_ICON[v]),h('span',{class:'t'},NAV_LABEL[v]),
        show?h('span',{class:'n'+(v==='unassigned'||v==='mine'?' b':'')},n):null));
    }
    {
      wrap.append(h('button',{class:'row kid','aria-expanded':String(teamOpen),onclick:()=>{teamOpen=!teamOpen;store.set('team',teamOpen?'1':'0');renderNav()}},
        svg(NAV_ICON.team),h('span',{class:'t'},'Team'),svg(teamOpen?NAV_ICON.chevD:NAV_ICON.chevR)));
      if(teamOpen&&S.members.length<2)wrap.append(h('div',{class:'row kid2',style:'color:#5f6368;font-size:12px;height:auto;padding-top:4px;padding-bottom:4px'},'Only you so far. Teammates appear here once they are added.'));
      if(teamOpen)for(const m of S.members){
        const n=S.counts.byAssignee?.[m.id],nm=m.display_name||m.email;
        wrap.append(h('button',{class:'row kid2'+(active('assignee',m.id)?' on':''),title:'Open conversations assigned to '+nm,onclick:()=>openView('assignee',m.id)},
          h('span',{class:'av'},initials(nm)),h('span',{class:'t'},nm+(m.id===S.me?.id?' (me)':'')),n?h('span',{class:'n'},n):null));
      }
    }
  }
  if(S.signedIn)wrap.append(h('div',{class:'acct'},h('span',{title:S.email},S.email),h('button',{onclick:switchAccount},'Switch account')));
  nav.replaceChildren(h('style',{},NAVCSS),wrap);
}

// ---------- main pane (overlays Gmail's message area) ----------
const mainHost=h('div',{id:'fredvir-main'});mainHost.style.cssText='position:fixed;z-index:2147482000;display:none';
const main=mainHost.attachShadow({mode:'open'});document.documentElement.append(mainHost);
const MAINCSS=BASE+`
.pane{position:absolute;inset:0;background:var(--bg);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 3px #0002}
.bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);min-height:56px}
.bar h2{font-size:18px;font-weight:500;margin:0 8px 0 4px;white-space:nowrap}
.bar .sub{color:var(--mut);font-size:13px;white-space:nowrap}
.bar .search{max-width:360px;margin-left:auto;border-radius:20px;background:var(--soft);border-color:transparent}
.list{flex:1;overflow:auto}
.row{display:grid;grid-template-columns:200px 1fr auto 72px;gap:12px;align-items:center;padding:0 16px;height:44px;border-bottom:1px solid #f1f3f4;cursor:pointer;width:100%;text-align:left}
.row:hover{box-shadow:inset 1px 0 0 #dadce0,inset -1px 0 0 #dadce0,0 1px 2px #3c40434d;position:relative;z-index:1}
.row .from{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .from small{font-weight:400;color:var(--mut);margin-left:4px}
.row .subj{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .subj span{color:var(--mut)}
.row .meta{display:flex;gap:6px;align-items:center}
.row .time{text-align:right;font-size:12px;color:var(--mut);font-weight:600}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;background:#f1f3f4;border-radius:10px;padding:1px 8px 1px 2px;white-space:nowrap}
.av{width:18px;height:18px;border-radius:50%;background:var(--g);color:#fff;font-size:9px;display:inline-grid;place-items:center;font-weight:600}
.chip.none{padding:1px 8px;color:var(--mut);background:transparent;border:1px dashed var(--line)}
.empty{padding:64px 24px;text-align:center;color:var(--mut)}
.empty strong{display:block;color:var(--ink);font-size:16px;margin-bottom:4px}
.conv{flex:1;display:flex;min-height:0}
.thread{flex:1;overflow:auto;padding:0 24px 24px;min-width:0}
.thread h1{font-size:22px;font-weight:400;margin:16px 0 12px}
.banner{background:var(--warn);color:var(--warnink);padding:8px 12px;border-radius:8px;margin:12px 0;font-size:13px;font-weight:500}
.msg{border-bottom:1px solid var(--line);padding:12px 0}
.msg .head{display:flex;gap:12px;align-items:flex-start;cursor:pointer}
.msg .bigav{width:36px;height:36px;border-radius:50%;background:#7b8a84;color:#fff;display:grid;place-items:center;font-weight:600;flex:none}
.msg .bigav.us{background:var(--g)}
.msg .who{flex:1;min-width:0}
.msg .who b{font-weight:600}
.msg .who small{color:var(--mut)}
.msg .to{color:var(--mut);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msg .date{color:var(--mut);font-size:12px;white-space:nowrap}
.msg .snip{color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msg .body{margin:12px 0 0 48px}
.msg iframe{width:100%;border:0;min-height:40px;display:block}
.msg pre{white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:0}
.atts{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0 48px}
.att{display:inline-flex;gap:4px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:4px 10px;font-size:12px;color:var(--mut)}
.attwrap{margin:16px 0 4px 48px;padding-top:12px;border-top:1px solid #f1f3f4}
.atthead{display:flex;align-items:center;gap:12px;margin-bottom:10px;font-size:14px}
.attgrid{display:flex;flex-wrap:wrap;gap:16px}
.attcard{position:relative;width:180px;height:122px;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#fff}
.attmain{display:block;width:100%;height:100%;padding:0;text-align:left}
.attprev{height:86px;background:#f1f3f4;display:grid;place-items:center;overflow:hidden}
.attprev img{width:100%;height:100%;object-fit:cover;object-position:top}
.bigkind{font-size:22px;font-weight:700;letter-spacing:.05em}
.attfoot{height:36px;display:flex;align-items:center;gap:8px;padding:0 10px;border-top:1px solid var(--line);background:#f8f9fa}
.attfoot .kind{color:#fff;font-size:9px;font-weight:700;border-radius:3px;padding:2px 4px;flex:none}
.attfoot .nm{font-size:13px;font-weight:500;color:#5f6368;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atthover{position:absolute;inset:0;background:#202124d9;color:#fff;display:none;flex-direction:column;padding:12px;gap:2px;pointer-events:none}
.attcard:hover .atthover,.attcard:focus-within .atthover{display:flex}
.atthover .nm{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.atthover small{color:#dadce0}
.atthover .acts{margin-top:auto;display:flex;gap:8px;pointer-events:auto}
.atthover .acts button{width:32px;height:32px;border-radius:50%;background:#ffffff26;color:#fff;font-size:15px}
.atthover .acts button:hover{background:#ffffff4d}
.att svg{width:14px;height:14px}
.att small{color:var(--mut);margin-left:4px}
.attopen{display:inline-flex;align-items:center;gap:4px;color:var(--ink);font-size:12px;padding:0}
.attopen:hover{text-decoration:underline}
.attdl,.attx{color:var(--mut);padding:0 2px;margin-left:4px;font-size:13px}
.attdl:hover,.attx:hover{color:var(--ink)}
.attpick{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:6px 14px}
.compose .attpick{padding:8px 0}
.btn.small{padding:4px 12px;font-size:12px;display:inline-flex;align-items:center;gap:4px}
.btn.small svg{width:14px;height:14px}
.compose{max-width:820px}
.cf{display:flex;align-items:center;border-bottom:1px solid var(--line);margin-bottom:4px}
.cf span{width:70px;color:var(--mut);font-size:13px;flex:none}
.cf input,.cf select{border:0;border-radius:0}
.compose textarea{min-height:260px;margin-top:8px;resize:vertical}
.compose .acts{display:flex;gap:8px;margin-top:12px}
select.plain{border:0;background:transparent;padding:4px 2px;width:auto;max-width:100%;font-weight:500;cursor:pointer}
select.plain:hover{background:#0000000a}
.link{color:#0b57d0;font-size:13px;padding:2px 4px}
.link:hover{text-decoration:underline}
.replybtns{display:flex;gap:10px;margin:16px 0 0 48px}
.replybtns .btn{border-radius:18px;padding:8px 20px}
.reply{margin:16px 0 0;border-radius:12px;box-shadow:0 1px 2px #3c40434d,0 2px 6px 2px #3c404326;overflow:hidden;background:#fff}
.rbanner{background:#fdf1e8;color:#7a3e00;font-size:12px;padding:8px 14px;border-bottom:1px solid #f6dcc7}
.rbanner.me{background:#e8f0fe;color:#174ea6;border-color:#d2e3fc}
.rhead{display:flex;align-items:center;gap:10px;padding:6px 8px 6px 12px;border-bottom:1px solid var(--line)}
.rhead .mode{width:auto;border:0;font-weight:600;padding:4px;cursor:pointer;background:transparent}
.rhead .from{display:flex;align-items:center;gap:6px;color:var(--mut);font-size:13px;flex:1;min-width:0}
.rhead .from select{border:0;width:auto;max-width:100%;padding:4px;color:var(--ink);background:transparent;cursor:pointer}
.rl{display:flex;align-items:center;border-bottom:1px solid var(--line);padding:0 12px}
.rl span{width:40px;color:var(--mut);font-size:13px;flex:none}
.rl input{border:0;border-radius:0;padding:8px 4px}
.reply textarea{min-height:150px;resize:vertical;border:0;padding:12px 14px;display:block}
.reply textarea:focus,.rl input:focus{outline:none}
.reply .hint,.reply .err,.attrow{margin:0 14px}
.attrow{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--mut);padding:4px 0}
.attrow input{width:auto}
.reply .acts{display:flex;gap:8px;padding:10px 14px 14px;flex-wrap:wrap}
.sigbox{padding:4px 14px 6px;border-top:1px dashed var(--line)}
.compose .sigbox{padding:6px 0;border:0}
.sigtoggle{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--mut);padding:4px 0}
.sigtoggle input{width:auto}
.sigprev{width:100%;border:0;display:block;min-height:40px;opacity:.85}
.btn.close{background:#1e8e3e}.btn.close:hover{background:#188038}
.side{width:320px;flex:none;border-left:1px solid var(--line);overflow:auto;padding:16px;background:#fff}
.side h3{font-size:14px;font-weight:600;color:var(--ink);margin:20px 0 8px;padding-top:14px;border-top:1px solid var(--line)}
.props{display:grid;grid-template-columns:88px 1fr;row-gap:6px;align-items:center;font-size:13px}
.props .k{color:var(--mut)}
.props .v{display:flex;align-items:center;gap:6px;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.props .v svg{width:16px;height:16px;color:var(--mut);flex:none}
select.st.open{color:var(--open)}select.st.pending{color:var(--pending)}select.st.closed{color:var(--closed)}
.notebox{border:1px solid var(--line);border-radius:8px;padding:6px;margin-bottom:10px;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.notebox textarea{border:0;min-height:56px;padding:4px}
.notebox textarea:focus{outline:none}
.side .btn{padding:5px 14px;font-size:13px}
.note{background:#fff8d6;border:1px solid #f3e3a1;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:13px;white-space:pre-wrap;word-wrap:break-word}
.note small{display:block;color:var(--mut);margin-bottom:2px;white-space:normal}
.side textarea{min-height:64px;font-size:13px;resize:vertical}
.side .btn{margin-top:6px;padding:6px 14px;font-size:13px}
.act{font-size:12px;color:var(--mut);padding:4px 0;border-bottom:1px dashed var(--line)}
.hint{font-size:12px;color:var(--mut);margin-top:4px}
.loading{padding:48px;text-align:center;color:var(--mut)}
@media (max-width:1100px){.side{width:260px}.row{grid-template-columns:150px 1fr auto 60px}}`;

function placeMain(){
  if(!S.open){mainHost.style.display='none';return}
  const m=document.querySelector('div[role="main"]');let r=m?.getBoundingClientRect();
  const top=r&&r.width>300?r.top:64,left=r&&r.width>300?r.left:(navHost.dataset.floating?16:256);
  Object.assign(mainHost.style,{display:'block',top:top+'px',left:left+'px',width:(innerWidth-left-16)+'px',height:(innerHeight-top-12)+'px'});
}
setInterval(placeMain,500);addEventListener('resize',placeMain);
// Clicking anything in Gmail that navigates (Inbox, a label, an email) closes the shared-inbox pane.
addEventListener('hashchange',()=>{if(S.open)closePane()});
// Any click in Gmail's own sidebar (labels, Hiver views, etc.) or top bar hands the screen back to Gmail.
document.addEventListener('click',e=>{
  if(!S.open)return;const path=e.composedPath();
  if(path.includes(navHost)||path.includes(mainHost))return;
  if(e.target.closest?.('[role="navigation"],header,[role="banner"]'))closePane();
},true);

function closePane(){leaveThread();S.compose=null;S.open=false;placeMain();renderNav()}
function openView(v,assignee=null){leaveThread();S.compose=null;S.view=v;S.viewAssignee=assignee;S.open=true;S.q='';S.threads=[];placeMain();renderNav();renderMain();loadThreads()}
function openCompose(){leaveThread();S.compose={from:'shared',to:'',cc:'',bcc:'',subject:'',body:'',error:'',sending:false};S.open=true;placeMain();renderNav();renderMain()}

function renderMain(){
  if(!S.open)return;
  const pane=h('div',{class:'pane'});
  if(!S.signedIn){
    pane.append(h('div',{class:'empty'},h('strong',{},'Sign in to Fredver'),h('p',{},'Use your @columbiabasininsurance.com Google account.'),h('button',{class:'btn',onclick:()=>doSignIn()},'Sign in with Google')));
  }else if(S.compose)pane.append(...renderCompose());
  else if(S.threadId)pane.append(...renderConversation());
  else pane.append(...renderList());
  const keep=['.list','.thread','.side'].map(sel=>[sel,main.querySelector(sel)?.scrollTop||0]);
  main.replaceChildren(h('style',{},MAINCSS),pane);
  for(const [sel,top] of keep){const e=main.querySelector(sel);if(e&&top)e.scrollTop=top}
}

function renderList(){
  const who=S.members.find(m=>m.id===S.viewAssignee);
  const label=S.view==='assignee'?'Assigned to '+(who?.display_name||who?.email||'teammate'):VIEWS.find(v=>v[0]===S.view)[1];
  const search=h('input',{class:'search',type:'search',placeholder:'Search subject, sender or text',value:S.q,'aria-label':'Search conversations',
    onkeydown:e=>{if(e.key==='Enter'){S.q=e.target.value;loadThreads()}}});
  const bar=h('div',{class:'bar'},h('h2',{},label),h('span',{class:'sub'},S.inbox?S.inbox.email:''),search,
    iconBtn('refresh','Refresh',()=>{loadThreads();loadCounts()}),iconBtn('close','Close shared inbox',closePane));
  const list=h('div',{class:'list'});
  if(S.error)list.append(h('div',{class:'err'},S.error));
  if(S.listLoading&&!S.threads.length)list.append(h('div',{class:'loading'},'Loading…'));
  else if(!S.threads.length)list.append(h('div',{class:'empty'},h('strong',{},S.q?'No matches':'Nothing here'),
    S.q?'Try a different search.':(S.view==='unassigned'?'Every open conversation has an owner.':S.view==='sent'?'Emails your team sends from the shared inbox appear here.':'No conversations in this view.')));
  for(const t of S.threads){
    list.append(h('button',{class:'row',onclick:()=>openThread(t.id)},
      h('div',{class:'from',title:t.from_email},t.from_name||t.from_email||'(unknown)',t.message_count>1?h('small',{},t.message_count):null),
      h('div',{class:'subj'},t.subject,h('span',{},t.snippet?' — '+t.snippet:'')),
      h('div',{class:'meta'},
        S.view==='sent'&&t.sent_by?h('span',{class:'chip',title:'Last sent by '+t.sent_by+' · '+full(t.sent_at)},'↗ Sent by '+t.sent_by):null,
        t.note_count?h('span',{class:'chip none',title:'Internal notes'},'📝 '+t.note_count):null,
        h('span',{class:'pill '+t.status},STATUS[t.status]),
        t.assignee_name?h('span',{class:'chip',title:'Assigned to '+t.assignee_name},h('span',{class:'av'},initials(t.assignee_name)),t.assignee_name):h('span',{class:'chip none'},'Unassigned')),
      h('div',{class:'time',title:full(S.view==='sent'?t.sent_at:t.last_message_at)},when(S.view==='sent'?t.sent_at:t.last_message_at))));
  }
  return [bar,list];
}

function messageBody(m){
  if(m.html){
    const f=h('iframe',{sandbox:'allow-same-origin allow-popups allow-popups-to-escape-sandbox',title:'Message from '+nameOf(m.from),referrerpolicy:'no-referrer'});
    // No allow-scripts: email HTML is displayed but nothing in it can run. CSP blocks forms, frames and plugins.
    f.srcdoc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\' https:; font-src https: data:"><base target="_blank"><style>body{margin:0;font:14px/1.5 Arial,sans-serif;color:#202124;overflow-wrap:anywhere}img{max-width:100%;height:auto}blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex}</style>'+m.html;
    const fit=()=>{try{f.style.height=(f.contentDocument.documentElement.scrollHeight+4)+'px'}catch{}};
    f.addEventListener('load',()=>{fit();setTimeout(fit,400);setTimeout(fit,1500)});
    return f;
  }
  return h('pre',{},m.text||m.snippet||'(no content)');
}

const fmtSize=n=>!n?'':n<1024?n+' B':n<1048576?Math.round(n/1024)+' KB':(n/1048576).toFixed(1)+' MB';
// Open PDFs/images in a new tab through the extension's viewer page, or download anything else.
async function openAttachment(path,name,view){
  try{
    if(view)return void await call('view',{path});
    const f=await call('download',{path});
    const bytes=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:f.type}));
    const a=document.createElement('a');a.href=url;a.download=f.name||name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(e){alert('Could not open attachment: '+e.message)}
}
// Files picked to send. Read as base64 only when sending.
const MAX_FILES=20*1024*1024;
function attachPicker(target){
  target.files=target.files||[];
  const input=h('input',{type:'file',multiple:true,style:'display:none',onchange:e=>{
    const total=[...target.files,...e.target.files].reduce((n,f)=>n+f.size,0);
    if(total>MAX_FILES){alert('Attachments can be up to 20 MB in total.');return}
    target.files=[...target.files,...e.target.files];renderMain();
  }});
  return h('div',{class:'attpick'},input,
    h('button',{class:'btn ghost small',onclick:()=>input.click()},svg(ICON.attach),'Attach files'),
    target.files.map((f,i)=>h('span',{class:'att'},f.name,h('small',{},fmtSize(f.size)),
      h('button',{class:'attx',title:'Remove '+f.name,'aria-label':'Remove '+f.name,onclick:()=>{target.files.splice(i,1);renderMain()}},'×'))));
}
const readFiles=files=>Promise.all((files||[]).map(f=>new Promise((res,rej)=>{
  const r=new FileReader();r.onload=()=>res({filename:f.name,mimeType:f.type||'application/octet-stream',data:String(r.result).split(',')[1]||''});r.onerror=()=>rej(Error('Could not read '+f.name));r.readAsDataURL(f);
})));

// Gmail-style attachment cards: first-page preview, file-type badge, name; hover for size/download.
const thumbs=new Map();
const fileKind=a=>{const e=(a.filename.split('.').pop()||'').toLowerCase(),t=a.mimeType||'';
  if(t==='application/pdf'||e==='pdf')return ['PDF','#d93025'];if(t.startsWith('image/'))return ['IMG','#1a73e8'];
  if(/word|document/.test(t)||/^docx?$/.test(e))return ['DOC','#4285f4'];if(/sheet|excel|csv/.test(t)||/^(xlsx?|csv)$/.test(e))return ['XLS','#188038'];
  return [(e||'FILE').slice(0,4).toUpperCase(),'#5f6368']};
function attachmentCards(m){
  const base=a=>`/api/threads/${S.threadId}/attachments/${encodeURIComponent(m.id)}/${encodeURIComponent(a.partId)}`;
  const wrap=h('div',{class:'attwrap'});
  wrap.append(h('div',{class:'atthead'},h('b',{},`${m.attachments.length} Attachment${m.attachments.length>1?'s':''}`),
    h('button',{class:'link',onclick:async()=>{for(const a of m.attachments)await openAttachment(base(a),a.filename,false)}},'⬇ Download all')));
  const grid=h('div',{class:'attgrid'});
  for(const a of m.attachments){
    const [kind,color]=fileKind(a),viewable=/^(application\/pdf|image\/|text\/plain)/.test(a.mimeType||'');
    const preview=h('div',{class:'attprev'},h('span',{class:'bigkind',style:`color:${color}`},kind));
    const key=base(a)+'/thumb';
    const show=src=>{if(src)preview.replaceChildren(h('img',{src,alt:'Preview of '+a.filename}))};
    if(thumbs.has(key))show(thumbs.get(key));
    else if(kind==='PDF'||kind==='IMG')call('download',{path:key}).then(f=>{const src='data:'+f.type+';base64,'+f.base64;thumbs.set(key,src);show(src)}).catch(()=>thumbs.set(key,''));
    grid.append(h('div',{class:'attcard',title:a.filename},
      h('button',{class:'attmain','aria-label':(viewable?'Open ':'Download ')+a.filename,onclick:()=>openAttachment(base(a),a.filename,viewable)},preview,
        h('div',{class:'attfoot'},h('span',{class:'kind',style:`background:${color}`},kind),h('span',{class:'nm'},a.filename))),
      h('div',{class:'atthover'},h('span',{class:'nm'},a.filename),h('small',{},fmtSize(a.size)),
        h('div',{class:'acts'},
          viewable?h('button',{title:'Open','aria-label':'Open '+a.filename,onclick:()=>openAttachment(base(a),a.filename,true)},'↗'):null,
          h('button',{title:'Download','aria-label':'Download '+a.filename,onclick:()=>openAttachment(base(a),a.filename,false)},'⬇')))));
  }
  wrap.append(grid);return wrap;
}

function renderConversation(){
  const d=S.detail;
  const bar=h('div',{class:'bar'},iconBtn('back','Back to list',()=>{leaveThread();renderNav();renderMain();loadThreads()}),
    h('span',{class:'sub'},d?d.thread.inbox_name:''),h('span',{style:'margin-left:auto'}),iconBtn('close','Close shared inbox',closePane));
  if(!d)return [bar,h('div',{class:'loading'},S.error?h('div',{class:'err'},S.error):'Loading conversation…')];
  const t=d.thread,mailbox=t.inbox_email.toLowerCase();
  const th=h('div',{class:'thread'});
  th.append(h('h1',{},t.subject));
  th.append(h('div',{id:'banner'}));
  d.messages.forEach((m,i)=>{
    const last=i===d.messages.length-1,open=last||S.expanded.has(m.id);
    const us=(m.from||'').toLowerCase().includes(mailbox);
    const card=h('div',{class:'msg'});
    card.append(h('div',{class:'head',onclick:()=>{if(last)return;S.expanded.has(m.id)?S.expanded.delete(m.id):S.expanded.add(m.id);renderMain()}},
      h('div',{class:'bigav'+(us?' us':'')},initials(nameOf(m.from))),
      h('div',{class:'who'},h('b',{},nameOf(m.from)),' ',h('small',{},(m.from.match(/<([^>]+)>/)||[])[1]||''),
        (d.sentBy?.[m.id]||d.sentBy?.[m.rfcId])?h('span',{class:'chip',style:'margin-left:6px'},'Sent by '+(d.sentBy[m.id]||d.sentBy[m.rfcId])):null,
        open?h('div',{class:'to'},'to '+[m.to,m.cc].filter(Boolean).join(', ')):h('div',{class:'snip'},m.snippet)),
      h('div',{class:'date',title:full(m.date)},when(m.date))));
    if(open){
      card.append(h('div',{class:'body'},messageBody(m)));
      if(m.attachments?.length)card.append(attachmentCards(m));
    }
    th.append(card);
  });
  th.append(renderReply());
  return [bar,h('div',{class:'conv'},th,renderSide())];
}

const splitAddr=v=>(v||'').split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean);
const addrOf=v=>{const m=(v||'').match(/<([^>]+)>/);return (m?m[1]:v||'').trim().toLowerCase()};
const listAddrs=v=>(v||'').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(addrOf).filter(Boolean);
const internal=e=>e.endsWith('@'+CONFIG_DOMAIN);
const CONFIG_DOMAIN='columbiabasininsurance.com';
const fromOptions=()=>[['shared',`${S.inbox?.name||'Shared inbox'} <${S.inbox?.email||''}>`],['me',`${S.me?.display_name||'Me'} <${S.me?.email||S.email}> (my address)`]];
const fromHint=f=>f==='me'?`Sent from your own mailbox. A hidden copy goes to ${S.inbox?.email} so the team sees it in this conversation.`
  :`Sent from ${S.inbox?.email}. Visible to everyone in ${S.inbox?.name||'the shared inbox'}.`;

let sigOn=store.get('sig')!=='0';
function signatureBlock(){
  const box=h('div',{class:'sigbox'});
  const cb=h('input',{type:'checkbox',checked:sigOn,onchange:e=>{sigOn=e.target.checked;store.set('sig',sigOn?'1':'0');renderMain()}});
  box.append(h('label',{class:'sigtoggle'},cb,S.signature===null?'Loading your Gmail signature…':S.signature?'Add my Gmail signature':'No Gmail signature found (set one in Gmail Settings → General → Signature)'));
  if(sigOn&&S.signature){
    const f=h('iframe',{class:'sigprev',sandbox:'allow-same-origin',title:'Signature preview',referrerpolicy:'no-referrer'});
    f.srcdoc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\'"><style>body{margin:0;font:13px Arial,sans-serif;color:#202124}img{max-width:100%}</style>'+S.signature;
    f.addEventListener('load',()=>{try{f.style.height=(f.contentDocument.documentElement.scrollHeight+4)+'px'}catch{}setTimeout(()=>{try{f.style.height=(f.contentDocument.documentElement.scrollHeight+4)+'px'}catch{}},600)});
    box.append(f);
  }
  return box;
}

function renderCompose(){
  const c=S.compose;
  const bar=h('div',{class:'bar'},h('h2',{},'New email'),h('span',{style:'margin-left:auto'}),iconBtn('close','Discard and close',()=>{S.compose=null;closePane()}));
  const field=(k,label,attrs={})=>h('label',{class:'cf'},h('span',{},label),h('input',{value:c[k],'aria-label':label,oninput:e=>{c[k]=e.target.value},...attrs}));
  const ta=h('textarea',{'aria-label':'Message',placeholder:'Write your message',oninput:e=>{c.body=e.target.value}});ta.value=c.body;
  const send=async()=>{
    c.error='';
    if(!splitAddr(c.to).length||!c.subject.trim()||!c.body.trim()){c.error='To, subject and message are required.';return renderMain()}
    c.sending=true;renderMain();
    try{const r=await api('/api/inboxes/'+S.inbox.id+'/compose','POST',{from:c.from||'shared',to:splitAddr(c.to),cc:splitAddr(c.cc),bcc:splitAddr(c.bcc),subject:c.subject,body:c.body,signature:sigOn&&!!S.signature,files:await readFiles(c.files)});
      S.compose=null;loadCounts();
      if(r.id)await openThread(r.id);else openView('sent');
    }catch(e){c.error=e.message.includes('Invalid')?'Check the email addresses.':e.message;c.sending=false;renderMain()}
  };
  const form=h('div',{class:'thread compose'},
    h('label',{class:'cf'},h('span',{},'From'),h('select',{class:'plain','aria-label':'From',onchange:e=>{c.from=e.target.value;renderMain()}},
      fromOptions().map(([v,l])=>h('option',{value:v,selected:(c.from||'shared')===v},l)))),
    field('to','To',{placeholder:'client@example.com, another@example.com'}),field('cc','Cc'),field('bcc','Bcc'),field('subject','Subject'),ta,attachPicker(c),signatureBlock(),
    h('div',{class:'hint'},fromHint(c.from||'shared')+' The conversation is assigned to you.'),
    c.error?h('div',{class:'err'},c.error):null,
    h('div',{class:'acts'},h('button',{class:'btn',disabled:c.sending,onclick:send},c.sending?'Sending…':'Send'),
      h('button',{class:'btn ghost',onclick:()=>{S.compose=null;openView(S.view,S.viewAssignee)}},'Discard')));
  return [bar,form];
}

// Default recipients for each reply type, Gmail-style. Users can edit them before sending.
function replyDefaults(mode){
  const msgs=S.detail.messages;
  const target=[...msgs].reverse().find(m=>!internal(addrOf(m.from)))||msgs.at(-1);
  if(mode==='forward')return {to:'',cc:'',bcc:''};
  const to=listAddrs(target.replyTo||target.from);
  const cc=mode==='replyAll'?[...listAddrs(target.to),...listAddrs(target.cc)].filter(a=>a!==S.inbox?.email&&a!==S.me?.email&&!to.includes(a)):[];
  return {to:to.join(', '),cc:[...new Set(cc)].join(', '),bcc:''};
}
function startReply(mode){
  const keep=S.reply;
  S.reply={mode,from:keep?.from||'shared',body:keep?.body||'',showCc:false,attach:true,error:'',sending:false,...replyDefaults(mode)};
  if(S.reply.cc)S.reply.showCc=true;
  renderMain();
  setTimeout(()=>main.querySelector(mode==='forward'?'.rto input':'.reply textarea')?.focus(),0);
}

function renderReply(){
  const r=S.reply;
  const MODES={reply:'↩ Reply',replyAll:'↩↩ Reply all',forward:'↪ Forward'};
  if(!r)return h('div',{class:'replybtns'},Object.entries(MODES).map(([k,v])=>h('button',{class:'btn ghost',onclick:()=>startReply(k)},v)));
  const box=h('div',{class:'reply'});
  const last=S.detail.messages.at(-1);
  const atts=r.mode==='forward'?([...S.detail.messages].reverse().find(m=>!internal(addrOf(m.from)))||last).attachments||[]:[];
  const send=async status=>{
    r.error='';
    if(!splitAddr(r.to).length){r.error='Add at least one recipient.';return renderMain()}
    if(!r.body.trim()){r.error='Write a message first.';return renderMain()}
    r.sending=true;renderMain();
    try{
      await api('/api/threads/'+S.threadId+'/send','POST',{mode:r.mode,from:r.from,to:splitAddr(r.to),cc:splitAddr(r.cc),bcc:splitAddr(r.bcc),body:r.body,includeAttachments:r.attach,signature:sigOn&&!!S.signature,files:await readFiles(r.files),...(status?{status}:{})});
      S.reply=null;S.replying=false;await loadDetail();loadCounts();
    }catch(e){r.error=e.message.includes('Invalid')?'Check the email addresses.':e.message;r.sending=false;renderMain()}
  };
  const line=(k,label,cls)=>h('label',{class:'rl '+(cls||'')},h('span',{},label),h('input',{value:r[k],'aria-label':label,oninput:e=>{r[k]=e.target.value}}));
  const ta=h('textarea',{'aria-label':'Message',placeholder:r.mode==='forward'?'Add a message (optional context for the recipient)':'Write your reply',
    oninput:()=>{r.body=ta.value;if(!S.replying&&ta.value.trim()){S.replying=true;heartbeat()}}});ta.value=r.body;
  box.append(...[
    h('div',{class:'rbanner'+(r.from==='me'?' me':'')},fromHint(r.from)),
    h('div',{class:'rhead'},
      h('select',{class:'mode','aria-label':'Reply type',onchange:e=>startReply(e.target.value)},Object.entries(MODES).map(([k,v])=>h('option',{value:k,selected:r.mode===k},v))),
      h('label',{class:'from'},'From',h('select',{'aria-label':'Send from',onchange:e=>{r.from=e.target.value;renderMain()}},
        fromOptions().map(([v,l])=>h('option',{value:v,selected:r.from===v},l)))),
      !r.showCc?h('button',{class:'link',onclick:()=>{r.showCc=true;renderMain()}},'Cc/Bcc'):null,
      iconBtn('close','Discard reply',()=>{S.reply=null;S.replying=false;renderMain()})),
    line('to','To','rto'),
    r.showCc?line('cc','Cc'):null,r.showCc?line('bcc','Bcc'):null,
    ta,attachPicker(r),signatureBlock(),
    atts.length?h('label',{class:'attrow'},h('input',{type:'checkbox',checked:r.attach,onchange:e=>{r.attach=e.target.checked}}),
      `Include ${atts.length} attachment${atts.length>1?'s':''}: `+atts.map(a=>a.filename).join(', ')):null,
    h('div',{class:'hint'},r.mode==='forward'?'The original message is included below your text.':'The previous message is quoted below your reply.'),
    r.error?h('div',{class:'err'},r.error):null,
    h('div',{class:'acts'},
      h('button',{class:'btn',disabled:r.sending,onclick:()=>send()},r.sending?'Sending…':'Send'),
      h('button',{class:'btn close',disabled:r.sending,onclick:()=>send('closed')},'Send & Close'),
      h('button',{class:'btn ghost',disabled:r.sending,onclick:()=>send('pending')},'Send & mark Pending'))].filter(Boolean));
  return box;
}

function renderSide(){
  const d=S.detail,t=d.thread;
  const side=h('div',{class:'side'});
  const patch=async body=>{try{await api('/api/threads/'+t.id,'PATCH',body);await loadDetail();loadCounts()}catch(e){alert(e.message)}};
  side.append(h('div',{class:'props'},
    h('span',{class:'k'},'Inbox'),h('span',{class:'v',title:t.inbox_email},svg(ICON.inbox),t.inbox_name),
    h('span',{class:'k'},'Assignee'),h('span',{class:'v'},
      h('select',{class:'plain','aria-label':'Assignee',onchange:e=>patch({assigneeId:e.target.value||null})},
        h('option',{value:''},'None'),S.members.map(m=>h('option',{value:m.id,selected:m.id===t.assignee_id},(m.display_name||m.email)+(m.id===S.me?.id?' (me)':''))))),
    h('span',{class:'k'},'Status'),h('span',{class:'v'},
      h('select',{class:'plain st '+t.status,'aria-label':'Status',onchange:e=>patch({status:e.target.value})},
        Object.entries(STATUS).map(([k,v])=>h('option',{value:k,selected:t.status===k},v))))));
  if(t.assignee_id!==S.me?.id)side.append(h('button',{class:'link',style:'margin:2px 0 0 96px',onclick:()=>patch({assigneeId:S.me.id})},'Assign to me'));
  side.append(h('h3',{},'Activity & notes'));
  const ta=h('textarea',{placeholder:'Add a note for your team…','aria-label':'New internal note'});
  side.append(h('div',{class:'notebox'},ta,h('button',{class:'btn',onclick:async e=>{if(!ta.value.trim())return;e.target.disabled=true;
    try{await api('/api/threads/'+t.id+'/notes','POST',{body:ta.value});await loadDetail()}catch(err){alert(err.message);e.target.disabled=false}}},'Add')));
  const items=[...d.notes.map(n=>({at:n.created_at,note:n})),...d.activity.map(a=>({at:a.created_at,act:a}))].sort((x,y)=>new Date(y.at)-new Date(x.at));
  if(!items.length)side.append(h('div',{class:'hint'},'Only your team sees notes. They are never emailed.'));
  for(const it of items)side.append(it.note?h('div',{class:'note'},h('small',{},it.note.display_name+' · '+full(it.at)),it.note.body)
    :h('div',{class:'act',title:full(it.at)},describe(it.act),' · ',when(it.at)));
  return side;
}
function describe(a){
  const who=a.display_name||'System',m=a.metadata||{};
  if(a.action==='thread.status')return `${who} changed status to ${STATUS[m.to]||m.to}`;
  if(a.action==='thread.assigned')return m.to?`${who} assigned to ${m.to}`:`${who} unassigned`;
  if(a.action==='reply.sent')return `${who} replied${m.from&&m.from!==S.inbox?.email?' from '+m.from:''}`;
  if(a.action==='forward.sent')return `${who} forwarded to ${(m.to||[]).join(', ')}`;
  if(a.action==='compose.sent')return `${who} started this conversation`;
  if(a.action==='thread.reopened')return 'Reopened by a new client message';
  return `${who} updated the conversation`;
}
function renderBanner(viewers){
  const b=main.getElementById('banner');if(!b)return;
  b.replaceChildren(...(viewers||[]).map(v=>h('div',{class:'banner'},v.activity==='replying'?`⚠ ${v.display_name} is writing a reply to this conversation`:`👁 ${v.display_name} is viewing this conversation`)));
}

// ---------- data ----------
async function switchAccount(){await call('signout').catch(()=>{});Object.assign(S,{signedIn:false,email:'',me:null,inboxes:[],inbox:null,counts:{},members:[],authError:''});closePane();await doSignIn()}
async function doSignIn(){try{await call('auth');S.signedIn=true;await boot()}catch(e){if(S.open){S.error=e.message;renderMain()}}}
async function boot(){
  const st=await call('status').catch(()=>({}));S.signedIn=!!st.signedIn;S.email=st.email||'';S.authError='';renderNav();
  if(!S.signedIn)return renderMain();
  try{
    [S.me,S.inboxes]=await Promise.all([api('/api/me'),api('/api/inboxes')]);
    api('/api/me/signature').then(r=>{S.signature=r.html||'';if(S.reply||S.compose)renderMain()}).catch(()=>{S.signature=''});
    S.inbox=S.inbox&&S.inboxes.find(i=>i.id===S.inbox.id)||S.inboxes[0]||null;
    await loadInbox();
  }catch(e){
    S.error=e.message;
    if(/not provisioned|403/i.test(e.message))S.authError=`${S.email||'This account'} isn't set up for Fredver. Sign in with your own work account (not the shared info@ mailbox).`;
    else S.authError='Could not load the shared inbox: '+e.message;
    renderNav();renderMain();
  }
}
const searchFocused=()=>main.activeElement?.classList?.contains('search');
async function loadInbox(){if(!S.inbox)return renderNav();S.members=await api('/api/inboxes/'+S.inbox.id+'/members');await loadCounts();if(S.open&&!S.threadId)loadThreads();else renderMain()}
async function loadCounts(){if(!S.inbox)return;try{S.counts=await api('/api/inboxes/'+S.inbox.id+'/counts');renderNav()}catch{}}
async function loadThreads(){
  if(!S.inbox)return;const first=!S.threads.length;S.listLoading=true;S.error='';if(first)renderMain();
  try{S.threads=await api('/api/threads?'+new URLSearchParams({inboxId:S.inbox.id,view:S.view,...(S.viewAssignee&&S.view==='assignee'?{assigneeId:S.viewAssignee}:{}),...(S.q?{q:S.q}:{})}))}catch(e){S.error=e.message}
  S.listLoading=false;if(!S.threadId&&!S.compose&&!searchFocused())renderMain();
}
async function openThread(id){S.threadId=id;S.detail=null;S.expanded=new Set();S.replying=false;S.reply=null;S.error='';renderNav();renderMain();await loadDetail()}
async function loadDetail(){
  const id=S.threadId;
  try{const d=await api('/api/threads/'+id);if(S.threadId!==id)return;S.detail=d;renderMain();renderBanner(d.viewers)}
  catch(e){S.error=e.message;renderMain()}
}
async function heartbeat(){
  if(!S.threadId||!S.detail)return;
  try{const r=await api('/api/threads/'+S.threadId+'/presence','POST',{activity:S.replying?'replying':'viewing'});renderBanner(r.viewers)}catch{}
}
function leaveThread(){
  if(S.threadId)api('/api/threads/'+S.threadId+'/presence','POST',{activity:'left'}).catch(()=>{});
  S.threadId=null;S.detail=null;S.replying=false;S.reply=null;
}
setInterval(()=>{if(S.open&&S.threadId)heartbeat()},15000);
// Refresh every 15 seconds while Gmail is visible (paused in background tabs).
setInterval(()=>{if(!S.signedIn||document.hidden)return;loadCounts();if(S.open&&!S.threadId&&!S.compose&&!S.listLoading)loadThreads()},15000);
addEventListener('beforeunload',leaveThread);

renderNav();boot();
})();
