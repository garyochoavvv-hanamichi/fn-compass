const STORAGE={active:'fnc-active-v3',profile:'fnc-profile-v4',sessions:'fnc-sessions-v4',legacySession:'fnc-session-v3'};
const FALLBACK={updatedAt:'2026-09-19T00:00:00-05:00',source:'fallback',events:[]};
let calendar=FALLBACK;
let leaderboards={updatedAt:null,source:'',events:{}};
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

function eventVisual(e){
  const n=(e?.name||'').toLowerCase();
  const trophy='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 8h18v7c0 8-3.8 13.3-9 15.4V36h8v4H16v-4h8v-5.6C18.8 28.3 15 23 15 15V8Zm-4 4h4v4c0 4.4 1.5 7.7 4.4 10-5.1-.7-8.4-4.5-8.4-10v-4Zm22 0h4v4c0 5.5-3.3 9.3-8.4 10 2.9-2.3 4.4-5.6 4.4-10v-4Z"/></svg>';
  const controller='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 16h18c5.7 0 10 4.8 10 11 0 5.1-2.6 9-6.2 9-2.7 0-4.4-1.7-6.3-4H17.5c-1.9 2.3-3.6 4-6.3 4C7.6 36 5 32.1 5 27c0-6.2 4.3-11 10-11Zm1 7v4h-4v4h4v4h4v-4h4v-4h-4v-4h-4Zm17 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/></svg>';
  const phone='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 5h16a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4Zm2 5v25h12V10H18Zm6 27a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>';
  const reload='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M36 12V5l9 9-9 9v-7c-3.2-3.5-7-5-11.5-5C16.5 11 10 17.5 10 25.5S16.5 40 24.5 40c6.3 0 11.6-4 13.6-9.7l4.7 1.7C40 39.6 32.9 45 24.5 45 13.7 45 5 36.3 5 25.5S13.7 6 24.5 6C29.1 6 33 7.4 36 12Z"/></svg>';
  const shield='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 40 10v11c0 10.8-6.7 18.8-16 23-9.3-4.2-16-12.2-16-23V10l16-6Zm0 7-9 3.3V21c0 6.8 3.6 12.1 9 15.3 5.4-3.2 9-8.5 9-15.3v-6.7L24 11Z"/></svg>';
  if(n.includes('cyberpunk')||n.includes('override series')) return {cls:'art-cyber',tag:'SPECIAL',icon:trophy};
  if(n.includes('fncs')) return {cls:'art-fncs',tag:'FNCS',icon:shield};
  if(n.includes('victory cup')) return {cls:'art-victory',tag:'VICTORY',icon:trophy};
  if(n.includes('reload')) return {cls:'art-reload',tag:'RELOAD',icon:reload};
  if(e?.platform==='CONSOLE') return {cls:'art-console',tag:'CONSOLE',icon:controller};
  if(e?.platform==='MOBILE') return {cls:'art-mobile',tag:'MOBILE',icon:phone};
  return {cls:'art-cup',tag:'CUP',icon:trophy};
}

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
     const fresh=data.events.find(x=>x.id===active.id) ||
       data.events.find(x=>x.region===active.region && x.name===active.name);
     if(fresh){active=fresh;save(STORAGE.active,active)}
   }
 }catch(err){
   status.textContent='ÚLTIMO CALENDARIO';
   $('lastUpdate').textContent='No se pudo refrescar ahora. Se conserva el último calendario publicado.';
 }
 renderBanner(); renderTournaments(); syncEmbeds(); renderRanking();
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
 renderRanking();
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
   const visual=eventVisual(e);
   d.innerHTML=`<div class="tournament-art ${visual.cls}"><span class="art-tag">${esc(visual.tag)}</span><div class="art-icon">${visual.icon}</div><small>${esc(e.region)}</small></div><div class="tournament-copy"><div class="tournament-badges"><span>${esc(e.region)}</span><span>${esc(fmtFormat(e.format))}</span><span>${esc(fmtMode(e))}</span></div><h3>${esc(e.name)}</h3><p><strong>${esc(formatEventTime(e))} · hora Perú</strong><br>${esc(platform)}${leaderboards?.events?.[e.id]?.rows?.length?' · tabla disponible':(e.trackerUrl?' · fuente enlazada':'')}</p></div><button class="select-btn">${active?.id===e.id?'SELECCIONADO':'SELECCIONAR'}</button>`;
   d.querySelector('button').onclick=()=>selectTournament(e);host.appendChild(d);
 });
}
function syncEmbeds(){
 const map=$('mapFrame'),mapState=$('mapState');
 $('mapSubtitle').textContent=active?`${active.name} · ${active.region}`:'Selecciona un torneo';
 $('rankSubtitle').textContent=active?`${active.name} · ${active.region}`:'Selecciona un torneo';
 $('mapBadge').textContent=active?fmtMode(active):'—';
 if(active){map.src=mapUrl(active);mapState.classList.add('hidden')}
 else{map.src='about:blank';mapState.textContent='Selecciona un torneo para cargar su mapa.';mapState.classList.remove('hidden')}
}


function normalizeName(v){
 return String(v||'').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'');
}

async function loadRankings(force=false){
 try{
   const suffix=force?`?t=${Date.now()}`:'';
   const r=await fetch(`data/rankings.json${suffix}`,{cache:force?'no-store':'default'});
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   const data=await r.json();
   if(!data||typeof data.events!=='object')throw new Error('Formato inválido');
   leaderboards=data;
   renderTournaments();
 }catch(err){
   leaderboards={updatedAt:null,source:'',events:{}};
 }
 renderRanking();
}

function currentRanking(){
 if(!active)return null;
 return leaderboards?.events?.[active.id]||null;
}

function targetCutRow(rows,top){
 if(!top||!rows?.length)return null;
 const n=Math.max(1,Math.floor(Number(top)||0));
 if(!n)return null;
 const exact=rows.find(r=>Number(r.rank)===n);
 if(exact)return exact;
 const eligible=rows.filter(r=>Number(r.rank)<=n);
 return eligible.length?eligible[eligible.length-1]:null;
}

function targetKnownCutoff(entry,top){
 if(!top||!entry)return null;
 const n=Math.max(1,Math.floor(Number(top)||0));
 if(!n)return null;
 const direct=(entry.cutoffs||[]).find(c=>Number(c.rank)===n);
 if(direct)return direct;
 const row=targetCutRow(entry.rows||[],n);
 return row?{rank:Number(row.rank),points:Number(row.points)}:null;
}

function syncCutFromRanking(entry){
 if(!entry||!session)return;
 const top=numberOrNull(session.topGoal);
 if(!top)return;
 const cut=targetKnownCutoff(entry,top);
 if(!cut)return;
 if(session.cutSource!=='manual'||String(session.cutPoints||'').trim()===''){
   session.cutPoints=String(cut.points);
   session.cutSource='ranking';
   if($('cutPoints'))$('cutPoints').value=session.cutPoints;
   renderSession(false);
 }
}

function renderRanking(){
 const state=$('rankState'),wrap=$('rankTableWrap'),body=$('rankTableBody'),foot=$('rankFoot');
 const playerBox=$('rankPlayer'),playerMeta=$('rankPlayerMeta'),cutBox=$('rankCutoff'),cutMeta=$('rankCutoffMeta'),badge=$('rankBadge');
 if(!state||!wrap||!body)return;

 body.innerHTML='';
 wrap.classList.add('hidden');
 foot.textContent='';
 badge.textContent='AUTO';

 if(!active){
   state.textContent='Selecciona un torneo para cargar su clasificación.';
   state.classList.remove('hidden');
   playerBox.textContent='—'; playerMeta.textContent='Configura tu nick en Inicio.';
   cutBox.textContent='—'; cutMeta.textContent='Configura el Top objetivo en Inicio.';
   return;
 }

 const entry=currentRanking();
 if(!entry){
   state.innerHTML=active.trackerUrl
     ? 'La clasificación todavía se está sincronizando. FN Compass la actualizará automáticamente desde el evento seleccionado.'
     : 'Este torneo todavía no tiene una clasificación enlazada de forma verificable.';
   state.classList.remove('hidden');
   playerBox.textContent='—'; playerMeta.textContent=profile.nick||'Configura tu nick en Inicio.';
   cutBox.textContent='—'; cutMeta.textContent='Esperando datos del leaderboard.';
   badge.textContent='ESPERANDO';
   return;
 }

 const allRows=Array.isArray(entry.rows)?entry.rows:[];
 if(!allRows.length){
   const top=numberOrNull(session?.topGoal);
   const known=targetKnownCutoff(entry,top);
   const firstCut=(entry.cutoffs||[])[0]||null;
   const shown=known||firstCut;
   state.innerHTML=shown
     ? `Tracker todavía no publica las filas completas de esta sesión.<br><strong>Corte visible: Top ${esc(shown.rank)} · ${esc(shown.points)} pts</strong>`
     : (entry.status==='stale'
       ? 'La última clasificación disponible no tiene filas visibles todavía.'
       : 'El leaderboard está enlazado, pero aún no hay posiciones publicadas para esta ronda.');
   state.classList.remove('hidden');
   playerBox.textContent='—'; playerMeta.textContent=profile.nick||'Configura tu nick en Inicio.';
   if(shown){
     cutBox.textContent=`${shown.points} pts`;
     cutMeta.textContent=`Top ${shown.rank} · dato publicado por Tracker`;
     if(top&&Number(top)===Number(shown.rank))syncCutFromRanking(entry);
   }else{
     cutBox.textContent='—'; cutMeta.textContent='Sin corte disponible todavía.';
   }
   badge.textContent=shown?'CORTE':'SIN DATOS';
   foot.textContent=entry.updatedAt?`Último intento: ${formatTimestamp(entry.updatedAt)}`:'';
   return;
 }

 syncCutFromRanking(entry);

 const nickNorm=normalizeName(profile.nick);
 const me=nickNorm?allRows.find(r=>normalizeName(r.team).includes(nickNorm)||nickNorm.includes(normalizeName(r.team))):null;
 if(me){
   playerBox.textContent=`#${me.rank} · ${me.points} pts`;
   playerMeta.textContent=`${me.team}${me.matches!=null?` · ${me.matches} partidas`:''}`;
 }else{
   playerBox.textContent='No encontrado';
   playerMeta.textContent=profile.nick?profile.nick:'Configura tu nick en Inicio.';
 }

 const top=numberOrNull(session?.topGoal);
 const cut=targetKnownCutoff(entry,top);
 if(cut&&top){
   cutBox.textContent=`${cut.points} pts`;
   cutMeta.textContent=`Top ${Math.floor(top)} · puesto #${cut.rank}`;
 }else{
   cutBox.textContent='—';
   cutMeta.textContent=top?`Top ${Math.floor(top)} fuera de los datos cargados.`:'Configura el Top objetivo en Inicio.';
 }

 const q=normalizeName($('rankSearch')?.value||'');
 const visible=q?allRows.filter(r=>normalizeName(r.team).includes(q)):allRows;
 if(!visible.length){
   state.textContent='No encontré ese jugador o equipo en las posiciones cargadas.';
   state.classList.remove('hidden');
   return;
 }

 state.classList.add('hidden');
 wrap.classList.remove('hidden');
 const cutRank=cut?Number(cut.rank):null;
 body.innerHTML=visible.map(r=>{
   const isMe=me&&Number(r.rank)===Number(me.rank)&&r.team===me.team;
   const isCut=cutRank!==null&&Number(r.rank)===cutRank;
   const cls=[isMe?'is-me':'',isCut?'is-cut':'',Number(r.rank)<=3?'is-podium':''].filter(Boolean).join(' ');
   return `<tr class="${cls}"><td class="rank-pos">#${esc(r.rank)}</td><td class="rank-team">${esc(r.team)}${isMe?'<span class="you-chip">TÚ</span>':''}</td><td class="rank-points">${esc(r.points)}</td><td class="rank-games">${r.matches==null?'—':esc(r.matches)}</td></tr>`;
 }).join('');

 const stale=entry.status==='stale'?' · último dato disponible':'';
 const participants=entry.participants?` · ${entry.participants.toLocaleString('es-PE')} participantes`:'';
 foot.textContent=`Actualizado: ${formatTimestamp(entry.updatedAt||leaderboards.updatedAt)} · ${allRows.length} posiciones cargadas${participants}${stale}`;
 badge.textContent=entry.status==='stale'?'ÚLTIMO':'LIVE';
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
$('refreshBtn').onclick=()=>{loadCalendar(true);loadRankings(true)};
$('rankRefresh').onclick=()=>loadRankings(true);
$('rankSearch').oninput=renderRanking;

$('nick').oninput=e=>{
 profile.nick=e.target.value;
 save(STORAGE.profile,profile);
 renderRanking();
};
$('topGoal').oninput=e=>{
 session.topGoal=e.target.value;
 if(session.cutSource==='ranking')session.cutPoints='';
 renderSession(false);
 renderRanking();
};
$('cutPoints').oninput=e=>{
 session.cutPoints=e.target.value;
 session.cutSource='manual';
 renderSession(false);
 renderRanking();
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
renderRanking();
loadCalendar();
loadRankings();
