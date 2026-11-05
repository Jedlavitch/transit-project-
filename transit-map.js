/* Detailed city maps. Preserve the board's Leaflet instance and TBBasemap
   contract so live vehicles, following, settings and departures keep working. */
(function(global){
  'use strict';
  var root=new URL('.',document.currentScript.src), modules, styles={};
  var city=location.pathname.split('/').pop().replace(/\.html$/,'');
  var key='tb.transitMap.'+city+'.v1';
  var defaults={look:'light',rail:true,metro:true,bus:true,stations:true,hubs:true,places:true};
  function prefs(){var p={};try{p=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch(_){}var out={};Object.keys(defaults).forEach(function(k){out[k]=typeof p[k]===typeof defaults[k]?p[k]:defaults[k];});if(['light','dark','auto'].indexOf(out.look)<0)out.look='light';return out;}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function json(path){var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},20000);return fetch(new URL(path,root),{signal:controller.signal}).then(function(r){if(!r.ok)throw Error('Map file unavailable');return r.json();}).finally(function(){clearTimeout(timer);});}
  function style(look){if(!styles[look])styles[look]=json('map-data/streets-'+look+'.json').catch(function(e){delete styles[look];throw e;});return styles[look].then(function(s){return JSON.parse(JSON.stringify(s));});}
  function loader(){if(!modules)modules=Promise.all([import(new URL('vendor/maplibre/maplibre-gl.mjs',root).href),import(new URL('vendor/maplibre/leaflet-maplibre-gl.mjs',root).href)]).then(function(m){m[0].setWorkerUrl(new URL('vendor/maplibre/maplibre-gl-worker.mjs',root).href);return m;});return modules;}
  function ink(color){var n=parseInt(String(color).replace('#',''),16);return (((n>>16)&255)*.299+((n>>8)&255)*.587+(n&255)*.114)>155?'#173042':'#fff';}
  function group(mode){return mode==='rail'?'rail':mode==='bus'||mode==='brt'?'bus':'metro';}
  var modeNames={rail:'Passenger rail',metro:'Metro / subway',tram:'Light rail / tram',bus:'Major bus route',brt:'Rapid bus / BRT',ferry:'Ferry'};
  function add(map,boardTheme,opts){
    var L=global.L,p=prefs(),currentTheme=boardTheme||'dark',vector,gl,fallback,network,routeLayer,stations=L.layerGroup(),labels=L.layerGroup(),popover,button,status,dead=false,styleToken=0;
    var routes=[],stops=[],lineLayers=[],legacy=[],redrawTimer,sourceNote='Loading the transit network…';
    var mapEl=map.getContainer();mapEl.classList.add('tm-map');map.setMaxZoom(opts&&opts.maxZoom||19);
    function look(){return p.look==='auto'?(currentTheme==='day'?'light':'dark'):p.look;}
    function pane(name,z){if(!map.getPane(name)){var e=map.createPane(name);e.style.zIndex=z;}return name;}
    pane('tmBase',190);pane('tmNetwork',360);pane('tmStations',370);pane('tmRouteLabels',390);
    var renderer=L.canvas({pane:'tmNetwork',padding:.15}),stationRenderer=L.canvas({pane:'tmStations',padding:.1});
    stations.addTo(map);labels.addTo(map);
    var attribution=L.control.attribution({position:'bottomright',prefix:false}).addTo(map);
    attribution.addAttribution('<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>');
    L.control.scale({position:'bottomleft',imperial:['amsterdam','zurich','cologne','stuttgart'].indexOf(city)<0,maxWidth:90}).addTo(map);
    function store(){try{localStorage.setItem(key,JSON.stringify(p));}catch(_){if(status)status.textContent='Choices apply for this visit.';}}
    function paintControls(){
      mapEl.dataset.mapLook=look();if(!popover)return;
      popover.dataset.mapLook=look();
      popover.querySelectorAll('[data-tm-look]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.tmLook===p.look));});
      popover.querySelectorAll('[data-tm-layer]').forEach(function(i){i.checked=p[i.dataset.tmLayer];});
      status.textContent=sourceNote+(mapEl.dataset.mapRenderer==='basic'?' · basic street map':'');
    }
    function places(){if(!gl||!gl.getStyle()||!gl.getStyle().layers)return;gl.getStyle().layers.forEach(function(l){if(l['source-layer']==='poi' && !/transit/.test(l.id))gl.setLayoutProperty(l.id,'visibility',p.places?'visible':'none');});}
    function basic(){
      if(dead||fallback)return;
      fallback=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,maxNativeZoom:19,pane:'tmBase',keepBuffer:2}).addTo(map);
      mapEl.dataset.mapRenderer='basic';paintControls();
    }
    async function loadVector(){
      var token=++styleToken;paintControls();
      try{
        var loaded=await Promise.all([loader(),style(look())]);if(dead||token!==styleToken)return;
        if(!vector){
          vector=loaded[0][1].maplibreGL({style:loaded[1],pane:'tmBase',interactive:false,attributionControl:false,padding:.15,maxPitch:0,renderWorldCopies:true}).addTo(map);
          gl=vector.getMaplibreMap();
          gl.on('style.load',function(){places();mapEl.dataset.mapRenderer='vector';if(fallback){map.removeLayer(fallback);fallback=null;}});
          gl.on('error',function(e){if(!gl.isStyleLoaded() && e.error && /WebGL|GPU|style/i.test(e.error.message||''))basic();});
          mapEl._transitMap=api;
        }else gl.setStyle(loaded[1]);
      }catch(e){console.warn('Detailed map unavailable; using the street-map fallback.',e);basic();}
    }
    function width(mode){var z=map.getZoom();return mode==='bus'?(z>=14?2.5:1.9):mode==='brt'?(z>=14?4.2:3.2):mode==='rail'?(z>=14?3.5:2.7):(z>=14?4.5:3.5);}
    function lineStyle(f){var m=f.properties.mode;return {pane:'tmNetwork',renderer:renderer,color:f.properties.color,weight:width(m),opacity:m==='bus'?.67:.88,lineCap:'round',lineJoin:'round',dashArray:m==='brt'?'9 3':m==='ferry'?'3 7':null};}
    function popup(f){var a=f.properties;return '<div class="tm-route-popup"><span class="tm-popup-kicker">'+esc(modeNames[a.mode]||'Station')+'</span><h3>'+esc(a.ref||a.name)+'</h3>'+(a.ref&&a.name!==a.ref?'<p>'+esc(a.name)+'</p>':'')+'<p class="tm-popup-agency">'+esc(a.agency)+'</p>'+(a.url?'<a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">Official route information ↗</a>':'')+'</div>';}
    function visible(f){return p[group(f.properties.mode)];}
    function removeOldRoutes(){
      // Only the old background route groups. All vehicle, stop, selection,
      // follow and departure layers retain their existing ownership.
      try{var st=typeof state!=='undefined'?state:null;if(!st||st.map!==map)return;Object.keys(st).forEach(function(k){if((/RouteLayer$/.test(k)||k==='routeLayer'||k==='ringLayer')&&st[k]&&typeof st[k].eachLayer==='function'&&legacy.indexOf(st[k])<0)legacy.push(st[k]);});legacy.forEach(function(l){if(map.hasLayer(l))map.removeLayer(l);});}catch(_){}
    }
    function preventOld(e){if(network && legacy.indexOf(e.layer)>=0)map.removeLayer(e.layer);}
    function redraw(){
      if(dead||!network)return;
      lineLayers.forEach(function(v){var on=visible(v.feature);if(on&&!map.hasLayer(v.layer))v.layer.addTo(map);if(!on&&map.hasLayer(v.layer))map.removeLayer(v.layer);if(on)v.layer.setStyle(lineStyle(v.feature));});
      stations.clearLayers();labels.clearLayers();var bounds=map.getBounds(),z=map.getZoom(),occupied=[];
      if(p.stations&&z>=12)stops.forEach(function(f){var modes=f.properties.modes||routes.filter(function(r){return r.properties.agency===f.properties.agency;}).map(function(r){return r.properties.mode;});if(modes.length&&!modes.some(function(m){return p[group(m)];}))return;var c=f.geometry.coordinates,ll=L.latLng(c[1],c[0]);if(!bounds.contains(ll))return;L.circleMarker(ll,{renderer:stationRenderer,pane:'tmStations',radius:z>=15?4:2.8,color:look()==='dark'?'#b9c7d6':'#677d8d',weight:1.6,fillColor:look()==='dark'?'#162332':'#fff',fillOpacity:1}).bindPopup(popup(f)).addTo(stations);});
      if(z>=11)routes.slice().sort(function(a,b){return (a.properties.mode==='bus')-(b.properties.mode==='bus');}).forEach(function(f){
        if(!visible(f)||String(f.properties.ref).length>12)return;
        var points=[];f.geometry.coordinates.forEach(function(line){line.forEach(function(c){if(bounds.contains([c[1],c[0]]))points.push(c);});});if(!points.length)return;
        var c=points[Math.floor(points.length/2)],xy=map.latLngToContainerPoint([c[1],c[0]]);
        if(occupied.some(function(q){return Math.abs(q.x-xy.x)<65&&Math.abs(q.y-xy.y)<27;}))return;occupied.push(xy);
        L.marker([c[1],c[0]],{pane:'tmRouteLabels',keyboard:true,icon:L.divIcon({className:'tm-route-label',html:'<span style="--route:'+esc(f.properties.color)+';--ink:'+ink(f.properties.color)+'">'+esc(f.properties.ref)+'</span>',iconSize:[0,0]}),title:f.properties.name}).bindPopup(popup(f)).addTo(labels);
      });
      removeOldRoutes();
    }
    function queue(){clearTimeout(redrawTimer);redrawTimer=setTimeout(redraw,130);}
    function closePanel(){if(!popover)return;popover.hidden=true;button.setAttribute('aria-expanded','false');}
    function openPanel(){
      var r=button.getBoundingClientRect();popover.hidden=false;button.setAttribute('aria-expanded','true');
      popover.style.right=Math.max(10,innerWidth-r.right)+'px';popover.style.top=Math.max(10,Math.min(r.bottom+8,innerHeight-popover.offsetHeight-12))+'px';
      popover.querySelector('button').focus();
    }
    var Control=L.Control.extend({options:{position:'topright'},onAdd:function(){var e=L.DomUtil.create('div','tm-map-control');button=L.DomUtil.create('button','tm-map-button',e);button.type='button';button.innerHTML='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z M9 3v15 M15 6v15"/></svg><span>Map layers</span>';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.onclick=function(){if(popover.hidden)openPanel();else closePanel();};L.DomEvent.disableClickPropagation(e);L.DomEvent.disableScrollPropagation(e);return e;}});new Control().addTo(map);
    popover=document.createElement('section');popover.className='tm-panel';popover.id='transitMapSettings';popover.hidden=true;popover.setAttribute('role','dialog');popover.setAttribute('aria-label','Map layers and appearance');button.setAttribute('aria-controls',popover.id);
    popover.innerHTML='<div class="tm-panel-heading"><div><span class="tm-kicker">YOUR CITY, IN DETAIL</span><h2>Make the map yours.</h2></div><button type="button" class="tm-close" aria-label="Close map settings">×</button></div><div class="tm-looks" aria-label="Map appearance">'+[['light','Light'],['dark','Dark'],['auto','Match board']].map(function(v){return '<button type="button" data-tm-look="'+v[0]+'" aria-pressed="false">'+v[1]+'</button>';}).join('')+'</div><fieldset><legend>Show on the map</legend>'+[['rail','Passenger rail','Regional & intercity trains','#8562bd'],['metro','Metro & light rail','Subways, trams & streetcars','#169879'],['bus','Major buses & BRT','High-service routes & rapid buses','#d59028'],['stations','Stations','Tap a stop for its name','#6e8396'],['hubs','Major stations','Tap a big dot for its timetable','#16283b'],['places','Local places','Parks, shops & nearby landmarks','#519c69']].map(function(v){return '<label><span class="tm-key" style="--key:'+v[3]+'"></span><span><strong>'+v[1]+'</strong><small>'+v[2]+'</small></span><input type="checkbox" data-tm-layer="'+v[0]+'"></label>';}).join('')+'</fieldset><div class="tm-map-actions"><button type="button" data-tm-home>My board location</button><button type="button" data-tm-overview>Network overview</button></div><p class="tm-network-status" role="status"></p><details class="tm-sources"><summary>Map coverage & sources</summary><div></div></details>';
    document.body.appendChild(popover);status=popover.querySelector('.tm-network-status');
    popover.querySelector('.tm-close').onclick=function(){closePanel();button.focus();};
    popover.onclick=function(e){var b=e.target.closest('[data-tm-look]');if(b){p.look=b.dataset.tmLook;store();loadVector();redraw();if(hubs)hubs.refresh();}if(e.target.closest('[data-tm-home]')){try{var st=typeof state!=='undefined'?state:null;if(st&&st.loc)map.setView([st.loc.lat,st.loc.lon],13);}catch(_){}closePanel();}if(e.target.closest('[data-tm-overview]')&&network){var b=network.metadata.bounds;map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:[24,24]});closePanel();}};
    popover.onchange=function(e){if(e.target.dataset.tmLayer){p[e.target.dataset.tmLayer]=e.target.checked;store();places();redraw();if(hubs)hubs.refresh();}};
    function dismiss(e){if(!popover.hidden&&!popover.contains(e.target)&&!button.contains(e.target))closePanel();}
    function keyboard(e){if(e.key==='Escape'&&!popover.hidden){e.preventDefault();e.stopImmediatePropagation();closePanel();button.focus();}}
    document.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',keyboard,true);window.addEventListener('resize',closePanel);
    paintControls();
    var hubs=null;
    (function(){var css=document.createElement('link');css.rel='stylesheet';css.href=new URL('station-hubs.css?v=2',root).href;document.head.appendChild(css);var js=document.createElement('script');js.src=new URL('station-hubs.js?v=6',root).href;js.onload=function(){if(!dead)hubs=global.TBStationHubs.attach(map,{city:city,enabled:function(){return p.hubs;}});};document.head.appendChild(js);})();
    var api={setTheme:function(theme){currentTheme=theme;if(p.look==='auto')loadVector();},getVectorMap:function(){return gl;},getNetwork:function(){return network;},getPreferences:function(){return Object.assign({},p);}};
    mapEl._transitMap=api;
    loadVector();
    json('map-data/network-'+city+'.json').then(function(data){
      if(dead)return;if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('Invalid transit network');
      network=data;routes=data.features.filter(function(f){return f.geometry&&f.geometry.type==='MultiLineString';});stops=data.features.filter(function(f){return f.geometry&&f.geometry.type==='Point';});
      routes.forEach(function(f){var layer=L.geoJSON(f,{style:lineStyle,onEachFeature:function(feature,l){l.bindPopup(popup(feature));}});lineLayers.push({feature:f,layer:layer});});
      var unavailable=data.metadata.unavailable||[],missing=(data.metadata.sources||[]).reduce(function(n,s){return n+(s.missingGeometry||[]).length;},0);
      sourceNote=routes.length+' routes · '+stops.length+' stations'+(unavailable.length||missing?' · some source coverage unavailable':'');
      popover.querySelector('.tm-sources>div').innerHTML='<p>Passenger services from the agencies listed below, within this regional map. Major buses are selected by scheduled weekday trips or an agency’s frequent-service map. This does not indicate live crowding. Route lines describe the network, not current service status.</p>'+(data.metadata.sources||[]).map(function(s){return '<p><strong>'+esc(s.name)+'</strong> · '+s.routes+' routes<br>Source edition / service sample '+esc(s.serviceDate)+((s.missingGeometry||[]).length?'<br>Geometry unavailable: '+esc(s.missingGeometry.join(', ')):'')+'</p>';}).join('')+(unavailable.length?'<p>Sources currently unavailable: '+esc(unavailable.map(function(s){return s.feed;}).join(', '))+'</p>':'')+'<p>Network generated '+esc(data.metadata.generated)+'. Street detail © OpenStreetMap contributors.</p>';
      paintControls();redraw();mapEl.dataset.networkReady='true';
    }).catch(function(){sourceNote='Transit network unavailable · existing route lines retained';paintControls();});
    map.on('moveend zoomend resize',queue);map.on('layeradd',preventOld);
    map.once('unload',function(){dead=true;styleToken++;clearTimeout(redrawTimer);document.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',keyboard,true);window.removeEventListener('resize',closePanel);popover.remove();});
    return api;
  }
  global.TBBasemap={add:add,addDark:function(map,opts){return add(map,'dark',opts);}};
})(window);
