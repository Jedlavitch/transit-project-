/* On-demand trip planning and foreground guidance. Existing board feeds,
   location settings, commute preferences and accounts are never written. */
(function () {
  "use strict";
  var city = location.pathname.split("/").pop().replace(/\.html$/, "") || "board";
  var profile = (window.TBCityShortcutsData || {})[city] || {name: "your city", places: []};
  var key = "tb.journeys." + city + ".v1", activeKey = key + ".active";
  var saved = readSaved(), from = null, to = null, options = [], active = readActive();
  var overlay, panel, launcher, dock, previousFocus, inerted = [], searches = {}, planRequest;
  var version = 0, resultsVersion = -1, fetchedAt = 0, gps = null, watch = null, gpsStatus = "";
  var candidates = {from: [], to: []}, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function valid(p) { return p && typeof p.label === "string" && p.label.trim() && typeof p.lat === "number" && isFinite(p.lat) && Math.abs(p.lat) <= 90 && typeof p.lon === "number" && isFinite(p.lon) && Math.abs(p.lon) <= 180; }
  function copy(p) { var out={label:p.label.slice(0,160),lat:p.lat,lon:p.lon};if(typeof p.stopId==="string"&&p.stopId.trim()&&p.stopId.length<=2000)out.stopId=p.stopId.trim();return out; }
  function read(k, fallback) { try { var p=JSON.parse(localStorage.getItem(k)||"null");return p==null?fallback:p; } catch(_){return fallback;} }
  function store(k,v) { try { if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,JSON.stringify(v));return true; } catch(_){return false;} }
  function readSaved() { var p=read(key,[]);return Array.isArray(p)?p.filter(valid).slice(0,12).map(copy):[]; }
  function readActive() {
    var p=read(activeKey,null);
    if(!p || !valid(p.from) || !valid(p.to) || !p.trip || !Array.isArray(p.trip.legs) || !p.trip.legs.length || p.trip.legs.length>40 || !Number.isInteger(p.step) || p.step<0 || p.step>=p.trip.legs.length || !isFinite(p.trip.end) || !isFinite(p.fetchedAt))return null;
    if(p.trip.end<Date.now()-86400000 || !p.trip.legs.every(function(l){return l&&valid(l.from)&&valid(l.to)&&typeof l.start==="number"&&isFinite(l.start)&&typeof l.end==="number"&&isFinite(l.end)&&l.end>=l.start&&typeof l.duration==="number"&&isFinite(l.duration)&&l.duration>=0&&typeof l.mode==="string"&&Array.isArray(l.stops)&&l.stops.length<=500&&l.stops.every(valid);}))return null;
    return p;
  }
  function boardLocation() { try { return typeof state!=="undefined" && valid(state.loc)?copy(state.loc):null; } catch(_){return null;} }
  function time(t) { return new Date(t).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}); }
  function date(t) { return new Date(t).toLocaleDateString([], {month:"short",day:"numeric"}); }
  function range(t) { return date(t.start)+" · "+time(t.start)+"–"+(new Date(t.end).toDateString()!==new Date(t.start).toDateString()?date(t.end)+" ":"")+time(t.end); }
  function walk(l) { return l.mode==="WALK" || l.mode==="FOOT"; }
  function label(l) { return walk(l)?"Walk":(l.route || l.mode.toLowerCase().replace(/_/g," ")); }
  function say(s) { $("jpMessage").textContent=s; }
  function invalidate() { version++;if(planRequest)planRequest.abort();options=[];$("jpPlan").disabled=false;$("jpPlan").textContent="Find my route";renderContent();fallback(); }
  function choose(field,p) {
    if(!valid(p))return;
    if(searches[field])searches[field].abort();
    if(field==="from")from=copy(p);else to=copy(p);
    $(field==="from"?"jpFrom":"jpTo").value=p.label;
    $(field==="from"?"jpFromResults":"jpToResults").hidden=true;
    invalidate();say("");
  }
  function current() { var p=boardLocation();if(p)choose("from",p);else say("The board is still locating. Search for a starting point instead."); }
  function fallback() {
    var link=$("jpFallback");if(!link)return;
    var url="https://www.google.com/maps/dir/?api=1&travelmode=transit";
    if(from)url+="&origin="+encodeURIComponent(from.lat+","+from.lon);
    if(to)url+="&destination="+encodeURIComponent(to.lat+","+to.lon);
    link.href=url;link.hidden=!to;
  }
  function availablePlaces() {
    var old=read("tb.cityShortcuts."+city+".places",[]);
    return (Array.isArray(old)?old.filter(valid).slice(0,6):[]).concat(profile.places || []);
  }
  function renderSaved() {
    $("jpSaved").innerHTML=saved.length?saved.map(function(p,i){return '<div class="jp-place"><button type="button" class="jp-place-main" data-jp-saved="'+i+'"><span>'+esc(p.label)+'</span><small>Plan a trip here</small></button><button type="button" class="jp-delete" data-jp-delete="'+i+'" aria-label="Remove '+esc(p.label)+'">×</button></div>';}).join(""):'<p class="jp-save-note">Save Home, Work, or somewhere you love. Choose a destination, then save it below.</p>';
    $("jpSuggestions").innerHTML=availablePlaces().slice(0,10).map(function(p,i){return '<button type="button" class="jp-chip" data-jp-place="'+i+'">'+esc(p.label)+'</button>';}).join("");
  }
  function savePlace(name) {
    if(!to){say("Choose a destination to save first.");return;}
    name=String(name||"").trim().slice(0,64);if(!name){say("Give this place a name.");return;}
    var p=copy(to);p.label=name;
    var existing=saved.findIndex(function(s){return s.label.toLowerCase()===name.toLowerCase();});
    if(existing<0&&saved.length>=12){say("You can save 12 places per city. Remove one to add another.");return;}
    if(existing>=0)saved[existing]=p;else saved.push(p);
    var ok=store(key,saved);renderSaved();say(ok?name+" saved on this device.":name+" saved for this visit. Browser storage is unavailable.");
  }
  async function search(field) {
    var input=$(field==="from"?"jpFrom":"jpTo"), box=$(field==="from"?"jpFromResults":"jpToResults"), q=input.value.trim();
    if(q.length<2){say("Enter at least two characters to search.");return;}
    if(searches[field])searches[field].abort();var controller=new AbortController();searches[field]=controller;
    box.hidden=true;say("Finding places…");
    try {
      var bias=boardLocation()||from;
      var places=await window.TBTripCore.geocode(q,bias,controller.signal);
      if(controller.signal.aborted||input.value.trim()!==q)return;
      candidates[field]=places.filter(valid).slice(0,7);
      box.innerHTML=candidates[field].map(function(p,i){return '<li><button type="button" data-jp-result="'+field+'" data-index="'+i+'">'+esc(p.label)+(p.detail?'<small>'+esc(p.detail)+'</small>':'')+'</button></li>';}).join("");
      box.hidden=!candidates[field].length;say(candidates[field].length?"Choose a matching place.":"No matching place found. Try a station name or a fuller address.");
      if(candidates[field].length && (document.activeElement===input || document.activeElement===panel.querySelector('[data-jp-search="'+field+'"]')))box.querySelector("button").focus();
    } catch(e){if(e.name!=="AbortError")say(e.message||"Place search is unavailable. Try a saved place.");}
  }
  function chosenTime() { return $("jpWhen").value==="now"?new Date():new Date($("jpDate").value); }
  async function plan() {
    if(!from || !to){say("Choose both a starting point and a destination from the search results or saved places.");return;}
    var when=chosenTime();if(!isFinite(when.getTime())){say("Choose a valid date and time.");return;}
    if(when.getTime()<Date.now()-60000){say("Choose a future time, or Leave now.");return;}
    if(planRequest)planRequest.abort();var controller=new AbortController();planRequest=controller;var revision=version;
    $("jpPlan").disabled=true;$("jpPlan").textContent="Finding routes…";say("Searching transit connections. Your two places are sent to the routing service.");
    try {
      var trips=await window.TBTripCore.plan({from:from,to:to,when:when,arriveBy:$("jpWhen").value==="arrive"},controller.signal);
      if(controller.signal.aborted||revision!==version)return;
      if(active){stopGPS();active=null;store(activeKey,null);updateDock();}
      options=trips;resultsVersion=version;fetchedAt=Date.now();say(trips.length+" route "+(trips.length===1?"option":"options")+" found. Check your operator for current disruptions.");renderContent();
      $("jpContent").scrollIntoView({block:"nearest",behavior:"auto"});
    } catch(e){if(e.name!=="AbortError"){options=[];renderContent();say((e.message||"Trip planning is unavailable.")+" You can also open this trip in Google Maps.");}}
    finally {if(planRequest===controller){$("jpPlan").disabled=false;$("jpPlan").textContent="Find my route";}}
  }
  function timeline(trip) {
    return '<ol class="jp-timeline">'+trip.legs.map(function(l){return '<li><b>'+esc(time(l.start))+" · "+esc(walk(l)?"Walk to "+l.to.label:label(l)+" toward "+(l.headsign||l.to.label))+'</b><small>'+esc(l.from.label)+" → "+esc(l.to.label)+(l.platform?" · Platform "+esc(l.platform):"")+" · "+Math.ceil(l.duration)+" min · "+(l.realTime?"Live prediction":"Scheduled")+'</small></li>';}).join("")+'</ol>';
  }
  function renderContent() {
    if(!panel)return;
    if(active){renderGuide();return;}
    var content=$("jpContent"), sort=$("jpSort")?$("jpSort").value:"fast";
    if(!options.length){content.innerHTML='<div class="jp-empty"><div class="jp-empty-symbol" aria-hidden="true">↗</div><h3>A plan for the whole trip.</h3><p>Compare routes, save your regular places, and take each connection one step at a time.</p><div class="jp-sectionlabel">Try a city connection</div><div class="jp-chips">'+(profile.places||[]).slice(0,4).map(function(p,i){return '<button type="button" class="jp-chip" data-jp-place="'+i+'" data-curated="true">'+esc(p.label)+'</button>';}).join("")+'</div></div>';return;}
    var order=options.map(function(t,i){return {t:t,i:i};}).sort(function(a,b){return sort==="walk"?a.t.walkMinutes-b.t.walkMinutes:sort==="changes"?a.t.transfers-b.t.transfers:a.t.duration-b.t.duration;});
    content.innerHTML='<div class="jp-labelrow"><h3>Ways to get there</h3><select id="jpSort" aria-label="Sort route options"><option value="fast">Shortest trip</option><option value="walk">Less walking</option><option value="changes">Fewer transfers</option></select></div>'+order.map(function(item){var t=item.t;return '<article class="jp-option"><div class="jp-option-top"><span>'+esc(range(t))+'</span><strong>'+Math.ceil(t.duration)+' min</strong></div><div class="jp-routes">'+t.legs.map(function(l){return '<span class="jp-route">'+esc(label(l))+'</span>';}).join('<span class="jp-separator" aria-hidden="true">›</span>')+'</div><div class="jp-option-meta">'+t.transfers+' '+(t.transfers===1?"transfer":"transfers")+' · '+Math.ceil(t.walkMinutes)+' min walking · '+(t.cancelled?"Cancelled":t.realTime?"Includes live predictions":"Scheduled times")+'</div><div class="jp-option-actions"><button type="button" class="jp-primary" data-jp-go="'+item.i+'"'+(t.cancelled?' disabled':'')+'>Start guidance</button></div><details><summary>See every step</summary>'+timeline(t)+'</details></article>';}).join("")+'<p class="jp-save-note">Routes checked '+esc(time(fetchedAt))+'. Times can change. Walking times and transfers are estimates.</p>';
    $("jpSort").value=sort;
  }
  function start(index) {
    var t=options[index];if(!t || t.cancelled || resultsVersion!==version)return;
    if(t.start<Date.now()-60000){say("This route has already started. Find a fresh route before starting guidance.");return;}
    if(active)stopGPS();
    active={trip:t,step:0,from:copy(from),to:copy(to),fetchedAt:fetchedAt};
    var ok=store(activeKey,active);renderContent();updateDock();
    say(ok?"Trip started. Mark each step complete as you go.":"Trip started for this visit; browser storage is unavailable.");
    $("jpNext").focus();
  }
  function renderGuide() {
    var l=active.trip.legs[active.step], last=active.step===active.trip.legs.length-1;
    var next=active.trip.legs[active.step+1], stay=next&&!walk(next)&&next.interlineWithPreviousLeg===true;
    $("jpContent").innerHTML='<div class="jp-labelrow"><h3>Your trip to '+esc(active.to.label)+'</h3></div><section class="jp-guidance" aria-label="Current journey step"><div class="jp-step-kicker">Step '+(active.step+1)+' of '+active.trip.legs.length+' · '+(l.realTime?'Prediction at planning time':'Scheduled')+'</div><h3>'+esc(walk(l)?"Walk to "+l.to.label:"Take "+label(l))+'</h3><div class="jp-guide-to">'+esc(walk(l)?"From "+l.from.label:"From "+l.from.label+" toward "+(l.headsign||l.to.label))+(walk(l)?'':'<br>Get off at <b>'+esc(l.to.label)+'</b>')+(l.platform?'<br>Platform '+esc(l.platform):'')+'</div><div class="jp-countdown" id="jpCountdown" role="timer"></div>'+(!walk(l)?'<details><summary>'+Math.max(0,l.stops.length-2)+' intermediate stops</summary><ol class="jp-timeline">'+l.stops.map(function(s){return '<li>'+esc(s.label)+(s.cancelled?' · Skipped stop':'')+(s.arrival?'<small>'+esc(time(s.arrival))+'</small>':'')+'</li>';}).join("")+'</ol></details>':'')+'<div class="jp-guide-actions"><button type="button" id="jpPrevious"'+(active.step===0?' disabled':'')+'>Back</button><button type="button" class="jp-primary" id="jpNext">'+(last?'Finish trip':walk(l)?'I’m there':'I’ve got off')+'</button></div><div class="jp-guide-actions"><button type="button" id="jpGPS">'+(watch!==null?'Stop location':'Use my location')+'</button><button type="button" id="jpReplan">Replan trip</button><button type="button" id="jpEnd">End trip</button></div><p class="jp-location-note" id="jpLocation"></p></section><p class="jp-save-note">Keep this page open for guidance. Steps advance when you confirm them. Times are a snapshot from '+esc(date(active.fetchedAt)+" "+time(active.fetchedAt))+', and are not refreshed automatically. Check station signs and operator alerts.</p>'+timeline(active.trip);
    if(stay){var target=panel.querySelector(".jp-guide-to b");if(target&&target.parentNode)target.parentNode.innerHTML=esc("From "+l.from.label+" toward "+(l.headsign||l.to.label))+'<br>Stay on board at <b>'+esc(l.to.label)+'</b> for '+esc(label(next))+'.';$("jpNext").textContent="Continue on board";}
    if(l.interlineWithPreviousLeg&&!walk(l))panel.querySelector(".jp-guidance h3").textContent="Stay on board for "+label(l);
    updateCountdown();updateLocation();
  }
  function updateCountdown() {
    var el=$("jpCountdown");if(!active||!el)return;
    var l=active.trip.legs[active.step], mins=Math.ceil((l.start-Date.now())/60000), remaining=Math.ceil((l.end-Date.now())/60000);
    var top=mins>0?"Starts in "+mins+" min":remaining>=0?"Planned step underway":"Planned time has passed";
    el.innerHTML='<strong>'+esc(top)+'</strong>'+esc(time(l.start)+"–"+time(l.end))+" · "+Math.ceil(l.duration)+" min"+(remaining<0?'<br><span class="jp-warning">Behind the plan? Replan for current connections.</span>':'');
  }
  function distance(a,b) { var r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lon-a.lon)*r,x=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x))); }
  function updateLocation() {
    if(!active||!$("jpLocation"))return;
    var note=gpsStatus || "Location is optional. It stays on this device during guidance; route searches send the selected start and destination to the routing service.";
    if(gps){var d=distance(gps,active.trip.legs[active.step].to),stale=Date.now()-gps.time>45000;
      note=stale?"Location is out of date. Use station signs to confirm your stop.":gps.accuracy>100?"Location is approximate (±"+Math.round(gps.accuracy)+" m). Use signs to confirm your stop.":(d<150?"Near your stop. Check the station name before getting off.":d<1000?Math.round(d/10)*10+" m to this step’s destination, in a straight line.":(d/1000).toFixed(1)+" km to this step’s destination, in a straight line.");
    }
    $("jpLocation").textContent=note;
  }
  function stopGPS() { if(watch!==null&&navigator.geolocation)navigator.geolocation.clearWatch(watch);watch=null;gps=null;gpsStatus=""; }
  function toggleGPS() {
    if(watch!==null){stopGPS();renderGuide();return;}
    if(!navigator.geolocation){gpsStatus="Location is unavailable in this browser. You can still follow and complete each step.";updateLocation();return;}
    gpsStatus="Waiting for location permission…";updateLocation();
    watch=navigator.geolocation.watchPosition(function(p){if(!active)return;gps={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,time:p.timestamp};gpsStatus="";updateLocation();},function(){stopGPS();gpsStatus="Location is unavailable or permission was declined. Follow station signs and complete each step manually.";if(active)renderGuide();},{enableHighAccuracy:true,maximumAge:10000,timeout:15000});
    renderGuide();
  }
  function end(done) { stopGPS();active=null;store(activeKey,null);renderContent();updateDock();say(done?"You’ve arrived. Ready for your next trip?":"Trip ended."); }
  function updateDock() { if(!dock)return;dock.hidden=!active||!overlay.hidden;if(active)dock.querySelector("span").textContent="Trip to "+active.to.label; }
  function open() {
    if(!overlay.hidden)return;
    if(window.TBCityToolkit)window.TBCityToolkit.close();
    previousFocus=document.activeElement;
    if(!from){var p=boardLocation();if(p){from=p;$("jpFrom").value=p.label;}}
    renderSaved();renderContent();fallback();overlay.hidden=false;launcher.setAttribute("aria-expanded","true");
    inerted=[];[].slice.call(document.body.children).forEach(function(el){if(el!==overlay&&!el.hasAttribute("inert")){el.setAttribute("inert","");inerted.push(el);}});
    updateDock();$("jpClose").focus();
  }
  function close() { if(overlay.hidden)return;if(planRequest)planRequest.abort();Object.keys(searches).forEach(function(k){searches[k].abort();});overlay.hidden=true;launcher.setAttribute("aria-expanded","false");inerted.forEach(function(el){el.removeAttribute("inert");});inerted=[];updateDock();if(previousFocus&&previousFocus.isConnected)previousFocus.focus(); }
  function setDate() { var d=new Date(Date.now()+15*60000);d=new Date(d.getTime()-d.getTimezoneOffset()*60000);$("jpDate").value=d.toISOString().slice(0,16); }
  function init() {
    if(!window.TBTripCore)return;
    var header=document.querySelector("#app header");if(!header)return;
    launcher=document.createElement("button");launcher.type="button";launcher.id="tripPlannerBtn";launcher.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h8a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h8"/></svg><span>Plan trip</span>';launcher.setAttribute("aria-haspopup","dialog");launcher.setAttribute("aria-expanded","false");launcher.setAttribute("aria-controls","tripPlanner");header.insertBefore(launcher,$("cityToolkitBtn")||$("settingsBtn")||header.lastElementChild);
    overlay=document.createElement("div");overlay.id="tripPlanner";overlay.hidden=true;
    overlay.innerHTML='<section class="jp-panel" role="dialog" aria-modal="true" aria-labelledby="jpTitle"><div class="jp-header"><div><div class="jp-kicker">TRANSIT PROJECT / JOURNEYS</div><h2 id="jpTitle">Where are we going?</h2><p>Plan it. Save it. Take it one step at a time.</p></div><button type="button" class="jp-close" id="jpClose" aria-label="Close trip planner">×</button></div><div class="jp-body"><div class="jp-sidebar"><form id="jpForm"><div class="jp-field"><label for="jpFrom">Starting from</label><div class="jp-inputrow"><input id="jpFrom" autocomplete="off" placeholder="Address or station"><button type="button" class="jp-search" data-jp-search="from" aria-label="Search starting point">Find</button></div><ul id="jpFromResults" class="jp-results" aria-label="Starting point matches" hidden></ul><div class="jp-under"><button type="button" class="jp-textbtn" id="jpBoardOrigin">Use board location</button><button type="button" class="jp-textbtn" id="jpSwap">Swap places ↕</button></div></div><div class="jp-field"><label for="jpTo">Going to</label><div class="jp-inputrow"><input id="jpTo" autocomplete="off" placeholder="Where do you want to go?"><button type="button" class="jp-search" data-jp-search="to" aria-label="Search destination">Find</button></div><ul id="jpToResults" class="jp-results" aria-label="Destination matches" hidden></ul></div><div class="jp-time"><select id="jpWhen" aria-label="Trip timing"><option value="now">Leave now</option><option value="depart">Leave at…</option><option value="arrive">Arrive by…</option></select><input id="jpDate" type="datetime-local" aria-label="Trip date and time" hidden></div><p class="jp-time-note">Times shown in '+esc(timezone)+'.</p><button type="submit" class="jp-primary" id="jpPlan">Find my route</button><p class="jp-message" id="jpMessage" role="status" aria-live="polite"></p><a id="jpFallback" class="jp-fallback" target="_blank" rel="noopener noreferrer" hidden>Open this trip in Google Maps ↗</a></form><section class="jp-saved"><h3 class="jp-sectionlabel">Your places</h3><div id="jpSaved"></div><details class="jp-save-editor"><summary>Save this destination</summary><input id="jpPlaceName" placeholder="Give this place a name" aria-label="Saved place name" maxlength="64"><div class="jp-chips"><button type="button" class="jp-chip" data-jp-save="Home">⌂ Home</button><button type="button" class="jp-chip" data-jp-save="Work">▣ Work</button><button type="button" class="jp-chip" id="jpSaveCustom">Save place</button></div></details><p class="jp-save-note">Saved for this city on this device.</p><details class="jp-save-editor"><summary>City connections & saved shortcuts</summary><div class="jp-chips" id="jpSuggestions" style="margin-top:12px"></div></details></section></div><div class="jp-content" id="jpContent"></div></div><footer class="jp-footer"><span>Routing: <a href="https://transitous.org/sources/" target="_blank" rel="noopener noreferrer">Transitous & data sources</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></span><a href="https://github.com/Jedlavitch/transit-project-/issues" target="_blank" rel="noopener noreferrer">Questions & feedback ↗</a></footer></section>';
    document.body.appendChild(overlay);panel=overlay.querySelector(".jp-panel");
    dock=document.createElement("div");dock.className="jp-dock";dock.hidden=true;dock.innerHTML='<span></span><button type="button">Continue trip</button>';document.body.appendChild(dock);dock.querySelector("button").onclick=open;
    launcher.onclick=open;$("jpClose").onclick=close;overlay.addEventListener("click",function(e){if(e.target===overlay)close();});
    $("jpForm").onsubmit=function(e){e.preventDefault();plan();};$("jpBoardOrigin").onclick=current;
    ["from","to"].forEach(function(field){var input=$(field==="from"?"jpFrom":"jpTo");input.oninput=function(){if(field==="from")from=null;else to=null;if(searches[field])searches[field].abort();$(field==="from"?"jpFromResults":"jpToResults").hidden=true;invalidate();};input.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();search(field);}});});
    $("jpSwap").onclick=function(){var f=from;from=to;to=f;$("jpFrom").value=from?from.label:"";$("jpTo").value=to?to.label:"";["from","to"].forEach(function(f){if(searches[f])searches[f].abort();$(f==="from"?"jpFromResults":"jpToResults").hidden=true;});invalidate();};
    $("jpWhen").onchange=function(){$("jpDate").hidden=this.value==="now";invalidate();};$("jpDate").onchange=invalidate;setDate();
    var privacy=document.createElement("p");privacy.className="jp-save-note";privacy.textContent="Place searches share your search text and board area with the routing service. Route searches share the selected start and destination.";$("jpForm").appendChild(privacy);
    var cfg=window.TB_CONFIG||{}, provider=panel.querySelector('.jp-footer a'),isDefault=true;
    try{isDefault=!cfg.journeyApi||new URL(cfg.journeyApi,location.href).hostname==="api.transitous.org";}catch(_){isDefault=false;}
    if(!isDefault){provider.textContent=typeof cfg.journeyProviderName==="string"&&cfg.journeyProviderName.trim()?cfg.journeyProviderName.trim().slice(0,100):"Journey routing service";provider.removeAttribute("href");if(typeof cfg.journeyProviderUrl==="string"){try{var providerUrl=new URL(cfg.journeyProviderUrl);if(providerUrl.protocol==="https:")provider.href=providerUrl.href;}catch(_){}}}
    panel.addEventListener("change",function(e){if(e.target.id==="jpSort"){renderContent();$("jpSort").focus();}});
    panel.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;
      if(b.hasAttribute("data-jp-search"))search(b.dataset.jpSearch);
      else if(b.hasAttribute("data-jp-result"))choose(b.dataset.jpResult,candidates[b.dataset.jpResult][+b.dataset.index]);
      else if(b.hasAttribute("data-jp-saved"))choose("to",saved[+b.dataset.jpSaved]);
      else if(b.hasAttribute("data-jp-place"))choose("to",(b.hasAttribute("data-curated")?profile.places:availablePlaces())[+b.dataset.jpPlace]);
      else if(b.hasAttribute("data-jp-delete")){saved.splice(+b.dataset.jpDelete,1);var ok=store(key,saved);renderSaved();say(ok?"Saved place removed.":"Removed for this visit; browser storage is unavailable.");var nextSaved=panel.querySelector('[data-jp-saved]');(nextSaved||$("jpTo")).focus();}
      else if(b.hasAttribute("data-jp-save"))savePlace(b.dataset.jpSave);
      else if(b.id==="jpSaveCustom")savePlace($("jpPlaceName").value);
      else if(b.hasAttribute("data-jp-go"))start(+b.dataset.jpGo);
      else if(b.id==="jpEnd"){end(false);$("jpPlan").focus();}
      else if(b.id==="jpNext"){if(active.step===active.trip.legs.length-1){end(true);$("jpPlan").focus();}else{active.step++;store(activeKey,active);renderGuide();$("jpNext").focus();}}
      else if(b.id==="jpPrevious"){active.step=Math.max(0,active.step-1);store(activeKey,active);renderGuide();$("jpNext").focus();}
      else if(b.id==="jpGPS"){toggleGPS();$("jpGPS").focus();}
      else if(b.id==="jpReplan"){var a=active,here=gps&&Date.now()-gps.time<45000&&gps.accuracy<=100?{label:"Current position",lat:gps.lat,lon:gps.lon}:a.from;end(false);choose("from",here);choose("to",a.to);$("jpWhen").value="now";$("jpDate").hidden=true;plan();}
    });
    function focusables(){return [].slice.call(panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select,summary')).filter(function(n){return n.getClientRects().length;});}
    document.addEventListener("keydown",function(e){if(overlay.hidden)return;if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();close();return;}var nodes=focusables(),first=nodes[0],last=nodes[nodes.length-1];if(e.key==="Tab"){if(e.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){e.preventDefault();first.focus();}}else if((e.key==="ArrowDown"||e.key==="ArrowUp")&&!/^(SELECT|TEXTAREA)$/.test(e.target.tagName)&&e.target.type!=="datetime-local"){var at=nodes.indexOf(document.activeElement),next=Math.max(0,Math.min(nodes.length-1,at+(e.key==="ArrowDown"?1:-1)));if(nodes[next]){e.preventDefault();e.stopImmediatePropagation();nodes[next].focus();nodes[next].scrollIntoView({block:"nearest"});}}},true);
    overlay.addEventListener("keydown",function(e){e.stopPropagation();});
    addEventListener("storage",function(e){if(e.key===key||e.key===null){saved=readSaved();renderSaved();}});
    document.addEventListener("visibilitychange",function(){if(document.hidden&&watch!==null){stopGPS();gpsStatus="Location paused while this page was hidden. Turn it on again to resume.";if(active)renderGuide();}});
    addEventListener("pagehide",stopGPS);
    setInterval(function(){if(active){updateCountdown();updateLocation();}},10000);
    renderSaved();renderContent();updateDock();
    window.TBJourney={open:open,close:close,planTo:function(p){if(valid(p)){open();choose("to",p);}}};
    // Reuse existing city shortcuts as in-page trip entry points. Modified
    // clicks retain the normal external link behavior.
    document.addEventListener("click",function(e){var a=e.target.closest('#cityToolkit a[data-plan],#cityAdvisoryCard a');if(!a||e.defaultPrevented||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;try{var u=new URL(a.href);if(u.hostname!=="www.google.com"||u.searchParams.get("travelmode")!=="transit")return;var coords=(u.searchParams.get("destination")||"").split(",").map(Number);if(coords.length!==2||!isFinite(coords[0])||!isFinite(coords[1]))return;var p=(profile.places||[]).concat(availablePlaces()).find(function(p){return Math.abs(p.lat-coords[0])<.00001&&Math.abs(p.lon-coords[1])<.00001;});if(!p)p={label:"Selected city connection",lat:coords[0],lon:coords[1]};if(!valid(p))return;e.preventDefault();open();choose("to",p);}catch(_){}});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
