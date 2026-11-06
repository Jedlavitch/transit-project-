/* Big-station dots on the city maps. Tap one for that station's timetable: every
   service that calls there, in one list, soonest first.

   Hubs are a short curated list (map-data/station-hubs.json), because "big" is a
   judgement a ranking of stop data gets wrong. Times come from three places, and
   the panel says which:
     bundles    the *-schedule.json timetables, already committed. Scheduled only.
     wmata      live predictions with the board's own key. WMATA rail has no bundle.
     amtrak     amtraker, which only lists trains that are already running.
     transitous European boards, which have no bundles.
   Airports are hubs too (an `airport` code in the JSON): the same panel, for the
   trains and buses that leave them, plus the flights landing and leaving right
   now. Nothing open publishes airline schedules, so flights come from the
   board's own aircraft feed (Settings, AIRCRAFT-FEED.md) with routes from
   adsbdb, and only while they are in the air near the airport.
   A bundle is big and most clicks never need it, so nothing loads until a dot is
   tapped, and only that hub's own rows are kept afterwards. */
(function(global){
  'use strict';
  var root=new URL('.',document.currentScript.src);
  var WMATA={RD:'#BF0D3E',OR:'#ED8B00',BL:'#009CDE',SV:'#919D9D',GR:'#00B140',YL:'#FFD100'};
  var FAMILY={rail:'Trains',metro:'Metro',tram:'Trams',bus:'Buses',ferry:'Ferries'};
  var PAGE=40,LIVE_MS=60000;
  var PLANE='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 15.5v-2l-8-5V3.6a1.6 1.6 0 0 0-3.2 0v4.9l-8 5v2l8-2.5v5.2l-2 1.5V21l3.6-1 3.6 1v-1.3l-2-1.5V13z" transform="translate(.6 0)"/></svg>';

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function ink(color){var n=parseInt(String(color).replace('#',''),16);return (((n>>16)&255)*.299+((n>>8)&255)*.587+(n&255)*.114)>155?'#14202b':'#fff';}
  /* Some feeds shout (TRENTON TRANSIT CENTER) and one writes Fisherman`s. */
  function tidy(name){var s=String(name||'').replace(/`/g,"'").trim();return s&&s===s.toUpperCase()&&/[A-Z]{3}/.test(s)?s.toLowerCase().replace(/(^|[\s\-\/(])([a-z])/g,function(_,a,b){return a+b.toUpperCase();}):s;}
  function metres(a,b,c,d){return Math.hypot((a-c)*111000,(b-d)*111000*Math.cos(a*Math.PI/180));}
  function fetchJSON(url,timeout){
    /* The DC board paces WMATA calls inside its own getJSON. Going round it is
       what got that board rate limited, so use it wherever it exists. */
    if(typeof getJSON==='function')return getJSON(url,timeout||20000,'no-cache');
    return fetch(url,{cache:'no-cache'}).then(function(r){if(!r.ok)throw Error(r.status);return r.json();});
  }

  /* The clock at the station, not on this device: a Zürich board can be open in Maryland. */
  function cityNow(tz){
    var p={};new Intl.DateTimeFormat('en-CA',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});
    return {ymd:p.year+p.month+p.day,min:+p.hour*60+ +p.minute};
  }
  function shift(ymd,n){var d=new Date(Date.UTC(+ymd.slice(0,4),+ymd.slice(4,6)-1,+ymd.slice(6,8)+n));return {ymd:d.toISOString().slice(0,10).replace(/-/g,''),dow:(d.getUTCDay()+6)%7};}
  function clock(min,h24){min=((min%1440)+1440)%1440;var h=Math.floor(min/60),m=String(min%60).padStart(2,'0');return h24?String(h).padStart(2,'0')+':'+m:((h%12)||12)+':'+m+' '+(h<12?'AM':'PM');}
  function clockMs(ms,cfg){var p=cityNowAt(ms,cfg.tz);return clock(p,cfg.clock24);}
  function cityNowAt(ms,tz){var p={};new Intl.DateTimeFormat('en-CA',{timeZone:tz,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(ms)).forEach(function(x){p[x.type]=x.value;});return +p.hour*60+ +p.minute;}

  /* The same rule every board uses, including the fallback to the same weekday
     when a calendar has run out, which is flagged rather than passed off as current. */
  function activeServices(table,day){
    var act=new Set(),id;
    for(id in table.svc){var v=table.svc[id];if(day.ymd>=v.start&&day.ymd<=v.end&&v.dow[day.dow])act.add(id);}
    var ex=table.exc&&table.exc[day.ymd];
    if(ex){(ex.rem||[]).forEach(function(x){act.delete(x);});(ex.add||[]).forEach(function(x){act.add(x);});}
    if(!act.size){for(id in table.svc){if(table.svc[id].dow[day.dow])act.add(id);}if(act.size)table.stale=true;}
    return act;
  }

  /* A date-only bundle can run out one railway at a time: NJ Transit's has light
     rail into 2027 but no heavy rail after 10 Oct, so Newark Penn would lose every
     NEC train without a word while its light rail kept the hub looking fine. A
     line whose published dates have ended borrows the latest earlier day of this
     weekday, and the panel says so. Only recently ended lines qualify: one gone
     for months is more likely seasonal (Meadowlands Rail) than out of date. */
  var BORROW_DAYS=60;
  function dayNumber(ymd){return Date.UTC(+ymd.slice(0,4),+ymd.slice(4,6)-1,+ymd.slice(6,8))/864e5;}
  function hubServices(tab,day){
    if(tab.days[day.ymd])return tab.days[day.ymd];
    var act=activeServices(tab,day),borrowed={},stale=!!tab.stale;
    if(!Object.keys(tab.svc).length){
      var dates=Object.keys(tab.exc).sort().reverse(),byLine={};
      tab.rows.forEach(function(e){(byLine[e.line]=byLine[e.line]||new Set()).add(e.s);});
      Object.keys(byLine).forEach(function(line){
        var mine=byLine[line],runs=function(d){return (tab.exc[d].add||[]).filter(function(x){return mine.has(x);});},last=null,i;
        for(i=0;i<dates.length&&!last;i++){if(runs(dates[i]).length)last=dates[i];}
        if(!last||day.ymd<=last||dayNumber(day.ymd)-dayNumber(last)>BORROW_DAYS)return;
        for(i=0;i<dates.length;i++){
          if(dates[i]>=day.ymd||shift(dates[i],0).dow!==day.dow)continue;
          var was=runs(dates[i]);
          if(was.length){borrowed[line]=new Set(was);stale=true;break;}
        }
      });
    }
    return tab.days[day.ymd]={act:act,borrowed:borrowed,stale:stale};
  }

  /* One hub's rows from one bundle. Trains that finish anywhere in the hub are
     arrivals, not departures, and a train calling at two platforms of one hub counts once. */
  function extract(bundle,hub,key,feed){
    /* `near` points the bundle at a station away from the dot: JFK's LIRR trains
       leave from Jamaica, an AirTrain ride from the terminals. */
    var at=hub.near||hub;
    var here={},names={};(bundle.stations||[]).forEach(function(s){names[s.id]=s.name;if(metres(at.lat,at.lon,s.lat,s.lon)<=at.r)here[s.id]=1;});
    var out=[],pats=bundle.pats,offs=bundle.offs||[];
    (bundle.trips||[]).forEach(function(t){
      var ids,times,line,hs;
      if(bundle.v===2&&pats){ids=pats[t.p]||[];times=offs[t.o]||[];line=t.l;hs=t.h;}else{ids=t.st;line=t.line;hs=t.hs;}
      /* "Finishes here" means anywhere in the hub, not only its last stop: city trains
         reach Philadelphia airport at Terminal A and run on to E & F, which made every
         one of them a departure "to Airport Terminals E & F". */
      /* A loop that starts and ends here is still a departure. */
      var inHub=function(x){return x!=null&&here[pats&&bundle.v===2?x:x[0]];};
      if(inHub(ids[ids.length-1])&&!inHub(ids[0]))return;
      for(var i=0;i<ids.length-1;i++){
        var id=pats&&bundle.v===2?ids[i]:ids[i][0];
        if(!here[id])continue;
        var min=pats&&bundle.v===2?(t.t||0)+(times[i]||0):ids[i][1];
        line=(bundle.routeLines&&bundle.routeLines[line])||line;
        /* LA Metro publishes no headsigns, so fall back to where the train ends. */
        var last=ids[ids.length-1],end=pats&&bundle.v===2?last:last[0];
        out.push({line:line,hs:tidy(hs||names[end]),s:t.s,min:min});
        break;
      }
    });
    return {key:key,feed:feed,rows:out,svc:bundle.svc||{},exc:bundle.exc||{},generated:bundle.generated,days:{}};
  }

  function attach(map,opts){
    var L=global.L,city=opts.city,cfg,markers=[],group=L.layerGroup(),panel,current,timer,dead=false,enabled=opts.enabled||function(){return true;};
    var mapEl=map.getContainer();
    /* Above route lines (400) and vehicles (600), below popups (700). Hubs are where
       lines converge and buses park, so anywhere lower the dot can't be tapped at
       exactly the stations it's for. It only covers its own 28px. */
    if(!map.getPane('tshHubs')){map.createPane('tshHubs').style.zIndex=640;}
    var cache={};

    function look(){return mapEl.dataset.mapLook||(document.documentElement.getAttribute('data-theme')==='day'?'light':'dark');}
    function refresh(){
      var on=enabled()&&map.getZoom()>=10;
      if(on&&!map.hasLayer(group))group.addTo(map);
      if(!on&&map.hasLayer(group))map.removeLayer(group);
      mapEl.classList.toggle('tsh-named',map.getZoom()>=13);
      mapEl.classList.toggle('tsh-on',on);
    }
    function routeColor(feed,line){
      var api=mapEl._transitMap,net=api&&api.getNetwork&&api.getNetwork();
      if(net&&!cache.colors){cache.colors={};net.features.forEach(function(f){var a=f.properties;if(f.geometry&&f.geometry.type==='MultiLineString'&&a.ref){var c=a.agency+'|';cache.colors[c+a.ref]=a.color;cache.colors[c+String(a.ref).split('-')[0]]=cache.colors[c+String(a.ref).split('-')[0]]||a.color;}});}
      return (feed.agency&&cache.colors&&cache.colors[feed.agency+'|'+line])||feed.color;
    }

    /* ---------- sources ---------- */
    function loadFeed(hub,key){
      var id=hub.name+'|'+key;
      if(!cache[id])cache[id]=fetch(new URL(cfg.feeds[key].file,root),{cache:'no-cache'}).then(function(r){if(!r.ok)throw Error(r.status);return r.json();}).then(function(b){return extract(b,hub,key,cfg.feeds[key]);}).catch(function(e){delete cache[id];throw e;});
      return cache[id];
    }
    function amtrakRows(hub){
      return fetchJSON('https://api-v3.amtraker.com/v3/trains',12000).then(function(d){
        var rows=[];Object.keys(d||{}).forEach(function(k){(d[k]||[]).forEach(function(t){
          var st=t.stations||[];st.forEach(function(s,i){
            if(s.code!==hub.amtrak||i===st.length-1||!s.dep||(s.status!=='Enroute'&&s.status!=='Station'))return;
            var when=Date.parse(s.dep),sch=Date.parse(s.schDep);
            rows.push({service:'Amtrak',color:'#1C5A7D',line:t.routeName||'Amtrak',number:t.trainNum,hs:st[st.length-1].name||t.destName,when:when,delay:isNaN(sch)?null:Math.round((when-sch)/60000),live:true});
          });
        });});
        return rows;
      });
    }
    function wmataRows(hub){
      var key='';try{key=localStorage.getItem('transitboard.wmataKey')||'';}catch(_){}
      if(!key){var e=Error('no key');e.noKey=true;return Promise.reject(e);}
      return fetchJSON('https://api.wmata.com/StationPrediction.svc/json/GetPrediction/'+hub.wmata+'?api_key='+encodeURIComponent(key),12000).then(function(d){
        var rows=[];(d.Trains||[]).forEach(function(t){
          if(!WMATA[t.Line])return;
          var m=t.Min==='ARR'||t.Min==='BRD'?0:parseInt(t.Min,10);if(isNaN(m))return;
          rows.push({service:'Metro',color:WMATA[t.Line],line:t.Line,hs:t.DestinationName||t.Destination,when:Date.now()+m*60000,live:true,arriving:t.Min==='ARR'||t.Min==='BRD'});
        });
        return rows;
      });
    }
    /* NYC subway, live, for stations the bundle doesn't reach (it stops short of
       Queens' airport stations). mta-live.js already decodes MTA's CORS-open feeds;
       it is loaded only when one of these hubs is tapped. */
    var mtaReady=null;
    function mta(){
      if(!mtaReady)mtaReady=Promise.all([
        global.TBMta?Promise.resolve():new Promise(function(ok,no){var s=document.createElement('script');s.src=new URL('mta-live.js?v=2',root).href;s.onload=ok;s.onerror=function(){mtaReady=null;no(Error('mta-live'));};document.head.appendChild(s);}),
        fetch(new URL('mta-stations.json',root)).then(function(r){return r.json();}).then(function(d){return d.stations||d;})
      ]).then(function(x){return x[1];});
      return mtaReady;
    }
    function mtaRows(hub){
      return mta().then(function(names){return global.TBMta.fetchAll().then(function(feed){
        if(!feed.feedsOk)throw Error('no feeds');
        var rows=[];
        hub.mta.split(',').forEach(function(id){
          var from=(names[id]&&names[id].n||id).replace(/-JFK Airport$/,'');
          global.TBMta.arrivalsAt(feed.updates,id,{horizonMin:60}).forEach(function(a){
            if(a.destStation===id)return;
            var dest=names[a.destStation];
            rows.push({service:'Subway',color:global.TBMta.SUBWAY_COL[a.routeId]||'#808183',line:a.routeId,number:'from '+from,hs:dest?dest.n:a.destStation,when:a.atSec*1000,delay:a.delaySec>59?Math.round(a.delaySec/60):null,live:true});
          });
        });
        return rows;
      });});
    }
    function europeRows(hub){
      var T=global.TBTransitous;if(!T)return Promise.reject(Error('no source'));
      var got=hub.live==='ch'?T.chDepartures(hub.station,40):T.findStation(hub.station).then(function(st){return st?st:T.nearbyStops(hub.lat,hub.lon,1).then(function(x){return x[0];});}).then(function(st){if(!st)throw Error('no stop');return T.departures(st.id,40);});
      return got.then(function(rows){return rows.map(function(r){return {service:/^S\s?\d/.test(r.route||'')?FAMILY.rail:FAMILY[r.family]||FAMILY[r.group]||'Other',color:r.lineColor||'#536878',textColor:r.lineTextColor,line:r.route||r.label,hs:r.headsign,when:r.when,delay:r.realTime?r.delayMin:null,live:!!r.realTime,cancelled:r.cancelled};});});
    }

    /* Flights: live aircraft near the airport, not a schedule. adsbdb's route for a
       callsign is often stale or stored backwards (see the planes card in dc.html),
       so the aircraft's own motion decides arriving or leaving, and the route only
       has to name this airport at one end. A plane whose route doesn't is left out
       rather than guessed at: three airports share DC's sky. */
    var RT_KEY='tb.flightRoutes2',RT_TTL=30*864e5;
    function routes(){try{return JSON.parse(localStorage.getItem(RT_KEY)||'{}');}catch(_){return {};}}
    function lookup(cs){
      return fetch('https://api.adsbdb.com/v0/callsign/'+encodeURIComponent(cs)).then(function(r){return r.ok||r.status===404?r.json():null;}).catch(function(){return null;}).then(function(r){
        var fr=r&&r.response&&r.response.flightroute,o=fr&&fr.origin,d=fr&&fr.destination,e={t:Date.now()};
        if(!r)e.soft=1;
        if(fr){e.airline=(fr.airline&&fr.airline.name)||'';e.iata=(fr.airline&&fr.airline.iata)||'';
          if(o&&d)Object.assign(e,{from:o.iata_code||o.icao_code||'',to:d.iata_code||d.icao_code||'',fromName:o.municipality||o.name||'',toName:d.municipality||d.name||'',flat:o.latitude,flon:o.longitude,tlat:d.latitude,tlon:d.longitude});}
        /* Merge into what is stored now, not what was read earlier: the board's planes card writes the same key. */
        var all=routes();all[cs]=e;try{localStorage.setItem(RT_KEY,JSON.stringify(all));}catch(_){}
        return e;
      });
    }
    function bearing(a,b,c,d){var r=Math.PI/180,y=Math.sin((d-b)*r)*Math.cos(c*r),x=Math.cos(a*r)*Math.sin(c*r)-Math.sin(a*r)*Math.cos(c*r)*Math.cos((d-b)*r);return (Math.atan2(y,x)/r+360)%360;}
    function flightRows(hub){
      var base='';try{base=(localStorage.getItem('tb.adsbUrl')||'').trim().replace(/\/+$/,'');}catch(_){}
      if(!base){var e=Error('no feed');e.noFeed=true;return Promise.reject(e);}
      var code=hub.airport,apt=hub.apt||[hub.lat,hub.lon];
      return fetchJSON(base+'/v2/point/'+apt[0].toFixed(4)+'/'+apt[1].toFixed(4)+'/40',12000).then(function(d){
        var ac=(d&&d.ac||[]).filter(function(a){return a.lat!=null&&(a.flight||'').trim();}),have=routes(),now=Date.now();
        var need=ac.map(function(a){return a.flight.trim();}).filter(function(cs){var h=have[cs];return !h||now-(h.t||0)>(h.soft?6*36e5:RT_TTL);}).slice(0,16);
        return Promise.all(need.map(function(cs){return lookup(cs).then(function(e){have[cs]=e;});})).then(function(){
          var rows=[];
          ac.forEach(function(a){
            var cs=a.flight.trim(),rt=have[cs];if(!rt||!rt.from)return;
            var other=rt.to===code?'from':rt.from===code?'to':null;if(!other)return;
            var nm=metres(a.lat,a.lon,apt[0],apt[1])/1852,ground=a.alt_baro==='ground',alt=ground?0:+a.alt_baro||0,gs=+a.gs||0,vs=+(a.baro_rate!=null?a.baro_rate:a.geom_rate)||0;
            var turn=a.track==null?90:Math.abs((bearing(a.lat,a.lon,apt[0],apt[1])-a.track+540)%360-180);
            var kind;
            if(ground||alt<300&&gs<60){if(nm>3)return;kind='gnd';}
            else if(turn<70&&vs<=300&&alt<20000)kind='arr';
            else if(turn>100&&nm<40&&(vs>300||alt<6000))kind='dep';
            else return;
            /* Moving tells the route's ends apart better than adsbdb does. */
            var far=kind==='arr'?(rt.to===code?rt.fromName:rt.toName):kind==='dep'?(rt.from===code?rt.toName:rt.fromName):(other==='from'?rt.fromName:rt.toName);
            var farCode=kind==='arr'?(rt.to===code?rt.from:rt.to):kind==='dep'?(rt.from===code?rt.to:rt.from):rt[other];
            var num=(/\d+[A-Z]?$/.exec(cs)||[''])[0],label=rt.iata&&num?rt.iata+' '+num:cs;
            var eta=kind==='arr'?Math.max(1,Math.round(nm/Math.max(gs,140)*60+2)):0;
            var airline=String(rt.airline||'').split(/ - |, /)[0],detail=(airline?airline+' · ':'')+(ground?'on the ground':Math.round(nm)+' nm out · '+(Math.round(alt/100)*100).toLocaleString('en-US')+' ft');
            rows.push({service:'Flights',color:'#2c3e55',line:label,hs:(kind==='arr'||kind==='gnd'&&other==='from'?'From ':'To ')+(far||farCode)+(farCode&&far?' ('+farCode+')':''),detail:detail,flight:kind,when:now+eta*60000,live:true});
          });
          return rows;
        });
      });
    }

    /* ---------- rows ---------- */
    function scheduled(state){
      var now=cityNow(cfg.tz),today=shift(now.ymd,0),out=[];state.staleFeeds=[];
      state.tables.forEach(function(tab){
        [-1,0,1].forEach(function(off){
          var day=shift(today.ymd,off),res=hubServices(tab,day);
          if(res.stale&&off===0&&state.staleFeeds.indexOf(tab.feed.label)<0)state.staleFeeds.push(tab.feed.label);
          tab.rows.forEach(function(e){
            if(!(res.borrowed[e.line]||res.act).has(e.s))return;
            var inMin=e.min+off*1440-now.min;if(inMin<0||inMin>1440)return;
            out.push({service:tab.feed.label,color:routeColor(tab.feed,e.line),line:e.line,hs:e.hs,inMin:inMin,time:clock(e.min,cfg.clock24)});
          });
        });
      });
      return out;
    }
    function allRows(state){
      var live=state.live.map(function(r){var x=Object.assign({},r);x.inMin=Math.round((r.when-Date.now())/60000);x.time=r.flight&&r.flight!=='arr'?(r.flight==='dep'?'Departed':'At airport'):clockMs(r.when,cfg);if(r.flight&&r.flight!=='arr')x.inMin=-1;return x;}).filter(function(r){return r.inMin>=-1;});
      return scheduled(state).concat(live).sort(function(a,b){return a.inMin-b.inMin;});
    }
    function untilText(r){if(r.flight==='arr')return 'lands in ~'+r.inMin+' min';if(r.flight==='dep')return 'just departed';if(r.flight==='gnd')return 'on the ground';if(r.arriving)return 'Now';if(r.inMin<=0)return 'Now';if(r.inMin<60)return 'in '+r.inMin+' min';var h=Math.floor(r.inMin/60);return 'in '+h+' h'+(r.inMin%60?' '+(r.inMin%60)+' min':'');}
    function rowHtml(r){
      var status=r.cancelled?'<span class="tsh-late">Cancelled</span>':r.delay>0?'<span class="tsh-late">'+r.delay+' min late</span>':r.live?'<span class="tsh-live">Live</span>':'';
      return '<li class="tsh-dep'+(r.cancelled?' tsh-cancelled':'')+'"><span class="tsh-line" style="background:'+esc(r.color)+';color:'+esc(r.textColor||ink(r.color))+'" title="'+esc(r.line)+'">'+esc(r.line)+'</span><span class="tsh-where"><strong>'+esc(r.hs||'—')+'</strong><small>'+esc(r.detail||r.service+(r.number?' · '+r.number:''))+'</small></span><span class="tsh-when"><strong>'+esc(r.time)+'</strong><small>'+untilText(r)+(status?' · '+status:'')+'</small></span></li>';
    }
    function draw(){
      var state=current;if(!state||!panel)return;
      var rows=allRows(state),services=[],lines=[];
      rows.forEach(function(r){if(services.indexOf(r.service)<0)services.push(r.service);});
      if(state.service&&services.indexOf(state.service)<0&&!state.pending){state.service=null;state.line=null;}
      var shown=state.service?rows.filter(function(r){return r.service===state.service;}):rows;
      /* Flight numbers are not lines: a chip per flight filters nothing anyone wants. */
      if((state.service||services.length===1)&&state.service!=='Flights')shown.forEach(function(r){if(lines.indexOf(r.line)<0)lines.push(r.line);});
      if(state.line&&lines.indexOf(state.line)<0)state.line=null;
      if(state.line)shown=shown.filter(function(r){return r.line===state.line;});
      var chips='';
      if(services.length>1)chips+='<div class="tsh-chips" role="group" aria-label="Service"><button type="button" data-tsh-service="" aria-pressed="'+!state.service+'">All</button>'+services.map(function(s){return '<button type="button" data-tsh-service="'+esc(s)+'" aria-pressed="'+(s===state.service)+'">'+esc(s)+'</button>';}).join('')+'</div>';
      if(lines.length>1&&lines.length<=14)chips+='<div class="tsh-chips" role="group" aria-label="Line">'+lines.map(function(l){return '<button type="button" data-tsh-line="'+esc(l)+'" aria-pressed="'+(l===state.line)+'">'+esc(l)+'</button>';}).join('')+'</div>';
      var list=shown.slice(0,state.limit).map(rowHtml).join('');
      var empty=state.pending?'<p class="tsh-empty">Loading the timetable…</p>':'<p class="tsh-empty">No departures found in the next 24 hours.</p>';
      var more=shown.length>state.limit?'<button type="button" class="tsh-more" data-tsh-more>Show more ('+(shown.length-state.limit)+' left)</button>':'';
      /* Replacing unchanged rows every minute drops scroll and makes the list blink. */
      var html=chips+'|'+list+'|'+more+'|'+state.pending;
      if(html!==state.painted){
        state.painted=html;
        panel.querySelector('.tsh-filters').innerHTML=chips;
        panel.querySelector('.tsh-list').innerHTML=list?'<ol>'+list+'</ol>'+more:empty;
      }
      var notes=[];
      if(state.hub.note)notes.push(state.hub.note);
      state.errors.forEach(function(e){notes.push(e);});
      if(state.hub.airport&&state.liveOk.flights)notes.push('Flights are aircraft at or near the airport right now, not a schedule. One whose route can’t be confirmed is left out.');
      if(state.staleFeeds&&state.staleFeeds.length)notes.push(state.staleFeeds.join(' and ')+' times are out of date: the bundled timetable has run out, so these come from the last published day of this weekday and may have changed.');
      var src=state.tables.map(function(t){return t.feed.label+(t.generated?' timetable, '+t.generated:' timetable');});
      if(state.hub.wmata&&state.liveOk.wmata)src.push('WMATA live predictions, which reach about 20 minutes ahead');
      if(state.hub.amtrak&&state.liveOk.amtrak)src.push('Amtrak trains already running');
      if(state.hub.mta&&state.liveOk.mta)src.push('MTA live subway, next hour');
      if(state.hub.airport&&state.liveOk.flights)src.push('Aircraft data adsb.lol (ODbL), routes adsbdb');
      if(state.hub.live&&state.liveOk.europe)src.push(state.hub.live==='ch'?'Swiss transport API':'Transitous')&&src.push('next 40 departures');
      panel.querySelector('.tsh-notes').innerHTML=notes.map(function(n){return '<p class="tsh-note">'+esc(n)+'</p>';}).join('')+(src.length?'<p>'+esc(src.join(' · '))+'</p>':'');
      var sub=state.tables.length?(state.live.length?'Scheduled and live times':'Scheduled times'):(state.hub.live?'Next departures':'Live times');
      panel.querySelector('.tsh-sub').textContent=state.hub.airport?'Flights now, and trains and buses leaving · '+sub.toLowerCase():sub;
    }

    /* ---------- loading ---------- */
    function loadLive(state){
      var hub=state.hub,jobs=[],live={};
      function job(name,run,fail){state.pending++;jobs.push(run(hub).then(function(rows){live[name]=rows;state.liveOk[name]=true;state.errs[name]=null;}).catch(function(e){live[name]=state.liveBy[name]||[];state.errs[name]=fail(e);}).then(function(){state.pending--;}));}
      if(hub.amtrak)job('amtrak',amtrakRows,function(){return 'Amtrak is not answering, so its trains are missing.';});
      if(hub.wmata)job('wmata',wmataRows,function(e){return e.noKey?'Add a WMATA key in Settings to see Metro trains here.':'WMATA is not answering, so Metro trains are missing.';});
      if(hub.mta)job('mta',mtaRows,function(){return 'The MTA subway feed is not answering, so subway trains are missing.';});
      if(hub.airport)job('flights',flightRows,function(e){return e.noFeed?'Add an aircraft feed in Settings to see flights landing and leaving here.':'The aircraft feed is not answering, so flights are missing.';});
      if(hub.live)job('europe',europeRows,function(){return 'Departures are unavailable right now. Try again in a minute.';});
      return Promise.all(jobs).then(function(){
        if(current!==state)return;
        state.liveBy=live;state.live=[];Object.keys(live).forEach(function(k){state.live=state.live.concat(live[k]);});
        syncErrors(state);draw();
      });
    }
    function syncErrors(state){state.errors=Object.keys(state.errs).map(function(k){return state.errs[k];}).filter(Boolean);}
    function open(hub,marker){
      if(!panel)buildPanel();
      markers.forEach(function(m){var e=m.getElement();if(e)e.classList.toggle('tsh-selected',m===marker);});
      var state=current={hub:hub,marker:marker,tables:[],live:[],liveBy:{},liveOk:{},errs:{},errors:[],pending:0,limit:PAGE,service:null,line:null};
      panel.dataset.look=look();panel.hidden=false;
      panel.querySelector('h2').textContent=hub.name;
      panel.querySelector('.tsh-kicker').textContent=hub.airport?'AIRPORT · '+hub.airport:'STATION TIMETABLE';
      panel.setAttribute('aria-label',(hub.airport?'Airport':'Station')+' timetable');
      panel.querySelector('.tsh-filters').innerHTML='';panel.querySelector('.tsh-list').scrollTop=0;
      hub.feeds.forEach(function(key){
        state.pending++;
        loadFeed(hub,key).then(function(tab){if(current===state)state.tables.push(tab);}).catch(function(){state.errs[key]=cfg.feeds[key].label+' timetable could not be loaded.';}).then(function(){state.pending--;if(current===state){syncErrors(state);draw();}});
      });
      loadLive(state);draw();
      clearInterval(timer);timer=setInterval(function(){if(document.hidden||current!==state)return;loadLive(state);draw();},LIVE_MS);
      panel.querySelector('.tsh-close').focus();
    }
    function close(){
      if(!current)return;var m=current.marker;current=null;clearInterval(timer);panel.hidden=true;
      markers.forEach(function(x){var e=x.getElement();if(e)e.classList.remove('tsh-selected');});
      var el=m&&m.getElement();if(el)el.focus();
    }
    function buildPanel(){
      panel=document.createElement('section');panel.className='tsh-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Station timetable');
      panel.innerHTML='<div class="tsh-head"><div><span class="tsh-kicker">STATION TIMETABLE</span><h2></h2><p class="tsh-sub"></p></div><button type="button" class="tsh-close" aria-label="Close timetable">×</button></div><div class="tsh-filters"></div><div class="tsh-list" tabindex="-1"></div><div class="tsh-notes"></div>';
      document.body.appendChild(panel);
      panel.addEventListener('click',function(e){
        var state=current;if(!state)return;
        if(e.target.closest('.tsh-close'))return close();
        var b=e.target.closest('button');if(!b)return;
        if(b.hasAttribute('data-tsh-service')){state.service=b.dataset.tshService||null;state.line=null;state.limit=PAGE;}
        else if(b.hasAttribute('data-tsh-line')){state.line=state.line===b.dataset.tshLine?null:b.dataset.tshLine;state.limit=PAGE;}
        else if(b.hasAttribute('data-tsh-more'))state.limit+=PAGE*2;
        else return;
        draw();
      });
    }
    function keyboard(e){if(e.key==='Escape'&&current){e.preventDefault();e.stopImmediatePropagation();close();}}
    window.addEventListener('keydown',keyboard,true);
    map.on('zoomend',refresh);
    map.once('unload',function(){dead=true;clearInterval(timer);window.removeEventListener('keydown',keyboard,true);if(panel)panel.remove();});

    var ready=fetch(new URL('map-data/station-hubs.json',root)).then(function(r){if(!r.ok)throw Error(r.status);return r.json();}).then(function(data){
      if(dead)return;cfg=data.cities[city];if(!cfg)return;
      cfg.hubs.forEach(function(hub){
        var m=L.marker([hub.lat,hub.lon],{pane:'tshHubs',title:hub.name+' timetable',alt:hub.name+' timetable',riseOnHover:true,icon:L.divIcon({className:'tsh-hub'+(hub.airport?' tsh-airport':''),iconSize:[28,28],iconAnchor:[14,14],html:'<span class="tsh-dot">'+(hub.airport?PLANE:'')+'</span><span class="tsh-name">'+esc(hub.name)+'</span>'})});
        m.on('click',function(){open(hub,m);});
        m.addTo(group);markers.push(m);
      });
      /* The boards already mark nearby airports with a small coded dot. Where a hub
         now stands for that airport, two marks for one place reads as two places,
         so the old one steps aside whenever the hubs are showing. */
      var codes=cfg.hubs.map(function(h){return h.airport;}).filter(Boolean);
      if(codes.length){var css=document.createElement('style');css.textContent=codes.map(function(c){return '.tsh-on .airport-mark .ap[data-ap="'+c+'"],.tsh-on .airport-mark .ap[data-ap="'+c+'"]~.apc';}).join(',')+'{display:none}';document.head.appendChild(css);}
      refresh();mapEl.dataset.stationHubs=String(markers.length);
    }).catch(function(e){console.warn('Station hubs unavailable',e);});
    return {refresh:function(){refresh();if(panel&&current)panel.dataset.look=look();},ready:ready,open:function(name){var i=cfg&&cfg.hubs.findIndex(function(h){return h.name===name;});if(i>=0)open(cfg.hubs[i],markers[i]);},close:close};
  }
  global.TBStationHubs={attach:attach};
})(window);
