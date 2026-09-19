const STORAGE={active:'fnc-active-v3',profile:'fnc-profile-v4',sessions:'fnc-sessions-v4',legacySession:'fnc-session-v3'};
const FALLBACK={updatedAt:'2026-09-19T00:00:00-05:00',source:'fallback',events:[]};
let calendar=FALLBACK;
let active=load(STORAGE.active,null);

const legacy=load(STORAGE.legacySession,null);
let profile=load(STORAGE.profile,{nick:legacy?.nick||''});
let sessions=load(STORAGE.sessions,{});
let session;

const $=id=>document.getElementById(id);

function load(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtFormat(v){return ({SOLO:'SOLO',DUO:'DÚO',TRIO:'TRÍO',SQUAD:'SQUAD'})[v]||v||'—'}
function fmtMode(e){if(e.mode==='RELOAD')return e.zeroBuild?'RELOAD ZB':'RELOAD';if(e.zeroBuild)return'ZERO BUILD';return'BATTLE ROYALE'}
function mapUrl(e){if(!e)return'about:blank';return e.mapUrl||(e.mode==='RELOAD'?'https://fortnite.gg/?map=reload':'https://fortnite.gg/')}

function blankSession(){
  return {topGoal:'',cutPoints:'',maxGames:'10',games:[]};
}
function sessionKey(){return active?.id||'__sin_torneo__'}
function getSession(){
  const key=sessionKey();
  if(!sessions[key]){
    const migrated=legacy&&Object.keys(sessions).length===0
      ? {topGoal:'',cutPoints:legacy.cut??'',maxGames:legacy.maxGames||'10',games:Array.isArray(legacy.games)?legacy.games:[]}
      : blankSession();
    sessions[key]=migrated;
    save(STORAGE.sessions,sessions);
  }
  return sessions[key];
}
function persistSession(){
  sessions[sessionKey()]=session;
  save(STORAGE.sessions,sessions);
}
function hydrateSession(){
  session=getSession();
  $('nick').value=profile.nick||'';
  $('topGoal').value=session.topGoal||'';
  $('cutPoints').value=session.cutPoints||'';
  $('maxGames').value=session.maxGames||'10';
  $('gamePoints').value='';
  setGameError('');
  renderSession(false);
}

async function loadCalendar(force=false){
 const status=$('calendarStatus'); status.textContent='ACTUALIZANDO';
 try{
   const suffix=force?`?t=${Date.now()}`:'';
   const r=await fetch(`data/tournaments.json${suffix}`,{cache:force?'no-store':'default'});
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   const data=await r.json();
   if(!Array.isArray(data.events))throw new Error('Formato inválido');
   calendar=data; status.textContent=data.events.length?'ACTUALIZADO':'SIN EVENTOS';
   status.classList.toggle('warn',!data.events.length);
   $('lastUpdate').textContent=`Última actualización: ${formatTimestamp(data.updatedAt)} · ${data.events.length} eventos`;
   if(active){
     const fresh=data.events.find(x=>x.id===active.id);
     if(fresh){active=fresh;save(STORAGE.active,active)}
   }
 }catch(err){
   status.textContent='ÚLTIMO CALENDARIO';
   $('lastUpdate').textContent='No se pudo refrescar ahora. Se conserva el último calendario publicado.';
 }
 renderBanner(); renderTournaments(); syncEmbeds();
}

function formatTimestamp(v){if(!v)return'—';try{return new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'short'}).format(new Date(v))}catch{return v}}
function formatEventTime(e){if(e.start){try{return new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',weekday:'short',day:'2-digit',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(e.start))}catch{}}return e.peruLabel||'Horario por confirmar'}

function renderBanner(){
 const el=$('activeBanner');
 if(!active){
   el.innerHTML='<span class="eyebrow">TORNEO ACTIVO</span><h2>Ningún torneo seleccionado</h2><p>Ve a Torneo y pulsa SELECCIONAR. Esa elección controlará Inicio, Mapa y Clasificación.</p>';
   return;
 }
 el.innerHTML=`<span class="eyebrow">TORNEO ACTIVO</span><h2>${esc(active.name)}</h2><p>${esc(active.region)} · ${esc(fmtFormat(active.format))} · ${esc(fmtMode(active))} · ${esc(formatEventTime(active))}</p>`;
}
function selectTournament(e){
 active=e;
 save(STORAGE.active,e);
 hydrateSession();
 renderBanner();
 renderTournaments();
 syncEmbeds();
 go('home');
}
function renderTournaments(){
 const fr=$('filterRegion').value,fm=$('filterMode').value,ff=$('filterFormat').value,fp=$('filterPlatform').value;
 const now=Date.now()-6*3600_000;
 const items=(calendar.events||[]).filter(e=>(fr==='ALL'||e.region===fr)&&(fm==='ALL'||e.mode===fm)&&(ff==='ALL'||e.format===ff)&&(fp==='ALL'||e.platform===fp)&&(!e.end||Date.parse(e.end)>=now));
 const host=$('tournamentList');host.innerHTML='';
 if(!items.length){
   host.innerHTML='<div class="card"><p class="notice">No hay torneos próximos con estos filtros. Si la fuente oficial acaba de cambiar, pulsa ↻ para comprobar el calendario publicado.</p></div>';
   return;
 }
 items.sort((a,b)=>(Date.parse(a.start||'2999')-Date.parse(b.start||'2999'))||a.name.localeCompare(b.name)).forEach(e=>{
   const d=document.createElement('div');d.className='tournament-item'+(active?.id===e.id?' selected':'');
   const platform=e.platform==='MOBILE'?'MÓVIL':e.platform==='CONSOLE'?'CONSOLA':'PC / MULTI';
   d.innerHTML=`<div><span class="eyebrow">${esc(e.region)} · ${esc(fmtFormat(e.format))} · ${esc(platform)}</span><h3>${esc(e.name)}</h3><p><strong>${esc(formatEventTime(e))} · hora Perú</strong><br>${esc(fmtMode(e))}${e.trackerUrl?' · clasificación vinculada':''}</p></div><button class="select-btn">${active?.id===e.id?'SELECCIONADO':'SELECCIONAR'}</button>`;
   d.querySelector('button').onclick=()=>selectTournament(e);host.appendChild(d);
 });
}
function syncEmbeds(){
 const map=$('mapFrame'),rank=$('rankFrame'),rankState=$('rankState'),mapState=$('mapState');
 $('mapSubtitle').textContent=active?`${active.name} · ${active.region}`:'Selecciona un torneo';
 $('rankSubtitle').textContent=active?`${active.name} · ${active.region}`:'Selecciona un torneo';
 $('mapBadge').textContent=active?fmtMode(active):'—';
 if(active){map.src=mapUrl(active);mapState.classList.add('hidden')}
 else{map.src='about:blank';mapState.textContent='Selecciona un torneo para cargar su mapa.';mapState.classList.remove('hidden')}
 if(active?.trackerUrl){rank.src=active.trackerUrl;rankState.classList.add('hidden')}
 else{
   rank.src='about:blank';
   rankState.innerHTML=active?'La fuente automática todavía no encontró una clasificación verificable para este evento. FN Compass no mostrará una tabla de otro torneo ni inventará datos.':'Selecciona un torneo para cargar su clasificación.';
   rankState.classList.remove('hidden');
 }
}

function numberOrNull(v){
 const s=String(v??'').trim();
 if(s==='')return null;
 const n=Number(s);
 return Number.isFinite(n)?n:null;
}
function setGameError(msg){$('gameError').textContent=msg||''}
function renderSession(syncInputs=true){
 if(!session)session=getSession();
 if(syncInputs){
   $('nick').value=profile.nick||'';
   $('topGoal').value=session.topGoal||'';
   $('cutPoints').value=session.cutPoints||'';
   $('maxGames').value=session.maxGames||'10';
 }
 const games=Array.isArray(session.games)?session.games:[];
 const total=games.reduce((a,b)=>a+Number(b||0),0);
 const target=numberOrNull(session.cutPoints);
 const top=numberOrNull(session.topGoal);
 const max=Math.max(1,Math.min(30,Math.floor(numberOrNull(session.maxGames)||10)));
 const played=games.length;
 const remain=Math.max(0,max-played);
 const gap=target===null?null:Math.max(0,target-total);
 const avg=played?total/played:null;
 const projection=avg===null?null:Math.round(total+(avg*remain));
 const needPerGame=gap===null||remain===0?null:Math.ceil(gap/remain);

 $('totalPoints').textContent=total;
 $('progressText').textContent=`${played}/${max} partidas`;
 $('progressBar').style.width=`${Math.min(100,played/max*100)}%`;
 $('gap').textContent=gap===null?'—':gap;
 $('perGame').textContent=needPerGame===null?'—':needPerGame;
 $('avgPoints').textContent=avg===null?'—':avg.toFixed(avg%1===0?0:1);
 $('projection').textContent=projection===null?'—':projection;
 $('history').innerHTML=games.map((p,i)=>`<span class="chip">P${i+1}<strong>+${p}</strong></span>`).join('');

 if(target===null){
   $('planTitle').textContent='Configura los puntos del corte';
   $('planText').textContent=top?`Tu objetivo es Top ${Math.floor(top)}. Añade los puntos actuales del corte para calcular cuánto te falta.`:'Ingresa tu Top objetivo y los puntos actuales del corte para calcular el ritmo que necesitas.';
 }else if(gap===0){
   $('planTitle').textContent=top?`Ritmo de Top ${Math.floor(top)} alcanzado`:'Objetivo alcanzado';
   $('planText').textContent=`Tienes ${total} pts y el corte configurado es ${target}. Prioriza consistencia y evita regalar las partidas restantes.`;
 }else if(remain===0){
   $('planTitle').textContent='Sesión terminada';
   $('planText').textContent=`Terminaste con ${total} pts. Faltaron ${gap} pts para el corte configurado de ${target}.`;
 }else{
   const label=top?`Top ${Math.floor(top)}`:'tu objetivo';
   let advice;
   if(avg!==null&&needPerGame<=avg) advice=`Tu promedio actual es ${avg.toFixed(1)} pts, así que vas al ritmo necesario. Mantén el plan y evita una partida en cero.`;
   else if(needPerGame<=15) advice='El ritmo es manejable: prioriza placement, recursos y peleas con ventaja.';
   else if(needPerGame<=30) advice='Necesitas una partida sólida: busca buen placement y eliminaciones seguras.';
   else advice='El ritmo exigido es alto. Necesitas una partida fuerte, pero evita convertir el objetivo en un rush innecesario.';
   $('planTitle').textContent=`${label}: busca +${needPerGame} pts por partida`;
   $('planText').textContent=`Faltan ${gap} pts con ${remain} partida${remain===1?'':'s'}. ${advice}`;
 }
 persistSession();
}

function go(tab){
 document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.go===tab));
 document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));
}

document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>go(b.dataset.go));
['filterRegion','filterMode','filterFormat','filterPlatform'].forEach(id=>$(id).onchange=renderTournaments);
$('refreshBtn').onclick=()=>loadCalendar(true);

$('nick').oninput=e=>{
 profile.nick=e.target.value;
 save(STORAGE.profile,profile);
};
$('topGoal').oninput=e=>{
 session.topGoal=e.target.value;
 renderSession(false);
};
$('cutPoints').oninput=e=>{
 session.cutPoints=e.target.value;
 renderSession(false);
};
$('maxGames').oninput=e=>{
 session.maxGames=e.target.value;
 renderSession(false);
};

$('addGame').onclick=()=>{
 const raw=$('gamePoints').value.trim();
 if(raw===''){setGameError('Escribe los puntos de la partida antes de añadirla.');$('gamePoints').focus();return}
 const v=Number(raw);
 if(!Number.isFinite(v)||v<0||!Number.isInteger(v)){setGameError('Ingresa un puntaje válido: 0 o un número entero positivo.');return}
 const max=Math.max(1,Math.min(30,Math.floor(numberOrNull(session.maxGames)||10)));
 if(session.games.length>=max){setGameError(`Ya registraste las ${max} partidas configuradas.`);return}
 setGameError('');
 session.games.push(v);
 $('gamePoints').value='';
 renderSession(false);
};
$('gamePoints').oninput=()=>setGameError('');
$('gamePoints').onkeydown=e=>{if(e.key==='Enter')$('addGame').click()};
$('undoGame').onclick=()=>{
 if(!session.games.length){setGameError('Todavía no hay partidas para deshacer.');return}
 session.games.pop();
 setGameError('');
 renderSession(false);
};
$('newSession').onclick=()=>{
 if(session.games.length&&!confirm('¿Empezar una nueva sesión para este torneo? Se borrarán las partidas registradas de este evento.'))return;
 session.games=[];
 setGameError('');
 renderSession(false);
};

session=getSession();
renderBanner();
hydrateSession();
syncEmbeds();
loadCalendar();
