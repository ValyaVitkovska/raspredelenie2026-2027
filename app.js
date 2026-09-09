const STORAGE_KEY='mathPlannerStateV1';
const CONFIG_KEY='mathPlannerFirebaseConfigV1';
const EMAIL_KEY='mathPlannerEmailV1';

const SECTION_CONFIG={
  '8A':{label:'8.A',grade:'8'},
  '8B':{label:'8.B',grade:'8'},
  '8C':{label:'8.C',grade:'8'},
  '9A':{label:'9.A',grade:'9'},
  '9B':{label:'9.B',grade:'9'}
};

let currentSection='8A', filter='all', search='';
let deferredPrompt=null, cloud=null, cloudUnsub=null, cloudWriteTimer=null, applyingCloud=false;

function currentGrade(){return SECTION_CONFIG[currentSection].grade;}
function currentLabel(){return SECTION_CONFIG[currentSection].label;}

function blankState(){
  const sections={};
  for(const [section,cfg] of Object.entries(SECTION_CONFIG)){
    sections[section]={};
    for(const l of PLAN_DATA[cfg.grade]){
      sections[section][l.id]={done:false,date:'',notes:'',title:l.title,type:l.type};
    }
  }
  return {version:2,updatedAt:Date.now(),sections};
}

function normalizeState(raw){
  const base=blankState();
  if(!raw || typeof raw!=='object') return base;

  // Версия 2: отделни данни за всяка паралелка.
  if(raw.sections){
    for(const section of Object.keys(base.sections)){
      for(const id of Object.keys(base.sections[section])){
        if(raw.sections?.[section]?.[id]){
          base.sections[section][id]={...base.sections[section][id],...raw.sections[section][id]};
        }
      }
    }
  }
  // Миграция от версия 1.1: старите данни за 8. или 9. клас се копират
  // към всички съответни паралелки, за да не се загуби нищо.
  else if(raw.classes){
    for(const [section,cfg] of Object.entries(SECTION_CONFIG)){
      for(const id of Object.keys(base.sections[section])){
        if(raw.classes?.[cfg.grade]?.[id]){
          base.sections[section][id]={...base.sections[section][id],...raw.classes[cfg.grade][id]};
        }
      }
    }
  }

  base.updatedAt=raw.updatedAt||Date.now();
  return base;
}

function loadState(){
  try{return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));}
  catch{return blankState();}
}

let state=loadState();
function saveLocal(push=true){
  state.version=2;
  state.updatedAt=Date.now();
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  if(push) scheduleCloudWrite();
}
function esc(s=''){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));}
function lessonView(l){const s=state.sections[currentSection][l.id];return {...l,...s};}
function typeName(t){return ({'НЗ':'Нови знания','У':'Упражнение','П':'Преговор','О':'Обобщение','К':'Контрол и оценка'})[t]||t;}

function render(){
  document.querySelectorAll('.section-tab').forEach(b=>b.classList.toggle('active',b.dataset.section===currentSection));
  const grade=currentGrade();
  const all=PLAN_DATA[grade].map(lessonView);
  const done=all.filter(x=>x.done).length;
  const pct=Math.round(done/all.length*100);

  document.getElementById('sumTitle').textContent=`${currentLabel()} паралелка`;
  document.getElementById('sumText').textContent=`${done} от ${all.length} часа са отбелязани като взети за ${currentLabel()}`;
  document.getElementById('pct').textContent=`${pct}%`;
  document.getElementById('bar').style.width=`${pct}%`;

  const q=search.trim().toLocaleLowerCase('bg');
  const visible=all.filter(x=>(!q||x.title.toLocaleLowerCase('bg').includes(q)||x.notes.toLocaleLowerCase('bg').includes(q)) && (filter==='all'||(filter==='done'&&x.done)||(filter==='todo'&&!x.done)));
  const weeks=document.getElementById('weeks');
  weeks.innerHTML='';
  if(!visible.length){weeks.innerHTML='<div class="empty">Няма теми по избрания филтър.</div>';return;}

  const groups=new Map();
  for(const l of visible){if(!groups.has(l.week))groups.set(l.week,[]);groups.get(l.week).push(l);}

  for(const [week,lessons] of groups){
    const w=document.createElement('section');
    w.className='week';
    const weekAll=all.filter(x=>x.week===week), wd=weekAll.filter(x=>x.done).length;
    w.innerHTML=`<div class="weekhead"><strong>Учебна седмица ${week}</strong><span class="small">${currentLabel()}: ${wd}/${weekAll.length} взети</span></div>`;

    for(const l of lessons){
      const d=document.createElement('div');
      d.className='lesson'+(l.done?' done':'');
      d.dataset.id=l.id;
      d.innerHTML=`<input class="donebox" type="checkbox" ${l.done?'checked':''} aria-label="Отбележи като взет за ${currentLabel()}" />
      <div class="num">час ${l.number}</div>
      <div><div class="title">${esc(l.title)} <span class="tag">${esc(l.type)}</span></div><div class="meta">${typeName(l.type)}${l.date?` • взет на ${esc(l.date)}`:''}${l.notes?` • има бележка`:''}</div></div>
      <button class="editbtn" title="Редактиране на тема, вид, дата и бележка за ${currentLabel()}">✎ Редактирай</button>
      <div class="details">
        <div class="wide"><label>Тема на часа за ${currentLabel()}</label><input class="titleinput" value="${esc(l.title)}" aria-label="Редактиране на темата" /></div>
        <div><label>Вид на урока</label><select class="typeinput">${['НЗ','У','П','О','К'].map(t=>`<option ${t===l.type?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label>Реална дата</label><input class="dateinput" type="date" value="${esc(l.date)}" /></div>
        <div class="wide"><label>Бележка за ${currentLabel()}</label><textarea class="notesinput" placeholder="Напр. какво остана за довършване…">${esc(l.notes)}</textarea></div>
        <div class="wide"><button class="secondary resettitle" type="button">Възстанови първоначалната тема</button></div>
        <div class="autosave">Промените са само за ${currentLabel()} и се запазват автоматично. При включена синхронизация се прехвърлят и на другото устройство.</div>
      </div>`;

      d.querySelector('.donebox').addEventListener('change',e=>{
        const s=state.sections[currentSection][l.id];
        s.done=e.target.checked;
        if(s.done&&!s.date){
          const n=new Date();
          s.date=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
        }
        saveLocal();render();
      });
      d.querySelector('.editbtn').addEventListener('click',()=>d.classList.toggle('open'));
      d.querySelector('.dateinput').addEventListener('change',e=>{state.sections[currentSection][l.id].date=e.target.value;saveLocal();render();});
      d.querySelector('.notesinput').addEventListener('input',e=>{state.sections[currentSection][l.id].notes=e.target.value;saveLocal();});
      d.querySelector('.titleinput').addEventListener('change',e=>{state.sections[currentSection][l.id].title=e.target.value.trim()||l.title;saveLocal();render();});
      d.querySelector('.resettitle').addEventListener('click',()=>{state.sections[currentSection][l.id].title=PLAN_DATA[grade].find(x=>x.id===l.id).title;saveLocal();render();});
      d.querySelector('.typeinput').addEventListener('change',e=>{state.sections[currentSection][l.id].type=e.target.value;saveLocal();render();});
      w.appendChild(d);
    }
    weeks.appendChild(w);
  }
}

document.querySelectorAll('.section-tab').forEach(b=>b.addEventListener('click',()=>{currentSection=b.dataset.section;render();}));
document.getElementById('search').addEventListener('input',e=>{search=e.target.value;render();});
document.getElementById('filter').addEventListener('change',e=>{filter=e.target.value;render();});
document.getElementById('syncBtn').addEventListener('click',()=>document.getElementById('syncDialog').showModal());
document.getElementById('backupBtn').addEventListener('click',()=>document.getElementById('backupDialog').showModal());

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;document.getElementById('installBtn').hidden=false;});
document.getElementById('installBtn').addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;document.getElementById('installBtn').hidden=true;});
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));

function download(name,text,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
document.getElementById('exportBtn').addEventListener('click',()=>download(`ucheben-plan-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2)));
document.getElementById('importFile').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;
  try{
    const obj=JSON.parse(await f.text());
    if(!obj.sections&&!obj.classes)throw new Error();
    state=normalizeState(obj);saveLocal();render();document.getElementById('backupDialog').close();alert('Архивът е възстановен.');
  }catch{alert('Файлът не е валиден архив на приложението.');}
});
document.getElementById('resetBtn').addEventListener('click',()=>{
  if(confirm('Да се изчистят ли всички отметки, дати и бележки за ВСИЧКИ паралелки?')){state=blankState();saveLocal();render();}
});

function setSyncStatus(text,good=false){const el=document.getElementById('syncStatus');el.textContent=text;el.className='status '+(good?'sync-good':'sync-bad');}
function msg(text){document.getElementById('syncMessage').textContent=text;}
function parseConfig(txt){let t=txt.trim();if(!t)throw new Error('Липсва Firebase config.');t=t.replace(/^const\s+firebaseConfig\s*=\s*/,'').replace(/;\s*$/,'');if(t.includes('apiKey:')&&!t.includes('"apiKey"')){t=t.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g,'$1"$2":').replace(/'/g,'"');}return JSON.parse(t);}

document.getElementById('firebaseConfig').value=localStorage.getItem(CONFIG_KEY)||'';
document.getElementById('email').value=localStorage.getItem(EMAIL_KEY)||'';
document.getElementById('saveConfigBtn').addEventListener('click',()=>{try{const cfg=parseConfig(document.getElementById('firebaseConfig').value);localStorage.setItem(CONFIG_KEY,JSON.stringify(cfg));localStorage.setItem(EMAIL_KEY,document.getElementById('email').value.trim());msg('Настройките са запазени на това устройство.');}catch(e){msg('Проверете Firebase config: '+e.message);}});

async function initCloud(){
  if(cloud) return cloud;
  const raw=localStorage.getItem(CONFIG_KEY);if(!raw) throw new Error('Първо запазете Firebase config.');
  const cfg=JSON.parse(raw);
  const appMod=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
  const authMod=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
  const fsMod=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
  const app=appMod.initializeApp(cfg);
  cloud={auth:authMod.getAuth(app),db:fsMod.getFirestore(app),authMod,fsMod};
  authMod.onAuthStateChanged(cloud.auth,user=>{if(user){setSyncStatus('Синхронизирано',true);startCloudListener(user.uid);msg(`Свързано като ${user.email||'потребител'}.`);}else{setSyncStatus('Локално');if(cloudUnsub){cloudUnsub();cloudUnsub=null;}}});
  return cloud;
}
async function login(create=false){
  try{
    localStorage.setItem(EMAIL_KEY,document.getElementById('email').value.trim());
    const c=await initCloud(), email=document.getElementById('email').value.trim(), pass=document.getElementById('password').value;
    if(!email||!pass) throw new Error('Въведете имейл и парола.');
    if(create) await c.authMod.createUserWithEmailAndPassword(c.auth,email,pass); else await c.authMod.signInWithEmailAndPassword(c.auth,email,pass);
  }catch(e){msg('Грешка: '+(e.message||e));setSyncStatus('Грешка');}
}
document.getElementById('loginBtn').addEventListener('click',()=>login(false));
document.getElementById('registerBtn').addEventListener('click',()=>login(true));
document.getElementById('logoutBtn').addEventListener('click',async()=>{try{const c=await initCloud();await c.authMod.signOut(c.auth);msg('Излязохте от профила.');}catch(e){msg(e.message);}});

async function startCloudListener(uid){
  const c=await initCloud();if(cloudUnsub)cloudUnsub();
  const ref=c.fsMod.doc(c.db,'users',uid,'planner','main');
  const first=await c.fsMod.getDoc(ref);
  if(!first.exists()) await c.fsMod.setDoc(ref,{...state,updatedAt:Date.now()});
  cloudUnsub=c.fsMod.onSnapshot(ref,snap=>{
    if(!snap.exists())return;
    const remote=snap.data();
    if(!remote?.sections&&!remote?.classes)return;
    if((remote.updatedAt||0)>(state.updatedAt||0)+250){
      applyingCloud=true;
      state=normalizeState(remote);
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      render();
      applyingCloud=false;
    }
  });
}
function scheduleCloudWrite(){
  if(applyingCloud||!cloud?.auth?.currentUser)return;
  clearTimeout(cloudWriteTimer);
  cloudWriteTimer=setTimeout(async()=>{
    try{
      const c=cloud,uid=c.auth.currentUser.uid;
      const ref=c.fsMod.doc(c.db,'users',uid,'planner','main');
      await c.fsMod.setDoc(ref,state);
      setSyncStatus('Синхронизирано',true);
    }catch(e){setSyncStatus('Без връзка');}
  },700);
}

if(localStorage.getItem(CONFIG_KEY)) initCloud().catch(()=>setSyncStatus('Локално'));
render();
