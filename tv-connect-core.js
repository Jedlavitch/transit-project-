/* Shared display destinations and platform instructions. These functions do
   not infer a TV connection from a browser API or from a successful popup. */
(function(root){
  'use strict';
  var views=[
    {id:'live',name:'Live board',file:null,city:false},
    {id:'sky',name:'Sky',file:'night.html',city:true},
    {id:'departures',name:'Departures',file:'flipboard.html',city:true},
    {id:'projector',name:'Projector',file:'projector.html',city:true},
    {id:'home',name:'Home',file:'home.html',city:false},
    {id:'tour',name:'Grand Tour',file:'tour.html',city:false}
  ];
  function view(id){return views.filter(function(v){return v.id===id;})[0]||views[0];}
  function city(cities,id){return cities.filter(function(c){return c.id===id;})[0]||cities[0];}
  function route(c,v){v=view(v&&typeof v==='object'?v.id:v);return (v.file||c.board)+(v.city?'?city='+encodeURIComponent(c.id)+(v.id==='projector'?'&surface=wall':''):'');}
  function publicBase(href){
    try{var u=new URL(href);if(u.protocol==='https:'&&!/^(localhost|127\.|\[?::1\]?)/i.test(u.hostname))return new URL('./',u).href;}catch(e){}
    return 'https://transitproject.online/';
  }
  function displayURL(base,c,v,method){var u=new URL('display.html',base);u.searchParams.set('city',c.id);u.searchParams.set('view',view(v&&typeof v==='object'?v.id:v).id);u.searchParams.set('method',method==='chromecast'?'chromecast':method==='browser'?'browser':'airplay');return u.href;}
  function inferView(href){
    var path=String(href||'').split('?')[0].split('/').pop();
    return views.filter(function(v){return v.file===path;})[0]||views[0];
  }
  function device(ua,platform,touches){
    if(/iPhone|iPad|iPod/i.test(ua)||platform==='MacIntel'&&touches>1)return 'iphone';
    if(/Macintosh|Mac OS X/i.test(ua))return 'mac';
    if(/Android/i.test(ua))return 'android';
    return 'computer';
  }
  function guide(method,kind){
    if(method==='chromecast')return {
      title:'Chrome → Chromecast / Google TV',
      intro:'Open the display in Google Chrome on a Mac or PC, then choose your TV from Chrome’s Cast menu.',
      steps:[['Open your display','Use the button below to open the selected view in a new tab.'],['Choose Cast in Chrome','Open ⋮ → Cast, save, and share → Cast….'],['Select your television','Choose your Chromecast or Google TV. If asked for a source, choose Cast tab.']],
      note:kind==='iphone'?'For Chromecast tab casting, open this link in Chrome on a computer. On this iPhone or iPad, choose AirPlay to mirror the display.':'Keep the display tab and Chrome open while casting.',
      stop:'To stop, use Chrome’s Cast icon → Stop casting.',
      help:'https://support.google.com/chromecast/answer/3228332'
    };
    if(method==='browser')return {
      title:'Open directly on your TV',intro:'A TV with a web browser can run the display itself.',
      steps:[['Copy the display link','The link below includes your selected city and view.'],['Open the TV’s web browser','Enter the link using your remote or your TV’s companion app.'],['Make it fill the screen','Use Full screen on the display, or the TV browser’s own zoom controls.']],
      note:'This runs on the television. Your phone or computer can be closed afterwards.',stop:'To leave the display, use your TV’s Home or Back button.',help:null
    };
    return {
      title:kind==='iphone'?'iPhone / iPad → AirPlay':'Mac → Apple TV / AirPlay',
      intro:'Mirror this display to an Apple TV or an AirPlay-compatible television.',
      steps:[['Open your display','Use the button below to open the selected view in a new tab.'],['Open Control Center',kind==='iphone'?'Open Control Center on your iPhone or iPad.':'Click Control Center in the Mac menu bar.'],['Choose Screen Mirroring','Select your Apple TV or AirPlay-compatible TV, then enter its onscreen code if requested.']],
      note:'Keep the display tab open and your device awake while mirroring. Screen Mirroring is selected in Control Center.',
      stop:'To stop, return to Control Center → Screen Mirroring.',
      help:kind==='iphone'?'https://support.apple.com/102661':'https://support.apple.com/guide/mac-help/mchld7e543a0/mac'
    };
  }
  var api={views:views,view:view,city:city,route:route,publicBase:publicBase,displayURL:displayURL,inferView:inferView,device:device,guide:guide};
  root.TBTVConnectCore=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
