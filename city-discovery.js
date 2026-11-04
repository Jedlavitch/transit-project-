/* City outings and a self-reported passport. Independent of transit feeds,
   accounts, saved board locations and Claude's development configuration. */
(function () {
  "use strict";
  var city = location.pathname.split("/").pop().replace(/\.html$/, "");
  var guide = (window.TBCityDiscoveryData || {})[city];
  var profile = (window.TBCityShortcutsData || {})[city];
  if (!guide || !profile) return;
  var key = "tb.discovery." + city + ".v1", cardId = "cityDiscoveryCard";
  var prefs = read(), category = "all", query = "", tab = "explore", picked = "";
  var overlay, panel, launcher, card, previousFocus, inertSiblings = [], lastOrigin = "";
  var kinds = { outdoors:"Fresh air", culture:"Art & stories", food:"Food finds" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function place(id) { return guide.places.filter(function(p){return p.id===id;})[0]; }
  function read() {
    var out = {saved:[], visits:{}};
    try {
      var v = JSON.parse(localStorage.getItem(key) || "null");
      if (!v || typeof v !== "object") return out;
      guide.places.forEach(function(p){
        if(Array.isArray(v.saved) && v.saved.indexOf(p.id)>=0) out.saved.push(p.id);
        var date=v.visits && v.visits[p.id];
        if(typeof date==="string" && isFinite(Date.parse(date))) out.visits[p.id]=new Date(date).toISOString();
      });
    } catch (_) {}
    return out;
  }
  function persist() { try { localStorage.setItem(key,JSON.stringify(prefs)); return true; } catch (_) { return false; } }
  function visited(id) { return Object.prototype.hasOwnProperty.call(prefs.visits,id); }
  function total() { return guide.places.filter(function(p){return visited(p.id);}).length; }
  function origin() {
    try {
      var st=typeof state!=="undefined" ? state : window.state, loc=st && st.loc;
      if(loc && typeof loc.lat==="number" && typeof loc.lon==="number" && isFinite(loc.lat) && isFinite(loc.lon) && Math.abs(loc.lat)<=90 && Math.abs(loc.lon)<=180)
        return {lat:loc.lat,lon:loc.lon,label:loc.label || "the board’s location"};
    } catch (_) {}
    return null;
  }
  function distance(p) {
    var o=origin();if(!o)return null;
    var rad=Math.PI/180,a=Math.sin((p.lat-o.lat)*rad/2),b=Math.sin((p.lon-o.lon)*rad/2);
    var h=a*a+Math.cos(o.lat*rad)*Math.cos(p.lat*rad)*b*b;
    return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function distanceLabel(p) {
    var km=distance(p);if(km===null)return "City pick";
    var metric=["amsterdam","zurich","cologne","stuttgart","rome"].indexOf(city)>=0, n=metric?km:km/1.609344;
    return "≈ "+(n<10?n.toFixed(1):Math.round(n))+ (metric?" km":" mi")+" away";
  }
  function route(p, mode, fromId) {
    var u=new URL("https://www.google.com/maps/dir/");
    u.searchParams.set("api","1");u.searchParams.set("destination",p.name+", "+p.address);
    u.searchParams.set("travelmode",mode==="walking"?"walking":"transit");
    var from=place(fromId),o=origin();
    if(from)u.searchParams.set("origin",from.name+", "+from.address);
    else if(o)u.searchParams.set("origin",o.lat+","+o.lon);
    return u.toString();
  }
  function routeLink(p,label,mode,fromId,cls) {
    return '<a class="'+(cls||'')+'" data-cd-route="'+esc(p.id)+'" data-cd-mode="'+(mode||'transit')+'"'+(fromId?' data-cd-from="'+esc(fromId)+'"':'')+' href="'+esc(route(p,mode,fromId))+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' ↗</a>';
  }
  function compass() { return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/></svg>'; }
  function say(text) { document.getElementById("cdStatus").textContent=text; }
  function filtered() {
    return guide.places.filter(function(p){return (category==="all" || category===p.kind || category==="saved" && prefs.saved.indexOf(p.id)>=0) && (!query || (p.name+" "+p.blurb+" "+p.address).toLowerCase().indexOf(query)>=0);})
      .sort(function(a,b){return (distance(a)||0)-(distance(b)||0);});
  }
  function renderPlaces() {
    var focus=document.activeElement, action=focus && focus.dataset.cdAction, id=focus && focus.dataset.cdId;
    var places=filtered(), grid=document.getElementById("cdPlaces");
    grid.innerHTML=places.map(function(p){
      var done=visited(p.id),saved=prefs.saved.indexOf(p.id)>=0;
      return '<article class="cd-place'+(picked===p.id?' cd-picked':'')+'" data-place="'+esc(p.id)+'" data-kind="'+p.kind+'">'+
        '<div class="cd-place-meta"><span>'+esc(kinds[p.kind])+'</span><span data-cd-distance="'+p.id+'">'+esc(distanceLabel(p))+'</span></div>'+
        '<h3 tabindex="-1">'+esc(p.name)+'</h3><p>'+esc(p.blurb)+'</p><div class="cd-prompt"><span aria-hidden="true">✦</span> '+esc(p.prompt)+'</div>'+
        '<a class="cd-source" href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">Visitor info & tickets ↗</a>'+
        '<div class="cd-place-actions">'+routeLink(p,"Go by transit","transit",null,"cd-primary")+routeLink(p,"Walk","walking")+
        '<button type="button" data-cd-action="save" data-cd-id="'+p.id+'" aria-pressed="'+saved+'" aria-label="'+(saved?'Unsave ':'Save ')+esc(p.name)+'">'+(saved?'Saved ✓':'Save')+'</button></div>'+
        '<div class="cd-stamp-row"><button type="button" class="cd-visit'+(done?' is-visited':'')+'" data-cd-action="visit" data-cd-id="'+p.id+'" aria-pressed="'+done+'">'+(done?'✓ Visited · undo':'I visited · collect stamp')+'</button>'+
        '<button type="button" class="cd-copy" data-cd-action="copy" data-cd-id="'+p.id+'" aria-label="Copy a link to '+esc(p.name)+'">Copy link</button></div></article>';
    }).join("") || '<div class="cd-empty">'+(category==="saved"?'Your next adventure starts with a save. Choose Save on any place to keep it here.':'No matches. Try another search or category.')+'</div>';
    document.getElementById("cdResultCount").textContent=places.length+" "+(places.length===1?"place":"places");
    [].slice.call(panel.querySelectorAll("[data-cd-category]")).forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.cdCategory===category));});
    if(action && id && focus && grid.contains(focus)===false) {
      var replacement=grid.querySelector('[data-cd-action="'+action+'"][data-cd-id="'+id+'"]');
      if(replacement)replacement.focus();else if(!overlay.hidden)document.querySelector('[data-cd-category="'+category+'"]').focus();
    }
  }
  function renderAdventure() {
    var a=guide.adventure,done=a.stops.filter(visited).length;
    document.getElementById("cdAdventure").innerHTML='<div class="cd-section-top"><span class="cd-eyebrow">Two stops. Your pace.</span><span class="cd-count">'+done+'/'+a.stops.length+' visited</span></div><h3>'+esc(a.name)+'</h3><p>'+esc(a.note)+'</p><ol class="cd-steps">'+
      a.stops.map(function(id,i){var p=place(id);return '<li><span class="cd-step-number'+(visited(id)?' done':'')+'">'+(visited(id)?'✓':i+1)+'</span><div><button type="button" data-cd-action="pick" data-cd-id="'+id+'">'+esc(p.name)+'</button>'+routeLink(p,i===0?'Get to the first stop':'Plan the next leg','transit',i?a.stops[i-1]:null)+'</div></li>';}).join("")+'</ol>';
  }
  function renderPassport() {
    var n=total(),a=guide.adventure,mission=a.stops.every(visited);
    document.getElementById("cdPassport").innerHTML='<div class="cd-passport-intro"><div><span class="cd-eyebrow">'+esc(profile.name)+' / personal passport</span><h3>Your city, one stop at a time.</h3><p>You mark visits yourself. Saves and stamps stay in this browser.</p></div><div class="cd-total"><strong>'+n+'</strong><span>of '+guide.places.length+' stamps</span></div></div>'+
      '<div class="cd-progress" role="progressbar" aria-label="Places visited" aria-valuenow="'+n+'" aria-valuemin="0" aria-valuemax="'+guide.places.length+'"><span style="width:'+(n/guide.places.length*100)+'%"></span></div>'+
      '<div class="cd-badges">'+[{name:"First stop",earned:n>0,note:"Mark your first visit.",glyph:"01"},{name:a.name,earned:mission,note:"Visit both adventure stops.",glyph:"02"},{name:"City sampler",earned:n===guide.places.length,note:"Visit every place in this collection.",glyph:"✦"}].map(function(b){return '<div class="cd-badge'+(b.earned?' earned':'')+'"><span class="cd-badge-icon" aria-hidden="true">'+b.glyph+'</span><div><strong>'+esc(b.name)+'</strong><span>'+esc(b.earned?'Collected':b.note)+'</span></div></div>';}).join("")+'</div>'+
      '<div class="cd-stamps">'+guide.places.map(function(p){var done=visited(p.id);return '<article class="cd-stamp'+(done?' stamped':'')+'"><span class="cd-stamp-mark" aria-hidden="true">'+(done?'✓':'·')+'</span><span class="cd-eyebrow">'+esc(kinds[p.kind])+'</span><h4>'+esc(p.name)+'</h4><p>'+esc(done?new Date(prefs.visits[p.id]).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):'A new story awaits.')+'</p><button type="button" data-cd-action="'+(done?'visit':'pick')+'" data-cd-id="'+p.id+'">'+(done?'Undo visit':'Explore this place')+'</button></article>';}).join("")+'</div>';
  }
  function renderCard() {
    if(!card)return;
    var choices=guide.places.filter(function(p){return !visited(p.id);});
    if(!choices.length)choices=guide.places.slice();
    choices.sort(function(a,b){var sa=prefs.saved.indexOf(a.id)>=0,sb=prefs.saved.indexOf(b.id)>=0;return Number(sb)-Number(sa) || (distance(a)||0)-(distance(b)||0);});
    var p=choices[0];
    card.querySelector(".statline").textContent=guide.places.length+" city ideas · "+total()+" passport stamps";
    card.querySelector(".list").innerHTML='<div class="cd-board-pick"><span>'+esc(kinds[p.kind])+'</span><button type="button" data-cd-action="pick" data-cd-id="'+p.id+'">'+esc(p.name)+'</button><p>'+esc(p.prompt)+'</p></div><div class="cd-board-actions"><button type="button" data-cd-action="open">Explore city ↗</button><button type="button" data-cd-action="passport">My passport</button></div>';
    try{if(typeof fitAll==="function")fitAll();}catch(_){}
  }
  function refresh() {
    renderPlaces();renderAdventure();renderPassport();renderCard();
    document.getElementById("cdPassportCount").textContent=total();
    syncOrigin();
  }
  function setTab(next) {
    tab=next;
    document.getElementById("cdExplore").hidden=tab!=="explore";
    document.getElementById("cdPassport").hidden=tab!=="passport";
    document.getElementById("cdSurprise").hidden=tab!=="explore";
    [].slice.call(panel.querySelectorAll("[data-cd-tab]")).forEach(function(b){var on=b.dataset.cdTab===tab;b.setAttribute("aria-selected",String(on));b.tabIndex=on?0:-1;});
    panel.querySelector(".cd-scroll").scrollTop=0;
  }
  function pick(id) {
    if(!place(id))return;
    category="all";query="";picked=id;document.getElementById("cdSearch").value="";
    setTab("explore");renderPlaces();
    var el=panel.querySelector('[data-place="'+id+'"]');
    el.scrollIntoView({block:"center",behavior:"auto"});el.querySelector("h3").focus();
    say("Try "+place(id).name+". Check visitor information before setting off.");
  }
  function open(id,nextTab) {
    if(overlay.hidden){
      previousFocus=document.activeElement;
      if(window.TBCityToolkit)window.TBCityToolkit.close();
      overlay.hidden=false;launcher.setAttribute("aria-expanded","true");
      inertSiblings=[];
      [].slice.call(document.body.children).forEach(function(e){if(e!==overlay && !e.hasAttribute("inert")){e.setAttribute("inert","");inertSiblings.push(e);}});
      refresh();say("");setTab(nextTab || "explore");document.getElementById("cdClose").focus();
    }else if(nextTab)setTab(nextTab);
    if(id)pick(id);
  }
  function close() {
    if(overlay.hidden)return;
    overlay.hidden=true;launcher.setAttribute("aria-expanded","false");
    inertSiblings.forEach(function(e){e.removeAttribute("inert");});inertSiblings=[];
    if(previousFocus && previousFocus.isConnected && previousFocus.getClientRects().length)previousFocus.focus();else launcher.focus();
  }
  function syncOrigin() {
    var o=origin();document.getElementById("cdOrigin").textContent=o?o.label:"your starting point in Google Maps";
    [].slice.call(panel.querySelectorAll("[data-cd-route]")).forEach(function(a){a.href=route(place(a.dataset.cdRoute),a.dataset.cdMode,a.dataset.cdFrom);});
    [].slice.call(panel.querySelectorAll("[data-cd-distance]")).forEach(function(e){e.textContent=distanceLabel(place(e.dataset.cdDistance));});
  }
  function copyLink(id) {
    var u=new URL(location.pathname,location.origin);u.hash="explore="+encodeURIComponent(id);
    function fallback(){var box=document.getElementById("cdShare");box.hidden=false;var input=box.querySelector("input");input.value=u.toString();input.focus();input.select();say("Copy this place link. Your location and passport are not included.");}
    if(navigator.clipboard && navigator.clipboard.writeText)navigator.clipboard.writeText(u.toString()).then(function(){say("Place link copied. Your location and passport are not included.");},fallback);else fallback();
  }
  function act(e) {
    var b=e.target.closest("[data-cd-action]");if(!b)return;
    var action=b.dataset.cdAction,id=b.dataset.cdId,p=place(id);
    if(action==="open"){open();return;}
    if(action==="passport"){open(null,"passport");return;}
    if(!p)return;
    if(action==="pick"){open(id);return;}
    if(action==="copy"){copyLink(id);return;}
    if(action==="save"){
      var i=prefs.saved.indexOf(id);if(i<0)prefs.saved.push(id);else prefs.saved.splice(i,1);
      var stored=persist();refresh();say((i<0?p.name+" saved for later.":p.name+" removed from saved places.")+(stored?"":" Saved for this visit; browser storage is unavailable."));
    }
    if(action==="visit"){
      var undo=visited(id);if(undo)delete prefs.visits[id];else prefs.visits[id]=new Date().toISOString();
      var kept=persist();refresh();
      if(tab==="passport"){var next=panel.querySelector('#cdPassport [data-cd-id="'+id+'"]');if(next)next.focus();}
      say((undo?"Visit removed. You can collect the stamp again anytime.":"Stamp collected for "+p.name+"! "+total()+" of "+guide.places.length+" places visited.")+(kept?"":" Saved for this visit; browser storage is unavailable."));
    }
  }
  function deepLink() { var m=/^#explore=([\w-]+)$/.exec(location.hash);if(m && place(m[1]))open(m[1]); }
  try{if(typeof CARD_DEFS!=="undefined" && !CARD_DEFS.some(function(d){return d.id===cardId;}))CARD_DEFS.push({id:cardId,label:"Explore "+profile.name});}catch(_){}
  function init() {
    var header=document.querySelector("#app > header"),cards=document.querySelector(".cards");
    if(!header || !cards || document.getElementById("cityDiscovery"))return;
    launcher=document.createElement("button");launcher.id="cityDiscoveryBtn";launcher.type="button";launcher.className="cd-launch";launcher.innerHTML=compass()+'<span>Explore</span>';
    launcher.setAttribute("aria-label","Explore "+profile.name+" and your city passport");launcher.setAttribute("aria-haspopup","dialog");launcher.setAttribute("aria-controls","cityDiscovery");launcher.setAttribute("aria-expanded","false");
    header.insertBefore(launcher,document.getElementById("cityToolkitBtn") || document.getElementById("settingsBtn"));launcher.onclick=function(){open();};
    overlay=document.createElement("div");overlay.id="cityDiscovery";overlay.className="cd-overlay";overlay.hidden=true;
    overlay.innerHTML='<section class="cd-panel" role="dialog" aria-modal="true" aria-labelledby="cdTitle"><header class="cd-heading"><div><div class="cd-eyebrow">'+esc(profile.name)+' / beyond the next stop</div><h2 id="cdTitle">Make a day of it.</h2><p>'+esc(guide.edition)+'</p></div><button type="button" id="cdClose" aria-label="Close city discovery">×</button></header>'+
      '<div class="cd-nav"><div role="tablist" aria-label="Discovery and passport"><button role="tab" id="cdExploreTab" data-cd-tab="explore" aria-controls="cdExplore" aria-selected="true">Explore the city</button><button role="tab" id="cdPassportTab" data-cd-tab="passport" aria-controls="cdPassport" aria-selected="false" tabindex="-1">My passport <span id="cdPassportCount">0</span></button></div><button type="button" id="cdSurprise">✦ Surprise me</button></div>'+
      '<div class="cd-scroll"><section id="cdExplore" role="tabpanel" aria-labelledby="cdExploreTab"><section id="cdAdventure" class="cd-adventure"></section><div class="cd-origin">Starting from <strong id="cdOrigin"></strong><span>Approximate straight-line distances. Google Maps plans the actual journey.</span></div>'+
      '<div class="cd-filters" role="group" aria-label="Filter city places"><button type="button" data-cd-category="all" aria-pressed="true">All ideas</button>'+Object.keys(kinds).filter(function(k){return guide.places.some(function(p){return p.kind===k;});}).map(function(k){return '<button type="button" data-cd-category="'+k+'" aria-pressed="false">'+kinds[k]+'</button>';}).join("")+'<button type="button" data-cd-category="saved" aria-pressed="false">Saved</button></div>'+
      '<div class="cd-search"><label class="cd-sr" for="cdSearch">Search city places</label><input type="search" id="cdSearch" placeholder="Find your next stop…" autocomplete="off"><span id="cdResultCount" role="status"></span></div><div class="cd-places" id="cdPlaces"></div></section><section id="cdPassport" role="tabpanel" aria-labelledby="cdPassportTab" hidden></section></div>'+
      '<footer class="cd-foot"><div id="cdShare" hidden><label for="cdShareLink">Place link</label><input id="cdShareLink" readonly><button type="button" id="cdShareClose">Done</button></div><p id="cdStatus" role="status" aria-live="polite"></p><span>Check each destination’s visitor info for current hours, access and tickets.</span></footer></section>';
    document.body.appendChild(overlay);panel=overlay.querySelector(".cd-panel");
    document.getElementById("cdClose").onclick=close;overlay.onclick=function(e){if(e.target===overlay)close();else act(e);};
    document.getElementById("cdSearch").oninput=function(e){query=e.target.value.trim().toLowerCase();renderPlaces();};
    panel.addEventListener("click",function(e){var c=e.target.closest("[data-cd-category]"),t=e.target.closest("[data-cd-tab]");if(c){category=c.dataset.cdCategory;renderPlaces();}if(t)setTab(t.dataset.cdTab);});
    ["pointerdown","focusin","click"].forEach(function(event){panel.addEventListener(event,function(e){if(e.target.closest("[data-cd-route]"))syncOrigin();});});
    document.getElementById("cdSurprise").onclick=function(){var all=filtered(),choices=all.filter(function(p){return !visited(p.id) && p.id!==picked;});if(!choices.length)choices=all.filter(function(p){return p.id!==picked;});if(!choices.length)choices=all;if(!choices.length){say("No ideas match this filter. Try All ideas first.");return;}pick(choices[Math.floor(Math.random()*choices.length)].id);};
    document.getElementById("cdShareClose").onclick=function(){document.getElementById("cdShare").hidden=true;document.getElementById("cdClose").focus();};
    window.addEventListener("keydown",function(e){
      if(overlay.hidden)return;
      var buttons=[].slice.call(panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')).filter(function(n){return n.getClientRects().length;});
      if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();close();return;}
      if(e.key==="Tab"){var first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey && (document.activeElement===first || buttons.indexOf(document.activeElement)<0)){e.preventDefault();last.focus();}else if(!e.shiftKey && (document.activeElement===last || buttons.indexOf(document.activeElement)<0)){e.preventDefault();first.focus();}e.stopImmediatePropagation();return;}
      if((e.key==="ArrowLeft" || e.key==="ArrowRight") && e.target.hasAttribute("data-cd-tab")){e.preventDefault();e.stopImmediatePropagation();setTab(tab==="explore"?"passport":"explore");panel.querySelector('[data-cd-tab="'+tab+'"]').focus();return;}
      if(e.key==="ArrowDown" || e.key==="ArrowUp"){e.preventDefault();e.stopImmediatePropagation();var i=buttons.indexOf(document.activeElement),step=e.key==="ArrowDown"?1:-1;buttons[(i+step+buttons.length)%buttons.length].focus();}
    },true);
    card=document.createElement("div");card.id=cardId;card.className="card";card.style.setProperty("--sys","#00bca8");card.innerHTML='<h2><span class="t">Explore '+esc(profile.name)+'</span></h2><div class="statline"></div><div class="list" data-scroll-list="true" data-want="130"></div>';
    cards.appendChild(card);card.addEventListener("click",act);
    try{if(typeof loadHiddenCards==="function" && loadHiddenCards().has(cardId))card.classList.add("user-hidden");if(typeof initMiniCards==="function")initMiniCards();}catch(_){}
    refresh();setTab("explore");
    addEventListener("storage",function(e){if(e.key===key || e.key===null){prefs=read();refresh();}});
    addEventListener("hashchange",deepLink);deepLink();
    setInterval(function(){var o=origin(),value=o?o.lat+","+o.lon+","+o.label:"";if(value!==lastOrigin){lastOrigin=value;if(!overlay.hidden){syncOrigin();renderPlaces();}renderCard();}},2000);
    window.TBCityDiscovery={open:open,close:close};
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
