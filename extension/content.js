(()=>{
if(window.__fredvir)return;window.__fredvir=true;

const VIEWS=[['unassigned','Unassigned'],['mine','Assigned to me'],['open','Open'],['pending','Pending'],['overdue','Overdue'],['closed','Closed'],['sent','Sent'],['all','All conversations'],['tag','Tag'],['search','Search results']];
const S={signedIn:false,email:'',me:null,signature:null,inboxes:[],inbox:null,view:'unassigned',viewAssignee:null,compose:null,q:'',threads:[],counts:{},members:[],open:false,
  threadId:null,detail:null,expanded:new Set(),replying:false,reply:null,listLoading:false,error:'',
  viewTag:null,tags:[],templates:[],notifs:{unread:0,items:[]},panel:null,report:null,team:null,settings:null,searchIds:[],prevView:'unassigned',menu:null};

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
  overdue:'M22 5.72 17.4 1.86l-1.29 1.53 4.6 3.86L22 5.72zM7.88 3.39 6.6 1.86 2 5.71l1.29 1.53 4.59-3.85zM12.5 8H11v6l4.75 2.85.75-1.23-4-2.37V8zM12 4a9 9 0 1 0 .01 18.01A9 9 0 0 0 12 4zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
  tag:'M21.41 11.58 12.41 2.58A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7A1.5 1.5 0 1 1 7 5.5 1.5 1.5 0 0 1 5.5 7z',
  bell:'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  chart:'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
  gear:'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 13.93 2h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.73 8.47a.48.48 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 15.6 12 3.6 3.6 0 0 1 12 15.6z',
  team:'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z'};
const NAV_LABEL={unassigned:'Unassigned',mine:'Mine',open:'Open',pending:'Pending',overdue:'Overdue',closed:'Closed',sent:'Sent',all:'All conversations'};
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
.row.red .t,.row.red .n{color:#c5221f}
.dot{width:10px;height:10px;border-radius:50%;margin:0 14px 0 4px;flex:none}
.hint2{color:#5f6368;font-size:12px;height:auto;padding-top:4px;padding-bottom:4px}
.badge{background:#c5221f;color:#fff;border-radius:10px;font-size:11px;font-weight:700;padding:0 6px;margin-left:8px}
.sep{height:1px;background:#e0e3e7;margin:6px 16px 6px 42px}
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
let navCollapsed=store.get('collapsed')==='1',teamOpen=store.get('team')==='1',tagsOpen=store.get('tags')!=='0';

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
    const active=(v,a=null)=>S.open&&!S.threadId&&!S.compose&&!S.panel&&S.view===v&&(v!=='assignee'||S.viewAssignee===a)&&(v!=='tag'||S.viewTag===a);
    wrap.append(h('button',{class:'row kid'+(S.open&&S.compose?' on':''),onclick:()=>openCompose()},svg(NAV_ICON.edit),h('span',{class:'t'},'New email')));
    for(const v of ['unassigned','mine','open','pending','overdue','closed','sent','all']){
      const n=S.counts[v],show=n>0&&['unassigned','mine','pending','overdue'].includes(v);
      wrap.append(h('button',{class:'row kid'+(active(v)?' on':'')+(v==='overdue'&&n>0?' red':''),onclick:()=>openView(v)},svg(NAV_ICON[v]),h('span',{class:'t'},NAV_LABEL[v]),
        show?h('span',{class:'n'+(v==='unassigned'||v==='mine'||v==='overdue'?' b':'')},n):null));
    }
    wrap.append(h('button',{class:'row kid','aria-expanded':String(tagsOpen),onclick:()=>{tagsOpen=!tagsOpen;store.set('tags',tagsOpen?'1':'0');renderNav()}},
      svg(NAV_ICON.tag),h('span',{class:'t'},'Tags'),svg(tagsOpen?NAV_ICON.chevD:NAV_ICON.chevR)));
    if(tagsOpen){
      if(!S.tags.length)wrap.append(h('div',{class:'row kid2 hint2'},'No tags yet. Add one from a conversation.'));
      for(const g of S.tags)wrap.append(h('button',{class:'row kid2'+(active('tag',g.id)?' on':''),onclick:()=>openView('tag',null,g.id)},
        h('span',{class:'dot',style:'background:'+g.color}),h('span',{class:'t'},g.name),g.open_count?h('span',{class:'n'},g.open_count):null));
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
    wrap.append(h('button',{class:'row kid'+(S.open&&S.panel==='scheduled'?' on':''),onclick:()=>openPanel('scheduled')},svg(NAV_ICON.pending),h('span',{class:'t'},'Scheduled'),
      S.counts.scheduled?h('span',{class:'n'},S.counts.scheduled):null));
    wrap.append(h('div',{class:'sep'}));
    wrap.append(h('button',{class:'row kid'+(S.open&&S.panel==='notifications'?' on':''),onclick:()=>openPanel('notifications')},svg(NAV_ICON.bell),h('span',{class:'t'},'Notifications'),
      S.notifs.unread?h('span',{class:'badge'},S.notifs.unread):null));
    wrap.append(h('button',{class:'row kid'+(S.open&&S.panel==='reports'?' on':''),onclick:()=>openPanel('reports')},svg(NAV_ICON.chart),h('span',{class:'t'},'Reports')));
    if(S.me?.role==='admin')wrap.append(h('button',{class:'row kid'+(S.open&&S.panel==='settings'?' on':''),onclick:()=>openPanel('settings')},svg(NAV_ICON.gear),h('span',{class:'t'},'Settings')));
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
.row .subj .s{font-weight:400}
.row:not(.unread){background:#f6f8fc}
.row:not(.unread) .from{font-weight:400}
.row.unread .subj .s{font-weight:700}
.tagc{display:inline-block;font-size:11px;font-weight:600;border:1px solid;border-radius:4px;padding:0 5px;margin-right:6px;vertical-align:1px}
.sla{font-size:11px;font-weight:700;border-radius:10px;padding:1px 8px;white-space:nowrap}
.sla.over{background:#fce8e6;color:#c5221f}.sla.soon{background:#fef0e0;color:#b06000}.sla.due{background:#e8f0fe;color:#174ea6}
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
.reply{margin:16px 0 0;border-radius:12px;box-shadow:0 1px 2px #3c40434d,0 2px 6px 2px #3c404326;background:#fff;position:relative}
.reply>.rbanner{border-radius:12px 12px 0 0}
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
.tb{display:flex;flex-wrap:wrap;gap:2px;align-items:center;padding:4px 10px;border-bottom:1px solid var(--line);background:#fafbfc}
.compose .tb{border:1px solid var(--line);border-bottom:0;border-radius:8px 8px 0 0;margin-top:8px}
.tbb{padding:4px 8px;border-radius:4px;font-size:13px;color:#3c4043}
.tbb:hover{background:#e8eaed}
.tplwrap{position:relative;margin-left:auto}
.tplbtn{font-weight:600;color:var(--g)}
.menu[hidden]{display:none}
.menu{position:absolute;right:0;bottom:100%;margin-bottom:4px;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 4px 16px #0003;min-width:260px;max-height:320px;overflow:auto;z-index:5;padding:4px 0}
.mi{display:flex;align-items:center}
.mit{flex:1;text-align:left;padding:8px 12px;font-size:13px}.mit:hover{background:#f1f3f4}
.mix{padding:4px 10px;color:var(--mut)}.mix:hover{color:#c5221f}
.mia{display:block;width:100%;text-align:left;padding:8px 12px;font-size:13px;color:var(--g);font-weight:600;border-top:1px solid var(--line)}
.mie{padding:8px 12px;font-size:12px;color:var(--mut)}.mie.small{font-size:11px;border-top:1px solid var(--line)}
.ed{min-height:150px;padding:12px 14px;outline:none;font-size:14px;line-height:1.5;overflow-wrap:anywhere}
.compose .ed{min-height:240px;border:1px solid var(--line);border-radius:0 0 8px 8px}
.ed.empty:before{content:attr(data-ph);color:#80868b;pointer-events:none}
.ed ul,.ed ol{margin:4px 0;padding-left:24px}.ed a{color:#0b57d0}
.review{width:auto;border-radius:18px;padding:6px 10px;font-size:13px}
.saved{font-size:12px;color:var(--mut);align-self:center}
.draftbar{display:flex;align-items:center;gap:12px;justify-content:space-between;background:#e8f0fe;color:#174ea6;border-radius:8px;padding:8px 12px;margin:16px 0 0 48px;font-size:13px;font-weight:500}
.linkbar{display:flex;gap:12px;align-items:center;justify-content:space-between;background:#f1f3f4;color:#3c4043;border-radius:8px;padding:8px 12px;margin:0 0 8px;font-size:13px}
.slaline{font-size:12px;font-weight:600;border-radius:6px;padding:6px 8px;margin-top:8px}.slaline.over{background:#fce8e6;color:#c5221f}.slaline.soon{background:#fef0e0;color:#b06000}.slaline.due{background:#e8f0fe;color:#174ea6}
.duein{width:auto;padding:3px 6px;font-size:12px}
.draftbar.bad{background:#fce8e6;color:#a50e0e}
.menu.up{bottom:100%;top:auto;right:0}
.schedwrap{margin-left:0}
.menu.up{min-width:360px}.mit.sched{display:flex;justify-content:space-between;gap:16px;white-space:nowrap}
.custom{display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--line)}
.custom input{width:auto;padding:4px 6px;font-size:12px}
.tagrow{display:grid;grid-template-columns:88px 1fr;align-items:start;margin-top:10px;font-size:13px}.tagrow .k{color:var(--mut);padding-top:4px}
.tagbox{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tagc{display:inline-block;font-size:11px;font-weight:600;border:1px solid;border-radius:4px;padding:0 5px}
.tagc.big{font-size:12px;padding:2px 4px 2px 8px;display:inline-flex;align-items:center;gap:2px}
.tagx{color:inherit;opacity:.7;padding:0 4px;font-size:14px}.tagx:hover{opacity:1}
.addtag{width:auto;padding:2px 6px;font-size:12px;border-style:dashed;border-radius:12px}
.panel{padding:8px 24px 32px}
.nrow{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;padding:12px 8px;border-bottom:1px solid #f1f3f4}
.nrow:hover{background:#f6f8fc}.nrow.unread{background:#eef5f1}.nrow .nt{flex:1;min-width:0;font-size:13px}.nrow .nq{color:var(--mut);margin-top:2px}
.nk{width:28px;height:28px;border-radius:50%;background:var(--gl);color:var(--g);display:grid;place-items:center;font-weight:700;flex:none}
.nrow .time{font-size:12px;color:var(--mut);white-space:nowrap}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin:12px 0}
.card{border:1px solid var(--line);border-radius:12px;padding:14px}.card .cv{font-size:26px;font-weight:600}.card .ck{font-size:12px;color:var(--mut)}.card.bad .cv{color:#c5221f}
.rh{font-size:15px;font-weight:600;margin:24px 0 10px}
.bars{display:flex;align-items:flex-end;gap:3px;height:140px;border-bottom:1px solid var(--line);padding-top:8px}
.barw{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-width:0}
.bar1{width:100%;background:var(--g2);border-radius:3px 3px 0 0;min-height:1px}.barw span{font-size:9px;color:var(--mut);margin-top:2px}
.tbl{border-collapse:collapse;width:100%;font-size:13px}.tbl th{text-align:left;color:var(--mut);font-weight:500;border-bottom:1px solid var(--line);padding:6px 8px}
.tbl td{padding:6px 8px;border-bottom:1px solid #f1f3f4}.tbl tr.off td{color:var(--mut)}
.cell{border:1px solid transparent;padding:4px 6px;width:auto}.cell:hover{border-color:var(--line)}
.tog{display:flex;gap:6px;align-items:center}.tog input{width:auto}
.addrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.addrow input{width:auto;flex:1;min-width:160px}.addrow select{width:auto}
.tpls{padding-left:18px;font-size:13px}.tpls li{margin:4px 0}
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

function closePane(){leaveThread();S.compose=null;S.panel=null;S.open=false;placeMain();renderNav()}
function openView(v,assignee=null,tag=null){leaveThread();S.compose=null;S.panel=null;S.view=v;S.viewAssignee=assignee;S.viewTag=tag;S.open=true;S.q='';S.threads=[];placeMain();renderNav();renderMain();loadThreads()}
function openCompose(){leaveThread();S.panel=null;S.compose={from:'shared',to:'',cc:'',bcc:'',subject:'',html:'',error:'',sending:false};S.open=true;placeMain();renderNav();renderMain()}
function openPanel(p){leaveThread();S.compose=null;S.panel=p;S.open=true;placeMain();renderNav();renderMain();loadPanel()}

function renderMain(){
  if(!S.open)return;
  const pane=h('div',{class:'pane'});
  if(!S.signedIn){
    pane.append(h('div',{class:'empty'},h('strong',{},'Sign in to Fredver'),h('p',{},'Use your @columbiabasininsurance.com Google account.'),h('button',{class:'btn',onclick:()=>doSignIn()},'Sign in with Google')));
  }else if(S.panel)pane.append(...renderPanel());
  else if(S.compose)pane.append(...renderCompose());
  else if(S.threadId)pane.append(...renderConversation());
  else pane.append(...renderList());
  const keep=['.list','.thread','.side'].map(sel=>[sel,main.querySelector(sel)?.scrollTop||0]);
  main.replaceChildren(h('style',{},MAINCSS),pane);
  for(const [sel,top] of keep){const e=main.querySelector(sel);if(e&&top)e.scrollTop=top}
}

function renderList(){
  const who=S.members.find(m=>m.id===S.viewAssignee),tag=S.tags.find(g=>g.id===S.viewTag);
  const label=S.view==='assignee'?'Assigned to '+(who?.display_name||who?.email||'teammate'):S.view==='tag'?'Tag: '+(tag?.name||''):S.view==='search'?'Search: '+S.q:VIEWS.find(v=>v[0]===S.view)[1];
  // Search runs Gmail's own search over the whole shared mailbox (all dates, full text, attachments' names).
  const search=h('input',{class:'search',type:'search',placeholder:'Search all mail (e.g. coverage from:carrier.com)',value:S.q,'aria-label':'Search all mail',
    onkeydown:e=>{if(e.key==='Enter')runSearch(e.target.value)}});
  const bar=h('div',{class:'bar'},h('h2',{},label),h('span',{class:'sub'},S.inbox?S.inbox.email:''),search,
    iconBtn('refresh','Refresh',()=>{loadThreads();loadCounts()}),iconBtn('close','Close shared inbox',closePane));
  const list=h('div',{class:'list'});
  if(S.error)list.append(h('div',{class:'err'},S.error));
  if(S.listLoading&&!S.threads.length)list.append(h('div',{class:'loading'},S.view==='search'?'Searching the whole mailbox…':'Loading…'));
  else if(!S.threads.length)list.append(h('div',{class:'empty'},h('strong',{},S.q?'No matches':'Nothing here'),
    S.q?'Try a different search.':(S.view==='unassigned'?'Every open conversation has an owner.':S.view==='sent'?'Emails your team sends from the shared inbox appear here.':'No conversations in this view.')));
  for(const t of S.threads){
    const due=slaState(t);
    list.append(h('button',{class:'row'+(t.unread?' unread':''),onclick:()=>openThread(t.id)},
      h('div',{class:'from',title:t.from_email},t.from_name||t.from_email||'(unknown)',t.message_count>1?h('small',{},t.message_count):null),
      h('div',{class:'subj'},(t.tags||[]).slice(0,2).map(g=>h('span',{class:'tagc',style:`background:${g.color}1f;color:${g.color};border-color:${g.color}55`},g.name)),
        h('b',{class:'s'},t.subject),h('span',{},t.snippet?' — '+t.snippet:'')),
      h('div',{class:'meta'},
        due?h('span',{class:'sla '+due.cls,title:due.title},due.label):null,
        t.draft_by?h('span',{class:'chip none',title:'Draft reply saved by '+t.draft_by},'✎ Draft · '+t.draft_by):null,
        t.source_mailbox?h('span',{class:'chip none',title:'Added from '+t.source_mailbox+'’s mailbox'},'📥 via '+((S.members.find(m=>m.email.toLowerCase()===t.source_mailbox.toLowerCase())||{}).display_name||t.source_mailbox.split('@')[0])):null,
        S.view==='sent'&&t.sent_by?h('span',{class:'chip',title:'Last sent by '+t.sent_by+' · '+full(t.sent_at)},'↗ Sent by '+t.sent_by):null,
        t.note_count?h('span',{class:'chip none',title:'Internal notes'},'📝 '+t.note_count):null,
        h('span',{class:'pill '+t.status},STATUS[t.status]),
        t.assignee_name?h('span',{class:'chip',title:'Assigned to '+t.assignee_name},h('span',{class:'av'},initials(t.assignee_name)),t.assignee_name):h('span',{class:'chip none'},'Unassigned')),
      h('div',{class:'time',title:full(S.view==='sent'?t.sent_at:t.last_message_at)},when(S.view==='sent'?t.sent_at:t.last_message_at))));
  }
  return [bar,list];
}

const dur=ms=>{const m=Math.round(ms/60000);if(m<60)return m+'m';const hh=Math.round(m/60);return hh<48?hh+'h':Math.round(hh/24)+'d'};
// SLA: open conversations waiting on us. Overdue once the client has waited longer than the inbox's SLA hours.
function slaState(t){
  if(t.due_at&&t.status!=='closed'){
    const left=new Date(t.due_at).getTime()-Date.now(),at=new Date(t.due_at).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    if(left<0)return {cls:'over',label:'Overdue '+dur(-left),title:'Due '+at};
    return {cls:left<3600e3?'soon':'due',label:'Due '+(left<864e5?'in '+dur(left):at.replace(/,? \d{1,2}:\d\d.*$/,'')),title:'Due '+at};
  }
  if(t.status!=='open'||!t.awaiting_reply||!t.last_client_message_at||!t.sla_hours)return null;
  const left=new Date(t.last_client_message_at).getTime()+t.sla_hours*3600e3-Date.now();
  if(left<0)return {cls:'over',label:'Overdue '+dur(-left),title:`No reply for ${dur(Date.now()-new Date(t.last_client_message_at))} (target ${t.sla_hours}h)`};
  if(left<3600e3)return {cls:'soon',label:'Due in '+dur(left),title:`Reply due within ${dur(left)}`};
  return null;
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
    h('span',{class:'sub'},d?d.thread.inbox_name:''),h('span',{style:'margin-left:auto'}),
    d?h('button',{class:'btn ghost small',onclick:async()=>{const id=S.threadId;leaveThread();await api('/api/threads/'+id+'/unread','POST').catch(()=>{});renderNav();renderMain();loadThreads()}},'Mark unread'):null,
    iconBtn('close','Close shared inbox',closePane));
  if(!d)return [bar,h('div',{class:'loading'},S.error?h('div',{class:'err'},S.error):'Loading conversation…')];
  const t=d.thread,mailbox=t.inbox_email.toLowerCase();
  const th=h('div',{class:'thread'});
  th.append(h('h1',{},t.subject));
  if(t.source_mailbox){
    const owner=S.members.find(m=>m.email.toLowerCase()===t.source_mailbox.toLowerCase());
    const mine=t.source_mailbox.toLowerCase()===S.me?.email?.toLowerCase();
    th.append(h('div',{class:'linkbar'},`📥 Added from ${mine?'your':(owner?.display_name||t.source_mailbox)+'’s'} mailbox. Replies from ${t.inbox_email} move it into the shared inbox once the client answers.`,
      (mine||S.me?.role==='admin')?h('button',{class:'link',onclick:async()=>{if(!confirm('Remove this conversation from the shared inbox? Notes and history in Fredver are deleted; the email stays in the mailbox.'))return;
        try{const id=S.threadId;leaveThread();await api('/api/threads/'+id+'/share','DELETE');shareCache.clear();loadCounts();renderNav();renderMain();loadThreads()}catch(e){alert(e.message)}}},'Remove from shared inbox'):null));
  }
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
  for(const sc of d.scheduled||[])th.append(h('div',{class:'draftbar '+(sc.status==='failed'?'bad':'')},
    sc.status==='failed'?`⚠ Scheduled reply by ${sc.by_name} failed: ${sc.error||'unknown error'}`:`⏰ Reply scheduled for ${fmtWhen(sc.send_at)} by ${sc.by_name}${sc.summary?.to?.length?' · to '+sc.summary.to.join(', '):''}`,
    (sc.actor_id===S.me?.id||S.me?.role==='admin')&&sc.status!=='sending'?h('button',{class:'btn small ghost',onclick:async()=>{
      if(sc.status!=='failed'&&!confirm('Cancel this scheduled reply? It will not be sent.'))return;
      try{await api('/api/scheduled/'+sc.id,'DELETE');await loadDetail();loadCounts()}catch(e){alert(e.message)}}},sc.status==='failed'?'Dismiss':'Cancel'):null));
  if(d.draft&&!S.reply)th.append(h('div',{class:'draftbar'},
    `✎ Draft reply by ${d.draft.author}${d.draft.updated_by!==d.draft.author?', edited by '+d.draft.updated_by:''} · ${when(d.draft.updated_at)}`,
    h('button',{class:'btn small',onclick:()=>openDraft(d.draft)},'Open draft')));
  th.append(renderReply());
  return [bar,h('div',{class:'conv'},th,renderSide())];
}

const splitAddr=v=>(v||'').split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean);
const addrOf=v=>{const m=(v||'').match(/<([^>]+)>/);return (m?m[1]:v||'').trim().toLowerCase()};
const listAddrs=v=>(v||'').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(addrOf).filter(Boolean);
const internal=e=>e.endsWith('@'+CONFIG_DOMAIN);
const CONFIG_DOMAIN='columbiabasininsurance.com';
const linkedSrc=()=>S.threadId&&S.detail?.thread?.source_mailbox?.toLowerCase()||'';
// For a conversation added from someone's own mailbox, only that person can reply from their address.
const fromOptions=()=>[['shared',`${S.inbox?.name||'Shared inbox'} <${S.inbox?.email||''}>`],['me',`${S.me?.display_name||'Me'} <${S.me?.email||S.email}> (my address)`]]
  .filter(([v])=>v!=='me'||!linkedSrc()||linkedSrc()===S.me?.email?.toLowerCase()||S.compose);
const fromHint=f=>linkedSrc()&&!S.compose?(f==='me'?'Sent from your own mailbox and kept in this conversation.':`Sent from ${S.inbox?.email}. When the client answers, this conversation moves into the shared inbox.`)
  :f==='me'?`Sent from your own mailbox. A hidden copy goes to ${S.inbox?.email} so the team sees it in this conversation.`
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

// ---------- schedule send picker ----------
const at=(d,h,m=0)=>{const x=new Date(d);x.setHours(h,m,0,0);return x};
function schedulePresets(){
  const now=new Date(),tom=new Date(now);tom.setDate(now.getDate()+1);
  const mon=new Date(now);mon.setDate(now.getDate()+((8-now.getDay())%7||7));
  const list=[];
  if(now.getHours()<15)list.push(['Later today','4:00 PM',at(now,16)]);
  list.push(['Tomorrow morning','8:00 AM',at(tom,8)],['Tomorrow afternoon','1:00 PM',at(tom,13)]);
  if(mon.toDateString()!==tom.toDateString())list.push(['Monday morning','8:00 AM',at(mon,8)]);
  return list;
}
const localInput=d=>{const z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`};
const fmtWhen=iso=>new Date(iso).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function schedulePicker(onPick,disabled){
  const menu=h('div',{class:'menu up',role:'menu',hidden:true});
  const custom=h('input',{type:'datetime-local','aria-label':'Custom send time',value:localInput(at(new Date(Date.now()+864e5),8))});
  menu.append(h('div',{class:'mie'},'Schedule send'),
    ...schedulePresets().map(([a,b,d])=>h('button',{class:'mit sched',role:'menuitem',onclick:()=>{menu.hidden=true;onPick(d)}},h('span',{},a),h('span',{class:'hint'},d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})+', '+b))),
    h('div',{class:'custom'},custom,h('button',{class:'btn small',onclick:()=>{const d=new Date(custom.value);if(isNaN(d)||d<Date.now()+60000)return alert('Pick a time at least a minute from now.');menu.hidden=true;onPick(d)}},'Schedule')));
  return h('div',{class:'tplwrap schedwrap'},h('button',{class:'btn ghost',disabled,title:'Schedule send','aria-haspopup':'menu',onclick:()=>{menu.hidden=!menu.hidden}},'⏰ Schedule'),menu);
}

// ---------- formatted editor with templates ----------
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function clientName(){
  const msgs=S.detail?.messages||[];const m=[...msgs].reverse().find(x=>!internal(addrOf(x.from)));
  return m?nameOf(m.from):'';
}
function fillTemplate(html,extra={}){
  const client=extra.client??clientName();const me=S.me?.display_name||'';
  const v={client_name:client,client_first_name:(client.split(/\s+/)[0]||''),my_name:me,my_first_name:me.split(/\s+/)[0]||''};
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g,(m,k)=>k in v?esc(v[k]):m);
}
function editor(target,{placeholder='',onInput,extra}={}){
  const ed=h('div',{class:'ed',contenteditable:'true',role:'textbox','aria-multiline':'true','aria-label':'Message','data-ph':placeholder});
  ed.innerHTML=target.html||'';
  const changed=()=>{target.html=ed.innerHTML;ed.classList.toggle('empty',!ed.textContent.trim());onInput?.()};
  ed.addEventListener('input',changed);
  // Paste as plain text so pasted web pages don't bring odd fonts/colors into client emails.
  ed.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'))});
  // Only focus when the editor isn't already focused: focusing again would move the cursor to the start.
  const cmd=(c,v)=>{if(main.activeElement!==ed)ed.focus();document.execCommand(c,false,v);changed()};
  const b=(label,title,fn,cls='')=>h('button',{class:'tbb '+cls,title,'aria-label':title,onmousedown:e=>{e.preventDefault();fn()}},label);
  // The menu opens in place (no redraw), so the cursor stays where the template should go.
  const menu=h('div',{class:'menu',role:'menu',hidden:true});
  const insertTpl=t=>{menu.hidden=true;if(main.activeElement!==ed){ed.focus();const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);const sel=getSelection();sel.removeAllRanges();sel.addRange(r)}
    document.execCommand('insertHTML',false,fillTemplate(t.body_html,extra));changed()};
  const fillMenu=()=>menu.replaceChildren(
    ...(S.templates.length?S.templates.map(t=>h('div',{class:'mi'},
      h('button',{class:'mit',role:'menuitem',onmousedown:e=>{e.preventDefault();insertTpl(t)}},t.name),
      h('button',{class:'mix',title:'Delete template','aria-label':'Delete template '+t.name,onmousedown:async e=>{e.preventDefault();if(!confirm(`Delete the template "${t.name}" for everyone?`))return;
        try{await api('/api/templates/'+t.id,'DELETE');await loadTemplates();fillMenu()}catch(err){alert(err.message)}}},'×'))):[h('div',{class:'mie'},'No templates yet')]),
    h('button',{class:'mia',role:'menuitem',onmousedown:async e=>{e.preventDefault();
      if(!ed.textContent.trim())return alert('Write the template text in the message box first.');
      const name=prompt('Template name (e.g. "COI request reply"):');if(!name)return;
      try{await api('/api/inboxes/'+S.inbox.id+'/templates','POST',{name,bodyHtml:ed.innerHTML});await loadTemplates();fillMenu();menu.hidden=true}catch(err){alert(err.message)}}},'+ Save message as template'),
    h('div',{class:'mie small'},'Placeholders: {{client_first_name}}, {{client_name}}, {{my_first_name}}, {{my_name}}'));
  const tpl=h('div',{class:'tplwrap'},
    h('button',{class:'tbb tplbtn','aria-haspopup':'menu',onmousedown:e=>{e.preventDefault();if(menu.hidden)fillMenu();menu.hidden=!menu.hidden}},'Templates ▾'),menu);
  const tb=h('div',{class:'tb'},
    b(h('b',{},'B'),'Bold',()=>cmd('bold')),b(h('i',{},'I'),'Italic',()=>cmd('italic')),b(h('u',{},'U'),'Underline',()=>cmd('underline')),
    b('• List','Bulleted list',()=>cmd('insertUnorderedList')),b('1. List','Numbered list',()=>cmd('insertOrderedList')),
    b('🔗 Link','Insert link',()=>{const u=prompt('Link address (https://…)');if(!u)return;if(!/^(https?:\/\/|mailto:|tel:)/i.test(u))return alert('Use a full address starting with https://');cmd('createLink',u)}),
    b('Clear','Remove formatting',()=>cmd('removeFormat')),tpl);
  ed.classList.toggle('empty',!ed.textContent.trim());
  return [tb,ed];
}
const plainOf=html=>{const d=document.createElement('div');d.innerHTML=html||'';return d.textContent.trim()};

function renderCompose(){
  const c=S.compose;
  const bar=h('div',{class:'bar'},h('h2',{},'New email'),h('span',{style:'margin-left:auto'}),iconBtn('close','Discard and close',()=>{S.compose=null;closePane()}));
  const field=(k,label,attrs={})=>h('label',{class:'cf'},h('span',{},label),h('input',{value:c[k],'aria-label':label,oninput:e=>{c[k]=e.target.value},...attrs}));
  const [tb,ed]=editor(c,{placeholder:'Write your message',extra:{client:''}});
  const send=async sendAt=>{
    c.error='';
    if(!splitAddr(c.to).length||!c.subject.trim()||!plainOf(c.html)){c.error='To, subject and message are required.';return renderMain()}
    c.sending=true;renderMain();
    try{const r=await api('/api/inboxes/'+S.inbox.id+'/compose','POST',{from:c.from||'shared',to:splitAddr(c.to),cc:splitAddr(c.cc),bcc:splitAddr(c.bcc),subject:c.subject,bodyHtml:c.html,signature:sigOn&&!!S.signature,files:await readFiles(c.files),...(sendAt?{sendAt:sendAt.toISOString()}:{})});
      S.compose=null;loadCounts();
      if(r.scheduled){alert('Scheduled for '+fmtWhen(r.sendAt)+'. You can see or cancel it under Scheduled.');openPanel('scheduled')}
      else if(r.id)await openThread(r.id);else openView('sent');
    }catch(e){c.error=e.message.includes('Invalid')?'Check the email addresses.':e.message;c.sending=false;renderMain()}
  };
  const form=h('div',{class:'thread compose'},
    h('label',{class:'cf'},h('span',{},'From'),h('select',{class:'plain','aria-label':'From',onchange:e=>{c.from=e.target.value;renderMain()}},
      fromOptions().map(([v,l])=>h('option',{value:v,selected:(c.from||'shared')===v},l)))),
    field('to','To',{placeholder:'client@example.com, another@example.com'}),field('cc','Cc'),field('bcc','Bcc'),field('subject','Subject'),tb,ed,attachPicker(c),signatureBlock(),
    h('div',{class:'hint'},fromHint(c.from||'shared')+' The conversation is assigned to you.'),
    c.error?h('div',{class:'err'},c.error):null,
    h('div',{class:'acts'},h('button',{class:'btn',disabled:c.sending,onclick:()=>send()},c.sending?'Sending…':'Send'),schedulePicker(d=>send(d),c.sending),
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
  S.reply={mode,from:keep?.from||(linkedSrc()&&linkedSrc()===S.me?.email?.toLowerCase()?'me':'shared'),html:keep?.html||'',showCc:false,attach:true,error:'',sending:false,...replyDefaults(mode)};
  if(S.reply.cc)S.reply.showCc=true;
  renderMain();
  setTimeout(()=>main.querySelector(mode==='forward'?'.rto input':'.reply .ed')?.focus(),0);
}
function openDraft(d){
  S.reply={mode:d.mode,from:d.from_addr,to:d.to_addrs,cc:d.cc_addrs,bcc:d.bcc_addrs,html:d.body_html,showCc:!!(d.cc_addrs||d.bcc_addrs),attach:true,error:'',sending:false,fromDraft:true};
  renderMain();setTimeout(()=>main.querySelector('.reply .ed')?.focus(),0);
}
// Shared drafts: the reply is saved for the whole team a moment after you stop typing.
let draftTimer=null;
function saveDraftSoon(){
  clearTimeout(draftTimer);const id=S.threadId,r=S.reply;if(!id||!r)return;
  draftTimer=setTimeout(async()=>{
    if(S.threadId!==id||S.reply!==r||r.sending)return;
    if(!plainOf(r.html)&&!r.fromDraft)return;
    try{await api('/api/threads/'+id+'/draft','PUT',{mode:r.mode,from:r.from,to:r.to||'',cc:r.cc||'',bcc:r.bcc||'',bodyHtml:r.html||''});r.saved=new Date();r.fromDraft=true;
      const el=main.querySelector('.saved');if(el)el.textContent='Draft saved for the team · '+r.saved.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}catch{}
  },1500);
}

function renderReply(){
  const r=S.reply;
  const MODES={reply:'↩ Reply',replyAll:'↩↩ Reply all',forward:'↪ Forward'};
  if(!r)return h('div',{class:'replybtns'},Object.entries(MODES).map(([k,v])=>h('button',{class:'btn ghost',onclick:()=>startReply(k)},v)));
  const box=h('div',{class:'reply'});
  const last=S.detail.messages.at(-1);
  const atts=r.mode==='forward'?([...S.detail.messages].reverse().find(m=>!internal(addrOf(m.from)))||last).attachments||[]:[];
  const send=async(status,sendAt)=>{
    r.error='';
    if(!splitAddr(r.to).length){r.error='Add at least one recipient.';return renderMain()}
    if(!plainOf(r.html)&&r.mode!=='forward'){r.error='Write a message first.';return renderMain()}
    r.sending=true;renderMain();
    try{
      await api('/api/threads/'+S.threadId+'/send','POST',{mode:r.mode,from:r.from,to:splitAddr(r.to),cc:splitAddr(r.cc),bcc:splitAddr(r.bcc),bodyHtml:r.html||'',includeAttachments:r.attach,signature:sigOn&&!!S.signature,files:await readFiles(r.files),...(status?{status}:{}),...(sendAt?{sendAt:sendAt.toISOString()}:{})});
      S.reply=null;S.replying=false;await loadDetail();loadCounts();
    }catch(e){r.error=e.message.includes('Invalid')?'Check the email addresses.':e.message;r.sending=false;renderMain()}
  };
  const line=(k,label,cls)=>h('label',{class:'rl '+(cls||'')},h('span',{},label),h('input',{value:r[k],'aria-label':label,oninput:e=>{r[k]=e.target.value;saveDraftSoon()}}));
  const [tb,ed]=editor(r,{placeholder:r.mode==='forward'?'Add a message (optional context for the recipient)':'Write your reply',
    onInput:()=>{if(!S.replying&&plainOf(r.html)){S.replying=true;heartbeat()}saveDraftSoon()}});
  const others=S.members.filter(m=>m.id!==S.me?.id);
  const review=others.length?h('select',{class:'review','aria-label':'Ask a teammate to review this draft',onchange:async e=>{
    const uid=e.target.value;if(!uid)return;
    try{await api('/api/threads/'+S.threadId+'/draft','PUT',{mode:r.mode,from:r.from,to:r.to||'',cc:r.cc||'',bcc:r.bcc||'',bodyHtml:r.html||''});r.fromDraft=true;
      await api('/api/threads/'+S.threadId+'/draft/review','POST',{userId:uid});alert('Review requested. They will get a notification.')}catch(err){alert(err.message)}
    e.target.value=''}},h('option',{value:''},'Ask for review…'),others.map(m=>h('option',{value:m.id},m.display_name||m.email))):null;
  box.append(...[
    h('div',{class:'rbanner'+(r.from==='me'?' me':'')},fromHint(r.from)),
    h('div',{class:'rhead'},
      h('select',{class:'mode','aria-label':'Reply type',onchange:e=>startReply(e.target.value)},Object.entries(MODES).map(([k,v])=>h('option',{value:k,selected:r.mode===k},v))),
      h('label',{class:'from'},'From',h('select',{'aria-label':'Send from',onchange:e=>{r.from=e.target.value;renderMain()}},
        fromOptions().map(([v,l])=>h('option',{value:v,selected:r.from===v},l)))),
      !r.showCc?h('button',{class:'link',onclick:()=>{r.showCc=true;renderMain()}},'Cc/Bcc'):null,
      iconBtn('close','Discard reply',async()=>{
        if(r.fromDraft&&!confirm('Discard this draft for the whole team?'))return;
        clearTimeout(draftTimer);if(r.fromDraft)await api('/api/threads/'+S.threadId+'/draft','DELETE').catch(()=>{});
        S.reply=null;S.replying=false;await loadDetail()})),
    line('to','To','rto'),
    r.showCc?line('cc','Cc'):null,r.showCc?line('bcc','Bcc'):null,
    tb,ed,attachPicker(r),signatureBlock(),
    atts.length?h('label',{class:'attrow'},h('input',{type:'checkbox',checked:r.attach,onchange:e=>{r.attach=e.target.checked}}),
      `Include ${atts.length} attachment${atts.length>1?'s':''}: `+atts.map(a=>a.filename).join(', ')):null,
    h('div',{class:'hint'},r.mode==='forward'?'The original message is included below your text.':'The previous message is quoted below your reply.'),
    r.error?h('div',{class:'err'},r.error):null,
    h('div',{class:'acts'},
      h('button',{class:'btn',disabled:r.sending,onclick:()=>send()},r.sending?'Sending…':'Send'),
      h('button',{class:'btn close',disabled:r.sending,onclick:()=>send('closed')},'Send & Close'),
      h('button',{class:'btn ghost',disabled:r.sending,onclick:()=>send('pending')},'Send & mark Pending'),
      schedulePicker(d=>send(undefined,d),r.sending),
      review,h('span',{class:'saved'},r.saved?'Draft saved for the team':''))].filter(Boolean));
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
  const due=slaState({...t,sla_hours:t.sla_hours});
  side.append(h('div',{class:'tagrow'},h('span',{class:'k'},'Due'),h('div',{class:'tagbox'},
    h('input',{type:'datetime-local',class:'duein','aria-label':'Due date',value:t.due_at?localInput(new Date(t.due_at)):'',
      onchange:e=>{const v=e.target.value;if(!v)return patch({dueAt:null});const d2=new Date(v);if(!isNaN(d2))patch({dueAt:d2.toISOString()})}}),
    t.due_at?h('button',{class:'link',onclick:()=>patch({dueAt:null})},'Clear'):h('span',{class:'hint'},`Default: reply within ${t.sla_hours||4}h`))));
  if(due)side.append(h('div',{class:'slaline '+due.cls},t.due_at?(due.cls==='over'?due.label+' · was '+due.title.toLowerCase():due.title):due.label+' · '+due.title));
  const tagAct=async(fn)=>{try{await fn();await Promise.all([loadDetail(),loadTags()])}catch(e){alert(e.message)}};
  const have=new Set((d.tags||[]).map(g=>g.id));
  side.append(h('div',{class:'tagrow'},h('span',{class:'k'},'Tags'),h('div',{class:'tagbox'},
    (d.tags||[]).map(g=>h('span',{class:'tagc big',style:`background:${g.color}1f;color:${g.color};border-color:${g.color}55`},g.name,
      h('button',{class:'tagx',title:'Remove tag '+g.name,'aria-label':'Remove tag '+g.name,onclick:()=>tagAct(()=>api('/api/threads/'+t.id+'/tags/'+g.id,'DELETE'))},'×'))),
    h('select',{class:'addtag','aria-label':'Add tag',onchange:async e=>{const v=e.target.value;e.target.value='';
      if(v==='__new'){const name=prompt('New tag name:');if(!name)return;
        return tagAct(async()=>{const g=await api('/api/inboxes/'+S.inbox.id+'/tags','POST',{name,color:'#'+['1a73e8','188038','b06000','a142f4','d93025','007b83'][Math.floor(Math.random()*6)]});await api('/api/threads/'+t.id+'/tags','POST',{tagId:g.id})})}
      if(v)tagAct(()=>api('/api/threads/'+t.id+'/tags','POST',{tagId:v}))}},
      h('option',{value:''},'+ Add tag'),S.tags.filter(g=>!have.has(g.id)).map(g=>h('option',{value:g.id},g.name)),h('option',{value:'__new'},'New tag…')))));
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
  if(a.action==='thread.due')return m.to?`${who} set the due date to ${fmtWhen(m.to)}`:`${who} cleared the due date`;
  if(a.action==='reply.scheduled')return `${who} scheduled a reply for ${fmtWhen(m.sendAt)}`;
  if(a.action==='reply.schedule_canceled')return `${who} canceled a scheduled reply`;
  if(a.action==='thread.shared')return `${who} added this from their mailbox`;
  if(a.action==='thread.moved')return 'Moved into the shared inbox (the client replied to it)';
  if(a.action==='tag.added')return `${who} added tag “${m.tag}”`;
  if(a.action==='tag.removed')return `${who} removed tag “${m.tag||''}”`;
  if(a.action==='draft.started')return `${who} started a draft reply`;
  if(a.action==='draft.review_requested')return `${who} asked for a review of the draft`;
  if(a.action==='thread.imported')return m.reason?'Closed (not open in Hiver)':`Copied from Hiver${m.assignee?' · '+m.assignee:''}${m.status?' · '+(STATUS[m.status]||m.status):''}`;
  return `${who} updated the conversation`;
}
// ---------- panels: notifications, reports, settings ----------
const KIND={scheduled_failed:n=>'Your scheduled email failed',assigned:n=>`${n.actor||'Someone'} assigned you`,mention:n=>`${n.actor||'Someone'} mentioned you`,reply:n=>`New reply from ${n.detail||'the client'}`,draft:n=>`${n.actor||'Someone'} asked you to review a draft`};
function renderPanel(){
  const title={notifications:'Notifications',reports:'Reports · last 30 days',settings:'Settings',scheduled:'Scheduled'}[S.panel];
  const bar=h('div',{class:'bar'},h('h2',{},title),h('span',{style:'margin-left:auto'}),
    S.panel==='notifications'&&S.notifs.unread?h('button',{class:'btn ghost small',onclick:async()=>{await api('/api/notifications/read','POST',{all:true});await loadNotifs();renderMain()}},'Mark all read'):null,
    iconBtn('refresh','Refresh',()=>loadPanel()),iconBtn('close','Close',closePane));
  const body=h('div',{class:'list panel'});
  if(S.panel==='notifications'){
    if(!S.notifs.items.length)body.append(h('div',{class:'empty'},h('strong',{},'No notifications'),"You'll be notified when someone assigns you a conversation, mentions you in a note, asks you to review a draft, or a client replies to one of yours."));
    for(const n of S.notifs.items)body.append(h('button',{class:'nrow'+(n.read_at?'':' unread'),onclick:async()=>{
        await api('/api/notifications/read','POST',{ids:[n.id]}).catch(()=>{});if(n.thread_id)openThread(n.thread_id);loadNotifs()}},
      h('span',{class:'nk '+n.kind},{assigned:'👤',mention:'@',reply:'↩',draft:'✎',scheduled_failed:'⚠'}[n.kind]||'•'),
      h('div',{class:'nt'},h('b',{},KIND[n.kind]?.(n)||n.kind),h('div',{},n.subject||''),n.kind==='mention'&&n.detail?h('div',{class:'nq'},'“'+n.detail+'”'):null),
      h('span',{class:'time',title:full(n.created_at)},when(n.created_at))));
  }
  if(S.panel==='scheduled'){
    const list=S.scheduledList;
    if(!list)body.append(h('div',{class:'loading'},'Loading…'));
    else if(!list.length)body.append(h('div',{class:'empty'},h('strong',{},'Nothing scheduled'),'Use ⏰ Schedule next to Send in a reply or new email.'));
    else for(const sc of list)body.append(h('div',{class:'nrow'+(sc.status==='failed'?' unread':'')},
      h('span',{class:'nk'},sc.status==='failed'?'⚠':'⏰'),
      h('button',{class:'nt',style:'text-align:left',onclick:()=>sc.thread_id&&openThread(sc.thread_id)},
        h('b',{},(sc.kind==='reply'?(sc.summary?.mode==='forward'?'Forward':'Reply'):'New email')+' · '+(sc.summary?.subject||'(no subject)')),
        h('div',{},'To '+(sc.summary?.to||[]).join(', ')+' · by '+sc.by_name),
        sc.status==='failed'?h('div',{class:'nq',style:'color:#a50e0e'},'Failed: '+(sc.error||'')):null),
      h('span',{class:'time',title:full(sc.send_at)},sc.status==='failed'?'':fmtWhen(sc.send_at)),
      (sc.actor_id===S.me?.id||S.me?.role==='admin')&&sc.status!=='sending'?h('button',{class:'btn small ghost',onclick:async()=>{
        if(sc.status!=='failed'&&!confirm('Cancel this scheduled email? It will not be sent.'))return;
        try{await api('/api/scheduled/'+sc.id,'DELETE');await loadPanel();loadCounts()}catch(e){alert(e.message)}}},sc.status==='failed'?'Dismiss':'Cancel'):null));
  }
  if(S.panel==='reports'){
    const r=S.report;
    if(!r)body.append(h('div',{class:'loading'},'Loading reports…'));
    else{
      const fr=r.firstResponse||{};const fmtMin=m=>m==null?'–':m<60?Math.round(m)+' min':m<1440?(m/60).toFixed(1)+' h':(m/1440).toFixed(1)+' days';
      const total=r.daily.reduce((n,d)=>n+d.received,0),maxd=Math.max(1,...r.daily.map(d=>d.received));
      body.append(h('div',{class:'cards'},
        [['Open now',r.now.open],['Pending',r.now.pending],['Unassigned',r.now.unassigned],['Overdue',r.now.overdue,r.now.overdue?'bad':''],
         ['Received (30 days)',total],['Median first reply',fmtMin(fr.median_minutes),'',fr.n?`${fr.n} conversations answered in Fredver`:'No replies sent from Fredver yet']]
        .map(([k,v,c,t])=>h('div',{class:'card '+(c||''),title:t||''},h('div',{class:'cv'},String(v??0)),h('div',{class:'ck'},k)))),
        h('h3',{class:'rh'},'Conversations received per day'),
        h('div',{class:'bars',role:'img','aria-label':'Conversations received per day, last 30 days'},r.daily.map(d=>h('div',{class:'barw',title:`${d.day}: ${d.received}`},
          h('div',{class:'bar1',style:`height:${Math.round(d.received/maxd*100)}%`}),h('span',{},d.day.slice(8))))),
        h('h3',{class:'rh'},'By teammate'),
        h('table',{class:'tbl'},h('thead',{},h('tr',{},['Teammate','Emails sent','Closed','Open now','Pending now'].map(x=>h('th',{},x)))),
          h('tbody',{},r.people.map(p=>h('tr',{},h('td',{},p.name),h('td',{},p.sent),h('td',{},p.closed),h('td',{},p.open_now),h('td',{},p.pending_now))))),
        h('p',{class:'hint'},'Counts emails sent and conversations closed in Fredver. First-reply time measures from the client\'s first email to the first reply sent from Fredver.'));
    }
  }
  if(S.panel==='settings'){
    if(S.me?.role!=='admin')body.append(h('div',{class:'empty'},'Only admins can change settings.'));
    else if(!S.team)body.append(h('div',{class:'loading'},'Loading…'));
    else{
      const upd=async(id,data)=>{try{await api('/api/users/'+id,'PATCH',data);await loadPanel();await loadInbox()}catch(e){alert(e.message)}};
      const nf={email:'',name:'',role:'agent'};
      body.append(h('h3',{class:'rh'},'Team'),
        h('table',{class:'tbl'},h('thead',{},h('tr',{},['Name','Email','Role','Access'].map(x=>h('th',{},x)))),
          h('tbody',{},S.team.filter(u=>u.member||u.active).map(u=>h('tr',{class:u.active?'':'off'},
            h('td',{},h('input',{class:'cell',value:u.display_name,'aria-label':'Name for '+u.email,onchange:e=>upd(u.id,{displayName:e.target.value})})),
            h('td',{},u.email),
            h('td',{},h('select',{class:'cell','aria-label':'Role for '+u.email,onchange:e=>upd(u.id,{role:e.target.value})},
              h('option',{value:'agent',selected:u.role==='agent'},'Agent'),h('option',{value:'admin',selected:u.role==='admin'},'Admin'))),
            h('td',{},h('label',{class:'tog'},h('input',{type:'checkbox',checked:u.active,onchange:e=>{
              if(!e.target.checked&&!confirm(`Remove ${u.display_name}'s access? Their open conversations become unassigned.`)){e.target.checked=true;return}
              upd(u.id,{active:e.target.checked})}}),u.active?'Active':'Removed')))))),
        h('div',{class:'addrow'},
          h('input',{placeholder:'name@columbiabasininsurance.com','aria-label':'New teammate email',oninput:e=>{nf.email=e.target.value}}),
          h('input',{placeholder:'Display name','aria-label':'New teammate name',oninput:e=>{nf.name=e.target.value}}),
          h('select',{'aria-label':'New teammate role',onchange:e=>{nf.role=e.target.value}},h('option',{value:'agent'},'Agent'),h('option',{value:'admin'},'Admin')),
          h('button',{class:'btn',onclick:async()=>{try{await api('/api/inboxes/'+S.inbox.id+'/team','POST',{email:nf.email,displayName:nf.name||nf.email.split('@')[0],role:nf.role});await loadPanel();await loadInbox()}
            catch(e){alert(e.message.includes('Invalid')?'Use a @columbiabasininsurance.com address.':e.message)}}},'Add teammate')),
        h('p',{class:'hint'},'New teammates install Fredver (or get it automatically from Admin Console) and sign in with their own work account.'),
        h('h3',{class:'rh'},'Reply time target (SLA)'),
        h('div',{class:'addrow'},h('label',{},'Reply to clients within ',h('input',{type:'number',min:'1',max:'168',value:String(S.settings?.sla_hours||4),style:'width:80px','aria-label':'SLA hours',
          onchange:async e=>{try{await api('/api/inboxes/'+S.inbox.id+'/settings','PATCH',{slaHours:Number(e.target.value)});S.settings={sla_hours:Number(e.target.value)};loadCounts()}catch(err){alert(err.message)}}}),' hours'),
          h('span',{class:'hint'},'Open conversations waiting longer than this show as Overdue.')),
        h('h3',{class:'rh'},'Tags'),
        h('div',{class:'tagbox'},S.tags.map(g=>h('span',{class:'tagc big',style:`background:${g.color}1f;color:${g.color};border-color:${g.color}55`},g.name,
          h('button',{class:'tagx',title:'Delete tag '+g.name,'aria-label':'Delete tag '+g.name,onclick:async()=>{if(!confirm(`Delete the tag "${g.name}" everywhere?`))return;
            try{await api('/api/tags/'+g.id,'DELETE');await loadTags();renderMain()}catch(e){alert(e.message)}}},'×')))),
        h('h3',{class:'rh'},'Templates'),
        S.templates.length?h('ul',{class:'tpls'},S.templates.map(t=>h('li',{},h('b',{},t.name),' · ',h('span',{class:'hint'},plainOf(t.body_html).slice(0,90)),
          h('button',{class:'tagx',title:'Delete template','aria-label':'Delete template '+t.name,onclick:async()=>{if(!confirm(`Delete the template "${t.name}"?`))return;
            try{await api('/api/templates/'+t.id,'DELETE');await loadTemplates();renderMain()}catch(e){alert(e.message)}}},'×')))):h('p',{class:'hint'},'Create templates from the Templates menu while writing a reply.'));
    }
  }
  return [bar,body];
}
async function loadPanel(){
  try{
    if(S.panel==='notifications')await loadNotifs();
    if(S.panel==='scheduled'){S.scheduledList=null;renderMain();S.scheduledList=await api('/api/inboxes/'+S.inbox.id+'/scheduled')}
    if(S.panel==='reports'){S.report=null;renderMain();S.report=await api('/api/inboxes/'+S.inbox.id+'/reports')}
    if(S.panel==='settings'&&S.me?.role==='admin'){[S.team,S.settings]=await Promise.all([api('/api/inboxes/'+S.inbox.id+'/team'),api('/api/inboxes/'+S.inbox.id+'/settings')]);await Promise.all([loadTags(),loadTemplates()])}
  }catch(e){S.error=e.message}
  renderMain();
}

function renderBanner(viewers){
  const b=main.getElementById('banner');if(!b)return;
  b.replaceChildren(...(viewers||[]).map(v=>h('div',{class:'banner'},v.activity==='replying'?`⚠ ${v.display_name} is writing a reply to this conversation`:`👁 ${v.display_name} is viewing this conversation`)));
}

// ---------- "Add to shared inbox" card on emails in your own mailbox ----------
const shareHost=h('div',{id:'fredvir-share'});shareHost.style.cssText='position:fixed;right:72px;bottom:20px;z-index:2147481000;display:none';
const share=shareHost.attachShadow({mode:'open'});document.documentElement.append(shareHost);
const SHARECSS=BASE+`
.card{background:#fff;border-radius:16px;box-shadow:0 2px 12px #0003;padding:10px 12px;display:flex;align-items:center;gap:10px;max-width:440px;font-size:13px}
.card .ic{width:28px;height:28px;border-radius:8px;background:var(--gl);color:var(--g);display:grid;place-items:center;flex:none}
.card .ic svg{width:18px;height:18px}
.card{width:420px}.card .txt{flex:1;min-width:0}.card .txt b{display:block;font-size:13px}.card .txt span{color:var(--mut);font-size:12px}
.card .btn{white-space:nowrap;padding:7px 14px}
.card .x{color:var(--mut);padding:2px 4px;font-size:16px}`;
const shareCache=new Map();let shareKey='',shareBusy=false,shareHidden=new Set();
const gmailAccount=()=>{const m=document.title.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);return m?m[0].toLowerCase():''};
function openGmailThreadId(){
  const el=[...document.querySelectorAll('h2[data-legacy-thread-id]')].find(e=>e.offsetParent!==null);
  return el?.getAttribute('data-legacy-thread-id')||'';
}
function renderShare(){
  const gid=openGmailThreadId(),acct=gmailAccount();
  const show=S.signedIn&&!S.authError&&!S.open&&gid&&acct&&(acct===S.me?.email?.toLowerCase()||acct===S.inbox?.email?.toLowerCase())&&!shareHidden.has(gid);
  if(!show){shareHost.style.display='none';return}
  const key=acct+'|'+gid;
  const st=shareCache.get(key);
  if(st===undefined&&!shareBusy){shareBusy=true;
    api('/api/share/status?'+new URLSearchParams({account:acct,gid})).then(r=>shareCache.set(key,r)).catch(e=>shareCache.set(key,{error:e.message})).finally(()=>{shareBusy=false;renderShare()})}
  if(key===shareKey&&shareHost.style.display==='block'&&st===shareHost._st)return;
  shareKey=key;shareHost._st=st;
  const inbox=S.inbox?.name||'the shared inbox';
  const card=h('div',{class:'card',role:'region','aria-label':'Fredver'},h('span',{class:'ic'},svg(ICON.inbox)));
  if(!st)card.append(h('div',{class:'txt'},h('span',{},'Checking Fredver…')));
  else if(st.error)card.append(h('div',{class:'txt'},h('b',{},'Fredver'),h('span',{},st.error)));
  else if(st.thread?.id){
    card.append(h('div',{class:'txt'},h('b',{},'✓ In '+inbox),h('span',{},`${STATUS[st.thread.status]||st.thread.status} · ${st.thread.assignee_name||'Unassigned'}`)),
      h('button',{class:'btn ghost',onclick:()=>{S.open=true;placeMain();openThread(st.thread.id);renderShare()}},'Open in Fredver'));
  }else if(st.canShare||st.thread){
    card.append(h('div',{class:'txt'},h('b',{},'Share with your team?'),h('span',{},`Teammates can see, assign and reply in ${inbox}.`)),
      h('button',{class:'btn',onclick:async e=>{e.target.disabled=true;e.target.textContent='Adding…';
        try{const r=await api('/api/share','POST',{gid});shareCache.delete(key);loadCounts();S.open=true;placeMain();openThread(r.id)}
        catch(err){alert(err.message);e.target.disabled=false;e.target.textContent='＋ Add to Shared Inbox'}}},'＋ Add to Shared Inbox'));
  }else return void(shareHost.style.display='none');
  card.append(h('button',{class:'x',title:'Hide for this email','aria-label':'Hide',onclick:()=>{shareHidden.add(gid);renderShare()}},'×'));
  share.replaceChildren(h('style',{},SHARECSS),card);shareHost.style.display='block';
}
setInterval(renderShare,800);

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
    const {fredverOpen}=await chrome.storage.local.get('fredverOpen').catch(()=>({}));
    if(fredverOpen?.threadId&&Date.now()-fredverOpen.at<120000){chrome.storage.local.remove('fredverOpen');S.open=true;placeMain();openThread(fredverOpen.threadId)}
  }catch(e){
    S.error=e.message;
    if(/not provisioned|403/i.test(e.message))S.authError=`${S.email||'This account'} isn't set up for Fredver. Sign in with your own work account (not the shared info@ mailbox).`;
    else S.authError='Could not load the shared inbox: '+e.message;
    renderNav();renderMain();
  }
}
const searchFocused=()=>main.activeElement?.classList?.contains('search');
async function loadInbox(){if(!S.inbox)return renderNav();S.members=await api('/api/inboxes/'+S.inbox.id+'/members');await Promise.all([loadCounts(),loadTags(),loadTemplates(),loadNotifs()]);if(S.open&&!S.threadId&&!S.panel)loadThreads();else renderMain()}
async function loadTags(){if(!S.inbox)return;try{S.tags=await api('/api/inboxes/'+S.inbox.id+'/tags');renderNav()}catch{}}
async function loadTemplates(){if(!S.inbox)return;try{S.templates=await api('/api/inboxes/'+S.inbox.id+'/templates')}catch{}}
async function loadNotifs(){try{S.notifs=await api('/api/notifications');renderNav()}catch{}}
async function runSearch(q){
  q=q.trim();
  if(!q){S.q='';if(S.view==='search')return openView(S.prevView||'unassigned');return}
  if(S.view!=='search')S.prevView=S.view;
  S.view='search';S.q=q;S.threads=[];S.listLoading=true;S.error='';renderNav();renderMain();
  try{const r=await api('/api/search?'+new URLSearchParams({inboxId:S.inbox.id,q}));S.searchIds=r.ids;await loadThreads()}
  catch(e){S.error=e.message;S.listLoading=false;renderMain()}
}
// A click on a desktop notification (handled by the background worker) asks this tab to open the conversation.
chrome.storage.onChanged.addListener((c,area)=>{const v=c.fredverOpen?.newValue;if(area==='local'&&v?.threadId&&S.signedIn){S.open=true;placeMain();openThread(v.threadId);chrome.storage.local.remove('fredverOpen')}});
async function loadCounts(){if(!S.inbox)return;try{S.counts=await api('/api/inboxes/'+S.inbox.id+'/counts');renderNav()}catch{}}
async function loadThreads(){
  if(!S.inbox)return;const first=!S.threads.length;S.listLoading=true;S.error='';if(first)renderMain();
  const p={inboxId:S.inbox.id,view:S.view};
  if(S.view==='assignee'&&S.viewAssignee)p.assigneeId=S.viewAssignee;
  if(S.view==='tag'&&S.viewTag)p.tagId=S.viewTag;
  if(S.view==='search')p.ids=S.searchIds.join(',');
  try{S.threads=S.view==='search'&&!S.searchIds.length?[]:await api('/api/threads?'+new URLSearchParams(p))}catch(e){S.error=e.message}
  S.listLoading=false;if(!S.threadId&&!S.compose&&!searchFocused())renderMain();
}
async function openThread(id){S.panel=null;S.compose=null;S.menu=null;S.threadId=id;S.detail=null;S.expanded=new Set();S.replying=false;S.reply=null;S.error='';renderNav();renderMain();await loadDetail()}
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
setInterval(()=>{if(!S.signedIn||document.hidden)return;loadCounts();loadNotifs();if(S.open&&!S.threadId&&!S.compose&&!S.panel&&!S.listLoading&&S.view!=='search')loadThreads()},15000);
setInterval(()=>{if(S.signedIn&&!document.hidden)loadTags()},60000);
addEventListener('beforeunload',leaveThread);

renderNav();boot();
})();
