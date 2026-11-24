/* TV launcher. City selection, display destinations and spatial remote
   navigation share one state; casting/pairing use the existing service flow. */
'use strict';

var CITIES = [
  {id:"dc",        file:"dc.html",         icon:"DC", name:"Washington DC", desc:"Metro · Metrobus · MARC · Ride On", sys:"#4ea1ff"},
  {id:"philly",    file:"philadelphia.html",  icon:"PHL", name:"Philadelphia",  desc:"SEPTA rail · subway · bus · PATCO", sys:"#3ad0c8"},
  {id:"nyc",       file:"nyc.html",           icon:"NYC", name:"New York",      desc:"Subway · LIRR · Metro-North · PATH", sys:"#ffd166"},
  {id:"nj",        file:"newjersey.html",     icon:"NJ", name:"New Jersey",    desc:"NJ Transit rail · light rail · bus", sys:"#ff9d5c"},
  {id:"boston",    file:"boston.html",        icon:"BOS", name:"Boston",        desc:"MBTA subway · commuter rail · bus", sys:"#33d17a"},
  {id:"chicago",   file:"chicago.html",       icon:"CHI", name:"Chicago",       desc:"CTA 'L' · bus · Metra · Amtrak", sys:"#00a1de"},
  {id:"la",        file:"losangeles.html",    icon:"LA", name:"Los Angeles",   desc:"Metro rail · Metrolink", sys:"#b58cff"},
  {id:"sf",        file:"sanfrancisco.html",  icon:"SF", name:"San Francisco", desc:"BART · Muni · Caltrain · cable car", sys:"#ff6b8a"},
  {id:"amsterdam", file:"amsterdam.html",     icon:"AMS", name:"Amsterdam",     desc:"Metro · tram · rail · ferry", sys:"#8ab4ff"},
  /* Europe. Icons keep the same rule as the rest of this list — a symbol OF the
     place, not a transit glyph: Cologne's cathedral, Stuttgart as the city both
     Mercedes and Porsche come from, the Alps above Zurich. */
  {id:"cologne",   file:"cologne.html",       icon:"CGN", name:"Cologne",       desc:"KVB Stadtbahn · S-Bahn · DB rail", sys:"#e8a33d"},
  {id:"stuttgart", file:"stuttgart.html",     icon:"STR", name:"Stuttgart",     desc:"SSB Stadtbahn · S-Bahn · DB rail", sys:"#e05a5a"},
  {id:"rome",      file:"rome.html",          icon:"ROM", name:"Rome",          desc:"Metro · tram · ATAC bus · Trenitalia", sys:"#d9744a"},
  {id:"zurich",    file:"zurich.html",        icon:"ZRH", name:"Zurich",        desc:"Tram · S-Bahn · SBB rail", sys:"#5ad1a0"}
];



var VIEWS = [
  {id:'sky',name:'Sky',desc:'Follow the aircraft overhead.',file:'night.html',perCity:true,color:'#9eaee3'},
  {id:'board',name:'Departures',desc:'A classic split-flap departure board.',file:'flipboard.html',perCity:true,color:'#dcc18b'},
  {id:'projector',name:'Projector',desc:'Your city skyline, after dark.',file:'projector.html',perCity:true,color:'#8dc8bd'},
  {id:'home',name:'Home',desc:'Weather, sky, and your daily rhythm.',file:'home.html',perCity:false,color:'#d4ab8b'},
  {id:'tour',name:'Grand Tour',desc:'Watch the world move, city by city.',file:'tour.html',perCity:false,color:'#87b9ca'},
  {id:'spot',name:'Spotter',desc:'Collect the things you see along the way.',file:'spot.html',perCity:false,color:'#b6b7dc'}
];
var LAST_KEY='tb.tvLastCity',lastCity='';
try{lastCity=localStorage.getItem(LAST_KEY)||'';}catch(e){}
var requestedCity=new URLSearchParams(location.search).get('city');
var currentCity=CITIES.filter(function(c){return c.id===(requestedCity||lastCity);})[0]||CITIES[0];
var castSelection={name:currentCity.name,href:currentCity.file};
var tiles=[],idx=0,painting=0;
function svg(id,cls){return '<svg aria-hidden="true"'+(cls?' class="'+cls+'"':'')+'><use href="#tv-'+id+'"/></svg>';}
function targetCity(){return currentCity.id;}
function buildViewHref(v){return v.file+(v.perCity?'?city='+targetCity()+(v.id==='projector'?'&surface=wall':''):'');}
function rememberCity(){try{localStorage.setItem(LAST_KEY,currentCity.id);}catch(e){}}
function open(href,city){if(city){try{localStorage.setItem(LAST_KEY,city);}catch(e){}}window.location.href=href;}
function paintSkyline(){
  if(!window.TBProjectorScene||!window.TBProjectorCities)return;
  var canvas=document.getElementById('citySkyline'),box=canvas.parentNode;
  var w=box.clientWidth,h=box.clientHeight,dpr=Math.min(2,window.devicePixelRatio||1);
  if(!w||!h)return;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  var c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
  var gradient=c.createLinearGradient(0,0,0,h);gradient.addColorStop(0,'#0d1726');gradient.addColorStop(1,'#15263a');c.fillStyle=gradient;c.fillRect(0,0,w,h);
  var seed=1729;
  currentCity.id.split('').forEach(function(ch){seed+=ch.charCodeAt(0)*311;});
  function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
  for(var i=0;i<35;i++){c.fillStyle='rgba(186,207,233,'+(rand()*.3+.12)+')';c.fillRect(rand()*w,rand()*h*.7,1,1);}
  window.TBProjectorScene.draw(c,{city:window.TBProjectorCities.get(currentCity.id),width:w,height:h,baseline:h*.89,detail:true,labels:false,now:Date.now()});
}
function selectCity(id,persist){
  var city=CITIES.filter(function(c){return c.id===id;})[0];if(!city)return;
  currentCity=city;if(persist)rememberCity();
  var meta=window.TBProjectorCities&&window.TBProjectorCities.get(id);
  document.querySelectorAll('.city-option').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.city===id));});
  document.getElementById('selectedCityName').textContent=meta?meta.name:city.name;
  document.getElementById('selectedCityDesc').textContent=city.desc;
  document.getElementById('featureRegion').textContent=(meta?meta.region:'YOUR CITY')+' / YOUR SCREEN';
  document.getElementById('panoramaCaption').textContent=meta?meta.district:'ILLUSTRATED CITY PANORAMA';
  document.getElementById('openBoard').href=city.file;
  document.getElementById('openBoard').setAttribute('aria-label','Open '+city.name+' live board');
  document.getElementById('openProjector').href='projector.html?city='+id+'&surface=wall';
  document.getElementById('viewContext').textContent='City views follow '+(meta?meta.name:city.name);
  document.querySelectorAll('[data-view]').forEach(function(a){a.href=buildViewHref(VIEWS[+a.dataset.view]);});
  castSelection={name:city.name,href:city.file};
  if(document.getElementById('castBtn'))setCastUI();
  var feature=document.querySelector('.city-feature');feature.classList.remove('city-enter');void feature.offsetWidth;feature.classList.add('city-enter');
  cancelAnimationFrame(painting);painting=requestAnimationFrame(paintSkyline);
}
function buildMenu(){
  var cities=document.getElementById('cities');
  CITIES.forEach(function(city,i){
    if(i===0||i===8){var label=document.createElement('p');label.className='city-group'+(i===8?' europe':'');label.textContent=i===0?'United States':'Europe';cities.appendChild(label);}
    var b=document.createElement('button');b.type='button';b.className='city-option';b.dataset.city=city.id;b.setAttribute('data-tv-control','');b.setAttribute('aria-pressed','false');
    b.setAttribute('aria-label',city.name);
    b.innerHTML='<span class="city-emblem" aria-hidden="true">'+(window.TBCityIcon?window.TBCityIcon(city.id):city.icon)+'</span><span class="city-name">'+city.name+'</span><span class="shortcut" aria-hidden="true">'+(i<9?i+1:'')+'</span>';
    b.addEventListener('click',function(){selectCity(city.id,true);});
    cities.appendChild(b);
  });
  var wrap=document.getElementById('views');
  VIEWS.forEach(function(v,i){
    var a=document.createElement('a');a.className='mode-card '+v.id;a.dataset.view=i;a.setAttribute('data-tv-control','');a.href=buildViewHref(v);a.style.setProperty('--mode-color',v.color);
    a.style.setProperty('--view-delay',i*45+'ms');
    a.innerHTML='<span class="mode-top">'+(window.TBViewArt?window.TBViewArt(v.id):svg(v.id))+svg('arrow','mode-arrow')+'</span><span class="mode-name">'+v.name+'</span><span class="mode-desc">'+v.desc+'</span>';
    a.addEventListener('focus',function(){castSelection={name:v.name+' / '+currentCity.name,href:buildViewHref(v)};setCastUI();});
    a.addEventListener('click',rememberCity);wrap.appendChild(a);
  });
  document.getElementById('openBoard').addEventListener('click',rememberCity);
  document.getElementById('openBoard').addEventListener('focus',function(){castSelection={name:currentCity.name,href:currentCity.file};setCastUI();});
  document.getElementById('openProjector').addEventListener('click',rememberCity);
  document.getElementById('openProjector').addEventListener('focus',function(){castSelection={name:currentCity.name+' Projector',href:'projector.html?city='+currentCity.id+'&surface=wall'};setCastUI();});
  tiles=[].slice.call(document.querySelectorAll('[data-tv-control]'));
  tiles.forEach(function(t,i){t.addEventListener('focus',function(){tiles.forEach(function(el){el.classList.remove('on');});idx=i;t.classList.add('on');});t.addEventListener('blur',function(){t.classList.remove('on');});});
}
function focusIndex(n,scroll){if(n<0||n>=tiles.length)return;idx=n;try{tiles[n].focus({preventScroll:true});}catch(e){tiles[n].focus();}if(scroll!==false&&tiles[n].scrollIntoView)tiles[n].scrollIntoView({block:'nearest',inline:'nearest'});}
function visible(t){var r=t.getBoundingClientRect();return r.width>0&&r.height>0;}
function move(dx,dy){
  var active=document.activeElement,current=tiles.indexOf(active);if(current<0)current=idx;
  var r=tiles[current].getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,best=-1,score=Infinity;
  tiles.forEach(function(t,i){
    if(i===current||!visible(t))return;var b=t.getBoundingClientRect(),xx=b.left+b.width/2,yy=b.top+b.height/2;
    var primary=dx?(xx-x)*dx:(yy-y)*dy,cross=dx?Math.abs(yy-y):Math.abs(xx-x);
    if(primary<4)return;var value=primary+cross*3;
    if(value<score){score=value;best=i;}
  });
  if(best>=0){focusIndex(best);var id=tiles[best].dataset.city;if(id)selectCity(id,false);}
}
function toggleFullscreen(){
  var el=document.documentElement,active=document.fullscreenElement||document.webkitFullscreenElement;
  var say=function(){document.getElementById('hint').textContent='Use the TV’s own zoom if full screen is unavailable.';};
  try{var fn=active?(document.exitFullscreen||document.webkitExitFullscreen):(el.requestFullscreen||el.webkitRequestFullscreen);if(!fn){say();return;}var result=fn.call(active?document:el);if(result&&result.catch)result.catch(say);}catch(e){say();}
}
function modalKeys(e,panel,close){
  if(e.key==='Escape'){e.preventDefault();close();return;}
  if(e.key==='Tab'){
    var list=[].slice.call(panel.querySelectorAll('a[href],button,input,select,[tabindex="0"]')).filter(visible),at=list.indexOf(document.activeElement);
    if(!list.length)return;
    if(e.shiftKey&&at<=0){e.preventDefault();list[list.length-1].focus();}
    else if(!e.shiftKey&&at===list.length-1){e.preventDefault();list[0].focus();}
  }
}
document.addEventListener('keydown',function(e){
  var help=document.getElementById('castHelp'),pair=document.getElementById('pairPanel');
  if(help.classList.contains('show')){modalKeys(e,help,closeCastHelp);return;}
  if(pair.classList.contains('show')){modalKeys(e,pair,closePair);return;}
  if(e.ctrlKey||e.metaKey||e.altKey||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
  var k=e.key;
  if(k.indexOf('Arrow')===0){var dx=k==='ArrowLeft'?-1:k==='ArrowRight'?1:0,dy=k==='ArrowUp'?-1:k==='ArrowDown'?1:0;move(dx,dy);e.preventDefault();}
  else if(k==='Enter'||k===' '){var t=document.activeElement;if(tiles.indexOf(t)>=0){e.preventDefault();t.click();}}
  else if(/^[1-9]$/.test(k)){var city=CITIES[+k-1];if(city){open(city.file,city.id);e.preventDefault();}}
  else if(k==='f'||k==='F'){toggleFullscreen();e.preventDefault();}
  else if(k==='c'||k==='C'){toggleCast();e.preventDefault();}
  else if((k==='u'||k==='U')&&window.TB_PAYWALL!==false){openPair();e.preventDefault();}
});
var resizeTimer;
addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(paintSkyline,100);});
buildMenu();
document.getElementById('fullscreenBtn').addEventListener('click',toggleFullscreen);

/* TV setup is a shared, platform-specific connection panel. */
function setCastUI(){if(window.TBTVCast)window.TBTVCast.update();}
function toggleCast(){if(window.TBTVCast)window.TBTVCast.open();}
function closeCastHelp(){if(window.TBTVCast)window.TBTVCast.close();}

var pairLoading = null;
function loadPair(cb){
  if (window.TBPair) { cb(true); return; }
  if (pairLoading) { pairLoading.push(cb); return; }
  pairLoading = [cb];
  var left = 2, failed = false;
  function settle(){
    var ok = !failed && !!window.TBPair, list = pairLoading;
    pairLoading = null;
    for (var i = 0; i < list.length; i++) { try { list[i](ok); } catch(_){} }
  }
  ["pair-qr.js?v=1", "pair-tv.js?v=1"].forEach(function(src){
    var s = document.createElement("script");
    s.src = src;
    s.onload  = function(){ if (--left === 0) settle(); };
    s.onerror = function(){ failed = true; if (--left === 0) settle(); };
    document.head.appendChild(s);
  });
}

/* Read the cached licence straight from localStorage — license.js is not on
   this page to answer, but these are the exact values it writes, and the same
   fourteen-day offline grace gate.js honours. */
function screenLicensed(){
  if (window.TB_PAYWALL === false) return true;
  try{
    var DAY = 86400000;
    if (Number(localStorage.getItem("tb.license.okUntil") || 0) > Date.now()) return true;
    if (Number(localStorage.getItem("tb.license.lastOk")  || 0) > Date.now() - 14 * DAY) return true;
  }catch(_){}
  return false;
}

function paintPairBtn(){
  var b = document.getElementById("pairBtn");
  if (!b) return;
  if (window.TB_PAYWALL === false) {
    b.style.display = "none";
    document.getElementById("unlockHint").style.display = "none";
    return;
  }
  var on = screenLicensed();
  if (on) b.classList.add("done"); else b.classList.remove("done");
  b.querySelector(".lbl").textContent = on ? "Screen is licensed" : "Unlock this screen";
  b.title = on
    ? "This screen already has a licence. You can still pair it again."
    : "Show a code your phone can scan to unlock this screen";
}

function openPair(){
  var panel = document.getElementById("pairPanel"),
      note  = document.getElementById("pairNote"),
      host  = document.getElementById("pairHost");
  panel.classList.add("show");
  note.textContent = "Loading…";
  host.innerHTML = "";
  document.getElementById("pairClose").focus();
  loadPair(function(ok){
    if (!ok){
      note.textContent = "Couldn't load the pairing tools. Check this screen's connection, then try again.";
      return;
    }
    note.textContent = screenLicensed()
      ? "This screen already has a licence — scanning again simply re-registers it, and costs you nothing."
      : "Scan this with your phone. Your licence moves across; there is nothing to type on the TV.";
    window.TBPair.mount(host, {});
  });
}

function closePair(){
  if (window.TBPair) window.TBPair.stop();     // stop polling with the panel gone
  document.getElementById("pairPanel").classList.remove("show");
  paintPairBtn();
  /* Back to the tile the remote was sitting on, so arrows carry on working.
     Focusing the header button instead would strand a remote outside the grid
     with no way back into it. */
  try { tiles[idx].focus({preventScroll:true}); }catch(_){}
}

function initCast(){
  if(window.TBTVCast)window.TBTVCast.init({
    getCity:function(){return window.TBProjectorCities.get(currentCity.id);},
    getDefaultHref:function(){return castSelection.href;}
  });
  document.getElementById('pairBtn').addEventListener('click',openPair);
  document.getElementById('pairClose').addEventListener('click',closePair);
  paintPairBtn();
}
initCast();

function tick(){
  var d = new Date();
  document.getElementById("clock").textContent =
    d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  document.getElementById("date").textContent =
    d.toLocaleDateString([], {weekday:"long", month:"short", day:"numeric"});
}
tick(); setInterval(tick, 10000);


selectCity(currentCity.id,false);
var initial=!screenLicensed()?document.getElementById("pairBtn"):document.querySelector('.city-option[data-city="'+currentCity.id+'"]');
if(initial)focusIndex(tiles.indexOf(initial),false);
