(function(){
  'use strict';
  var d=document, sections=Array.from(d.querySelectorAll('[data-account-section]'));
  var iconPaths={
    overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    security:'<path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    screens:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M7 13V9m5 4V7m5 6v-3"/>',
    sightings:'<path d="m8 3 1 3m7-3-1 3M4 17l-2 3m18-3 2 3"/><path d="m3 15 2-7h5l2 8 2-8h5l2 7"/><circle cx="6.5" cy="16.5" r="4.5"/><circle cx="17.5" cy="16.5" r="4.5"/>',
    preferences:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="var(--account-panel)"/><circle cx="16" cy="12" r="2" fill="var(--account-panel)"/><circle cx="8" cy="18" r="2" fill="var(--account-panel)"/>',
    browser:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M7 6h.01M10 6h.01m-3 7h4m-4 4h8"/>'
  };
  d.querySelectorAll('[data-icon]').forEach(function(el){el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(iconPaths[el.dataset.icon]||iconPaths.overview)+'</svg>';});
  function byId(id){return d.getElementById(id);}
  function get(key){try{return localStorage.getItem(key)||'';}catch(e){return '';}}
  function text(id,value){var el=byId(id);if(el&&el.textContent!==String(value))el.textContent=value;}
  function visible(id){return byId(id)&&!byId(id).classList.contains('hide');}
  function showSection(id,focus){
    if(!sections.some(function(s){return s.id===id;}))id='overview';
    sections.forEach(function(s){s.hidden=s.id!==id;});
    d.querySelectorAll('[data-section-link]').forEach(function(a){if(a.closest('.account-nav')){if(a.dataset.sectionLink===id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}});
    d.title=(id==='overview'?'Your account':byId(id+'Title').textContent)+' — Transit Project';
    if(focus){byId(id+'Title').focus({preventScroll:true});window.scrollTo({top:0,behavior:'auto'});}
  }
  d.documentElement.classList.add('account-enhanced');
  d.querySelectorAll('[data-section-link]').forEach(function(a){a.addEventListener('click',function(e){if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;var id=a.dataset.sectionLink; e.preventDefault();if(location.hash!=='#'+id)history.pushState(null,'','#'+id);showSection(id,true);});});
  window.addEventListener('hashchange',function(){showSection(location.hash.slice(1),true);});
  window.addEventListener('popstate',function(){showSection(location.hash.slice(1),false);});
  showSection(location.hash.slice(1),false);

  var cities=[['dc','Washington DC'],['philly','Philadelphia'],['nyc','New York'],['boston','Boston'],['sf','San Francisco'],['chicago','Chicago']];
  var routes={philly:'philly',dc:'dc'};
  cities.forEach(function(city){var a=d.createElement('a');a.href=(routes[city[0]]||city[0])+'.html';a.innerHTML=(window.TBCityIcon?TBCityIcon(city[0]):'')+'<span>'+city[1]+'</span>';byId('accountCities').appendChild(a);});
  function summary(){
    var signed=visible('acctUser'),off=visible('acctOff'),email=signed?byId('acctEmail').textContent:'';
    text('identityTitle',signed?email:'Your space');text('identityStatus',signed?'Signed in':off?'Local browser':'Not signed in');
    text('accountAvatar',signed&&email?email.slice(0,2).toUpperCase():'TP');
    text('overviewAccount',signed?'Signed in':off?'Local mode':'Sign in');text('overviewAccountNote',signed?email:off?'Boards work without an account':'Bring your Spotter log along');
    var count=byId('spotCount').textContent;text('overviewSpots',count==='None yet'?'0':count||'0');
    text('overviewSpotNote',count==='None yet'?'Your next discovery starts here':'Saved in this browser');
    var licence=byId('licStatus').textContent.trim();text('overviewLicence',licence==='Not in use'?'Free to use':licence==='—'?'Checking…':licence);
    text('overviewLicenceNote',licence==='Not in use'?'No licence needed right now':'Access on this browser');
    preferenceState();
  }
  ['acctOff','acctIn','acctUser','acctEmail','spotCount','licStatus'].forEach(function(id){new MutationObserver(summary).observe(byId(id),{attributes:true,attributeFilter:['class'],childList:true,subtree:true,characterData:true});});
  function preferenceState(){
    var theme=get('tb.theme')||'dark',accent=get('tb.accent').toUpperCase();
    var brand=d.querySelector('.account-brand img');if(brand)brand.src=theme==='day'?'brand/mark-on-light.svg':'brand/mark-on-dark.svg';
    d.querySelectorAll('[data-theme-choice]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.themeChoice===theme));});
    d.querySelectorAll('[data-accent-choice]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.accentChoice===accent));});
  }
  function save(key,value){try{if(value)localStorage.setItem(key,value);else localStorage.removeItem(key);return true;}catch(e){text('prefMsg','This browser could not save the change. Check its storage settings.');byId('prefMsg').className='msg bad';return false;}}
  d.querySelectorAll('[data-theme-choice]').forEach(function(b){b.addEventListener('click',function(){var mode=b.dataset.themeChoice;if(!save('tb.theme',mode))return;d.documentElement.setAttribute('data-theme',mode);preferenceSaved();});});
  d.querySelectorAll('[data-accent-choice]').forEach(function(b){b.addEventListener('click',function(){var color=b.dataset.accentChoice;if(!save('tb.accent',color))return;if(color)d.documentElement.style.setProperty('--accent',color);else d.documentElement.style.removeProperty('--accent');preferenceSaved();});});
  function preferenceSaved(){if(typeof paintPrefs==='function')paintPrefs();preferenceState();text('prefMsg','Saved in this browser. Boards using shared appearance will use it when opened or reloaded.');byId('prefMsg').className='msg good';}
  window.addEventListener('storage',function(){if(typeof paintSpots==='function')paintSpots();if(typeof paintPrefs==='function')paintPrefs();if(typeof paintAccount==='function')paintAccount();var mode=get('tb.theme')||'dark';d.documentElement.setAttribute('data-theme',mode);summary();});

  /* Keep existing feature handlers, adding keyboard submission and one request
     at a time. This does not create sessions or send requests on its own. */
  [['emailInput','sendCodeBtn'],['pwInput','sendCodeBtn'],['codeInput','verifyBtn'],['pwNew','pwSaveBtn'],['pwCur','pwSaveBtn'],['keyInput','saveKeyBtn']].forEach(function(pair){byId(pair[0]).addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.isComposing){e.preventDefault();byId(pair[1]).click();}});});
  ['sendCodeBtn','verifyBtn','syncBtn','pwSaveBtn','pwRemoveBtn','saveKeyBtn','signOutBtn'].forEach(function(id){var b=byId(id),handler=b.onclick;if(!handler)return;b.onclick=async function(e){if(b.disabled)return;b.disabled=true;b.setAttribute('aria-busy','true');try{await handler.call(b,e);}finally{b.disabled=false;b.removeAttribute('aria-busy');summary();}};});
  byId('codeInput').addEventListener('input',function(){this.value=this.value.replace(/\D/g,'').slice(0,6);});
  summary();
})();
