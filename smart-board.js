/* A local, explainable attention policy. It reads the cards' existing data,
   never stops their feeds, never changes user-hidden cards, and uses a
   separate per-city preference. No remote model or extra network request. */
(function () {
  "use strict";
  var city = location.pathname.split("/").pop().replace(/\.html$/, "");
  var key = "tb.smartBoard." + city + ".v1", prefs = read();
  var box, bar, settings, page = 0, pages = 1, lastTurn = Date.now(), timer;
  var signature = "", busy = false, updating = false, reasons = {};
  function read() {
    try {
      var p = JSON.parse(localStorage.getItem(key) || "null");
      if (p && typeof p === "object") return { mode: p.mode === "all" ? "all" : "smart", paused: p.paused === true,
        pins: Array.isArray(p.pins) ? p.pins.filter(function (id) { return typeof id === "string" && /^[\w-]+$/.test(id); }).slice(0, 2) : [] };
    } catch (_) {}
    return { mode: "smart", paused: false, pins: [] };
  }
  function save() { try { localStorage.setItem(key, JSON.stringify(prefs)); return true; } catch (_) { return false; } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function cards() { return [].slice.call(box.children).filter(function (c) { return c.classList.contains("card") && c.id; }); }
  function label(c) {
    var title=c.querySelector("h2 .t"), heading=c.querySelector("h2");
    if(title) return title.textContent.trim();
    var text=heading ? [].slice.call(heading.childNodes).filter(function(n){return n.nodeType===3;}).map(function(n){return n.textContent;}).join("").trim() : "";
    return text || c.id;
  }
  function activity(c) {
    if (c.id === "alertCard") return c.querySelector(".alert-row") ? {show:true, urgent:true, why:"Active service alerts"} : {show:false, why:"No active alert card"};
    if (c.id === "liftCard") return c.querySelector(".row.top") ? {show:true, urgent:true, why:"Step-free access affected at your station"} : {show:false, why:c.querySelector(".empty") ? c.querySelector(".empty").textContent.trim() : "No reported lift outage at your watched stations"};
    if (c.id === "commuteCard") {
      var n = c.querySelector(".cm-num"), t = n && n.textContent.trim(), min = t === "NOW" ? 0 : Number(t);
      return n && t !== "" && isFinite(min) && min >= 0 && min <= 30
        ? {show:true, urgent:min<=10, why:"Your commute leaves soon"}
        : {show:false, why:"No commute within 30 minutes"};
    }
    if (c.id === "spotCard") return {show:!!c.querySelector(".spot-passing,.spot-route"), why:"Shown when a logged vehicle is passing nearby"};
    if (c.id === "leaderCard") return {show:[].slice.call(c.querySelectorAll(".pts")).some(function(n){return Number(n.textContent)>=60;}), why:"Shown for a notable find"};
    if (c.id === "cityAdvisoryCard") return {show:!!c.querySelector(".cab-resource,.cab-note"), why:"Your pinned city guidance"};
    if (c.id === "cityDiscoveryCard") return {show:true, why:"City outings and your passport"};
    if (c.id === "planeCard") return {show:!!c.querySelector(".list .row"), why:"Shown when aircraft are in range"};
    return {show:!!c.querySelector(".list .row"), departure:true, why:"Waiting for departures or feed data"};
  }
  function active() { return prefs.mode === "smart" && innerWidth >= 481; }
  function capacity() {
    var col = box.parentElement, cr = col.getBoundingClientRect(), br = box.getBoundingClientRect();
    var scale = br.width / box.offsetWidth || 1;
    var h = Math.max(0, (cr.bottom - br.top) / scale - col.scrollTop - (parseFloat(getComputedStyle(col).paddingBottom) || 0));
    var rail = getComputedStyle(box).display === "flex";
    var cols = rail ? 1 : Math.max(1, Math.floor((box.clientWidth + 12) / (280 / scale + 12)));
    return Math.max(2, Math.min(6, cols * Math.max(1, Math.floor((h + 8) / (155 / scale + 8)))));
  }
  function held() {
    return prefs.paused || busy || document.hidden || box.contains(document.activeElement) ||
      !!document.querySelector('#cityToolkit:not([hidden]),#cityDiscovery:not([hidden])') ||
      ["setup","settings"].some(function(id){var e=document.getElementById(id);return e && getComputedStyle(e).display!=="none" && e.getBoundingClientRect().height>0;});
  }
  function renderSettings() {
    if (!settings) return;
    var list = settings.querySelector(".sb-pins"), available = cards();
    var sig = available.map(function(c){return c.id+":"+label(c);}).join("|");
    if (list.dataset.cards !== sig) {
      list.dataset.cards = sig;
      list.innerHTML = available.filter(function(c){return c.id!=="alertCard";}).map(function(c){return '<label><input type="checkbox" data-sb-pin="'+esc(c.id)+'"><span>'+esc(label(c))+'</span></label>';}).join("");
    }
    [].slice.call(list.querySelectorAll("input")).forEach(function(n){n.checked=prefs.pins.indexOf(n.dataset.sbPin)>=0;});
    [].slice.call(settings.querySelectorAll("[data-sb-mode]")).forEach(function(b){var on=b.dataset.sbMode===prefs.mode;b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));});
    var note=settings.querySelector(".sb-explanation");
    note.textContent=active() ? "Active alerts stay visible. Other useful panels rotate every 20 seconds; empty or quiet extras rest. Hover or focus a panel to hold it. You can keep up to two panels on screen." : prefs.mode === "smart" ? "Smart rotation starts on tablet and desktop widths. Phone screens keep their full readable lists." : "Every enabled panel is shown. The board can scroll when space is tight.";
    settings.querySelector(".sb-reasons").textContent=Object.keys(reasons).map(function(id){var c=document.getElementById(id);return (c?label(c):id)+": "+reasons[id];}).join(" · ");
  }
  function update() {
    if (!box || updating) return;
    updating=true;
    var all=cards(), on=active();
    document.documentElement.setAttribute("data-board-layout",on?"smart":"all");
    bar.hidden=!on; reasons={};
    if (!on) {
      all.forEach(function(c){c.classList.remove("sb-resting","sb-alert");});
      renderSettings(); updating=false;
      try { if(typeof fitAll==="function") fitAll(); } catch (_) {}
      return;
    }
    var eligible=[], fixed=[], waiting=[];
    all.forEach(function(c){
      if(c.classList.contains("user-hidden") || c.style.display==="none") return;
      var a=activity(c), pinned=prefs.pins.indexOf(c.id)>=0;
      c.classList.toggle("sb-alert",!!a.urgent);
      if(a.urgent || pinned || c.contains(document.activeElement)) fixed.push(c);
      else if(a.show) eligible.push(c);
      else {reasons[c.id]=a.why;if(a.departure)waiting.push(c);}
    });
    // A missing feed is never an all-clear: retain one status panel when no
    // transport has data, and make every resting reason available in Settings.
    if(!eligible.concat(fixed).some(function(c){return activity(c).departure || c.id==="planeCard";}) && waiting.length){eligible.unshift(waiting[0]);delete reasons[waiting[0].id];}
    var slots=Math.max(1,capacity()-fixed.length);
    var nextSig=fixed.map(function(c){return c.id;}).join(",")+"|"+eligible.map(function(c){return c.id;}).join(",")+"|"+slots;
    if(signature!==nextSig){signature=nextSig;page=0;lastTurn=Date.now();}
    pages=Math.max(1,Math.ceil(eligible.length/slots));page=Math.min(page,pages-1);
    var shown=fixed.concat(eligible.slice(page*slots,(page+1)*slots));
    all.forEach(function(c){c.classList.toggle("sb-resting",shown.indexOf(c)<0);});
    var status=bar.querySelector(".sb-status"), resting=Object.keys(reasons).length;
    status.textContent="Smart board · "+(page+1)+"/"+pages+(resting?" · "+resting+" resting":"");
    status.title="Useful panels rotate; active alerts remain visible. Choose Customize to see why other panels are resting.";
    bar.querySelector(".sb-pause").textContent=prefs.paused?"Resume":"Pause";
    bar.querySelector(".sb-pause").setAttribute("aria-pressed",String(prefs.paused));
    [].slice.call(bar.querySelectorAll("[data-sb-turn],.sb-pause")).forEach(function(b){b.disabled=pages<=1;});
    renderSettings();updating=false;
    try { if(typeof fitAll==="function") fitAll(); } catch (_) {}
  }
  function queue(){clearTimeout(timer);timer=setTimeout(update,150);}
  function turn(step){page=(page+step+pages)%pages;lastTurn=Date.now();update();}
  function buildSettings(){
    var anchor=document.getElementById("tbMapRow");if(!anchor || settings)return;
    settings=document.createElement("div");settings.id="smartBoardSettings";
    settings.innerHTML='<div class="accent-lbl">Board layout</div><div class="theme-row" role="group" aria-label="Board layout"><button type="button" class="theme-btn" data-sb-mode="smart">Smart board</button><button type="button" class="theme-btn" data-sb-mode="all">All panels</button></div><p class="sb-explanation"></p><details><summary>Keep panels on screen</summary><div class="sb-pins"></div><p class="sb-feedback" role="status"></p></details><details><summary>Why panels are resting</summary><p class="sb-reasons"></p></details>';
    anchor.parentNode.insertBefore(settings,anchor.previousElementSibling||anchor);
    settings.addEventListener("click",function(e){var b=e.target.closest("[data-sb-mode]");if(b){prefs.mode=b.dataset.sbMode;save();lastTurn=Date.now();update();}});
    settings.addEventListener("change",function(e){if(!e.target.matches("[data-sb-pin]"))return;var selected=[].slice.call(settings.querySelectorAll("[data-sb-pin]:checked"));var msg=settings.querySelector(".sb-feedback");if(selected.length>2){e.target.checked=false;msg.textContent="Keep up to two panels on screen. Active alerts are kept automatically.";return;}prefs.pins=selected.map(function(n){return n.dataset.sbPin;});msg.textContent=save()?"Saved for this city.":"Saved for this visit; browser storage is unavailable.";update();});
  }
  function init(){
    box=document.querySelector(".cards");if(!box)return;
    bar=document.createElement("div");bar.className="sb-bar";bar.hidden=true;
    bar.innerHTML='<span class="sb-status"></span><div class="sb-controls"><button type="button" data-sb-turn="-1" aria-label="Previous panels">‹</button><button type="button" class="sb-pause" aria-label="Pause or resume panel rotation">Pause</button><button type="button" data-sb-turn="1" aria-label="Next panels">›</button><button type="button" class="sb-customize">Customize</button></div>';
    box.parentNode.insertBefore(bar,box);
    bar.onclick=function(e){var b=e.target.closest("button");if(!b)return;if(b.hasAttribute("data-sb-turn"))turn(Number(b.dataset.sbTurn));else if(b.classList.contains("sb-pause")){prefs.paused=!prefs.paused;save();lastTurn=Date.now();update();}else if(b.classList.contains("sb-customize")){document.getElementById("settingsBtn").click();var tab=document.querySelector('#setup [data-tab="display"]');if(tab)tab.click();if(settings){settings.scrollIntoView({block:"center"});settings.querySelector("button").focus();}}};
    box.addEventListener("pointerenter",function(){busy=true;});box.addEventListener("pointerleave",function(){busy=false;lastTurn=Date.now();});
    new MutationObserver(queue).observe(box,{childList:true,subtree:true,characterData:true});
    new MutationObserver(queue).observe(document.documentElement,{attributes:true,attributeFilter:["data-style","data-map","data-rows"]});
    addEventListener("resize",queue);
    document.addEventListener("change",queue);document.addEventListener("click",function(e){if(e.target.closest(".card-x,.mini-btn"))queue();},true);
    addEventListener("storage",function(e){if(e.key===key || e.key===null){prefs=read();update();}});
    setInterval(function(){buildSettings();if(active() && pages>1){if(held())lastTurn=Date.now();else if(Date.now()-lastTurn>=20000)turn(1);}},1000);
    buildSettings();update();
    window.TBSmartBoard={refresh:update};
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
