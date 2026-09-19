const STORAGE={active:'fnc-active-v3',session:'fnc-session-v3'};
const FALLBACK={updatedAt:'2026-09-19T00:00:00-05:00',source:'fallback',events:[]};
let calendar=FALLBACK;
let active=load(STORAGE.active,null);
let session=load(STORAGE.session,{nick:'',cut:'',maxGames:'10',games:[]});

function load(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtFormat(v){return ({SOLO:'SOLO',DUO:'DÚO',TRIO:'TRÍO',SQUAD:'SQUAD'})[v]||v||'—'}
function fmtMode(e){if(e.mode==='RELOAD')return e.zeroBuild?'RELOAD ZB':'RELOAD';if(e.zeroBuild)return 'ZERO BUILD';return 'BATTLE ROYALE'}
function mapUrl(e){if(!e)return'about:blank';return e.mapUrl||(e.mode==='RELOAD'?'https://fortnite.gg/?map=reload':'https://fortnite.gg/')}

async function loadCalendar(force=false){
 const status=document.getElementById('calendarStatus'); status.textContent='ACTUALIZANDO';
 try{
   const suffix=force?`?t=${Date.now()}`:'';
   const r=await fetch(`data/tournaments.json${suffix}`,{cache:force?'no-store':'default'});
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   const data=await r.json();
   if(!Array.isArray(data.events))throw new Error('Formato inválido');
   calendar=data; status.textContent=data.events.length?'ACTUALIZADO':'SIN EVENTOS';
   status.classList.toggle('warn',!data.events.length);
   document.getElementById('lastUpdate').textContent=`Última actualización: ${formatTimestamp(data.updatedAt)} · ${data.events.length} eventos`;
   if(active){const fresh=data.events.find(x=>x.id===active.id);if(fresh){active=fresh;save(STORAGE.active,active)}}
 }catch(err){
   status.textContent='ÚLTIMO CALENDARIO';
   document.getElementById('lastUpdate').textContent='No se pudo refrescar ahora. Se conserva el último calendario publicado.';
 }
 renderBanner(); renderTournaments(); syncEmbeds();
}

function formatTimestamp(v){if(!v)return'—';try{return new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'short'}).format(new Date(v))}catch{return v}}
function formatEventTime(e){if(e.start){try{return new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',weekday:'short',day:'2-digit',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(e.start))}catch{}}return e.peruLabel||'Horario por confirmar'}
function renderBanner(){const el=document.getElementById('activeBanner');if(!active){el.innerHTML='<span class="eyebrow">TORNEO ACTIVO</span><h2>Ningún torneo seleccionado</h2><p>Ve a Torneo y pulsa SELECCIONAR. Esa elección controlará Inicio, Mapa y Clasificación.</p>';return}el.innerHTML=`<span class="eyebrow">TORNEO ACTIVO</span><h2>${esc(active.name)}</h2><p>${esc(active.region)} · ${esc(fmtFormat(active.format))} · ${esc(fmtMode(active))} · ${esc(formatEventTime(active))}</p>`}
function selectTournament(e){active=e;save(STORAGE.active,e);renderBanner();renderTournaments();syncEmbeds();go('home')}
function renderTournaments(){
 const fr=document.getElementById('filterRegion').value,fm=document.getElementById('filterMode').value,ff=document.getElementById('filterFormat').value,fp=document.getElementById('filterPlatform').value;
 const now=Date.now()-6*3600_000;
 const items=(calendar.events||[]).filter(e=>(fr==='ALL'||e.region===fr)&&(fm==='ALL'||e.mode===fm)&&(ff==='ALL'||e.format===ff)&&(fp==='ALL'||e.platform===fp)&&(!e.end||Date.parse(e.end)>=now));
 const host=document.getElementById('tournamentList');host.innerHTML='';
 if(!items.length){host.innerHTML='<div class="card"><p class="notice">No hay torneos próximos con estos filtros. Si la fuente oficial acaba de cambiar, pulsa ↻ para comprobar el calendario publicado.</p></div>';return}
 items.sort((a,b)=>(Date.parse(a.start||'2999')-Date.parse(b.start||'2999'))||a.name.localeCompare(b.name)).forEach(e=>{
   const d=document.createElement('div');d.className='tournament-item'+(active?.id===e.id?' selected':'');
   const platform=e.platform==='MOBILE'?'MÓVIL':e.platform==='CONSOLE'?'CONSOLA':'PC / MULTI';
   d.innerHTML=`<div><span class="eyebrow">${esc(e.region)} · ${esc(fmtFormat(e.format))} · ${esc(platform)}</span><h3>${esc(e.name)}</h3><p><strong>${esc(formatEventTime(e))} · hora Perú</strong><br>${esc(fmtMode(e))}${e.trackerUrl?' · clasificación vinculada':''}</p></div><button class="select-btn">${active?.id===e.id?'SELECCIONADO':'SELECCIONAR'}</button>`;
   d.querySelector('button').onclick=()=>selectTournament(e);host.appendChild(d);
 });
}
function syncEmbeds(){
 const map=document.getElementById('mapFrame'),rank=document.getElementById('rankFrame'),rankState=document.getElementById('rankState'),mapState=document.getElementById('mapState');
 document.getElementById('mapSubtitle').textContent=active?`${active.name} · ${active.region}`:'Selecciona un torneo';
 document.getElementById('rankSubtitle').textContent=active?`${active.name} · ${active.region}`:'Selecciona un torneo';
 document.getElementById('mapBadge').textContent=active?fmtMode(active):'—';
 if(active){map.src=mapUrl(active);mapState.classList.add('hidden')}else{map.src='about:blank';mapState.textContent='Selecciona un torneo para cargar su mapa.';mapState.classList.remove('hidden')}
 if(active?.trackerUrl){rank.src=active.trackerUrl;rankState.classList.add('hidden')}else{rank.src='about:blank';rankState.innerHTML=active?'La fuente automática todavía no encontró una clasificación verificable para este evento. FN Compass no mostrará una tabla de otro torneo ni inventará datos.':'Selecciona un torneo para cargar su clasificación.';rankState.classList.remove('hidden')}
}
function renderSession(){
 nick.value=session.nick||'';cut.value=session.cut||'';maxGames.value=session.maxGames||'10';
 const total=session.games.reduce((a,b)=>a+Number(b||0),0),target=Number(session.cut)||0,max=Math.max(1,Number(session.maxGames)||10),played=session.games.length,remain=Math.max(0,max-played),gap=target?Math.max(0,target-total):null;
 totalPoints.textContent=total;progressText.textContent=`${played}/${max} partidas`;progressBar.style.width=`${Math.min(100,played/max*100)}%`;document.getElementById('gap').textContent=gap===null?'—':gap;perGame.textContent=gap===null||!remain?'—':Math.ceil(gap/remain);history.innerHTML=session.games.map((p,i)=>`<span class="chip">P${i+1}<strong>+${p}</strong></span>`).join('');
 if(!target){planTitle.textContent='Configura el corte';planText.textContent='Introduce el objetivo para calcular puntos faltantes y ritmo por partida.'}else if(gap===0){planTitle.textContent='Objetivo alcanzado';planText.textContent='Ya alcanzaste el objetivo ingresado. Prioriza consistencia y evita regalar partidas.'}else if(!remain){planTitle.textContent='Sesión terminada';planText.textContent=`Faltaron ${gap} pts para el objetivo.`}else{const p=Math.ceil(gap/remain);planTitle.textContent=`Busca +${p} pts o más`;planText.textContent=p<=15?`Faltan ${gap} pts con ${remain} partida${remain===1?'':'s'}. Prioriza placement y peleas con ventaja.`:p<=30?`Faltan ${gap} pts. Necesitas una partida sólida: buen placement y eliminaciones seguras.`:`Faltan ${gap} pts. El ritmo exigido es alto: busca una partida fuerte y asume riesgo de forma controlada.`}
 save(STORAGE.session,session);
}
function go(tab){document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.go===tab));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab))}

document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>go(b.dataset.go));
['filterRegion','filterMode','filterFormat','filterPlatform'].forEach(id=>document.getElementById(id).onchange=renderTournaments);
refreshBtn.onclick=()=>loadCalendar(true);
['nick','cut','maxGames'].forEach(id=>document.getElementById(id).oninput=e=>{session[id]=e.target.value;renderSession()});
addGame.onclick=()=>{const v=Number(gamePoints.value);if(!Number.isFinite(v)||v<0)return;session.games.push(v);gamePoints.value='';renderSession()};
gamePoints.onkeydown=e=>{if(e.key==='Enter')addGame.click()};undoGame.onclick=()=>{session.games.pop();renderSession()};newSession.onclick=()=>{session.games=[];renderSession()};
renderBanner();renderSession();syncEmbeds();loadCalendar();
