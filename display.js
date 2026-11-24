(function(){
  'use strict';
  var core=window.TBTVConnectCore,q=new URLSearchParams(location.search);
  var city=core.city(window.TBProjectorCities.all,q.get('city')),view=core.view(q.get('view'));
  var method=['airplay','chromecast','browser'].indexOf(q.get('method'))>=0?q.get('method'):'airplay';
  var kind=core.device(navigator.userAgent,navigator.platform,navigator.maxTouchPoints||0),guide=core.guide(method,kind);
  var frame=document.getElementById('displayFrame'),setup=document.getElementById('displaySetup'),show=document.getElementById('displayShow');
  var href=core.route(city,view);
  document.title=city.name+' / '+view.name+' — Transit Project TV display';
  document.getElementById('displaySetupTitle').textContent=city.name;
  document.getElementById('displayView').textContent=view.name;
  document.getElementById('displayCityIcon').innerHTML=window.TBCityIcon(city.id);
  document.getElementById('displayMethodTitle').textContent=method==='airplay'?'Ready to mirror with AirPlay':method==='chromecast'?'Ready to cast from Chrome':'Make yourself at home';
  var steps=method==='browser'?['Use Full screen below, or the TV browser’s own screen controls.','Hide this setup to enjoy the display.']:[guide.steps[1][1],guide.steps[2][1],'Hide this setup when you’re ready.'];
  steps.forEach(function(text){var li=document.createElement('li');li.textContent=text;document.getElementById('displaySteps').appendChild(li);});
  document.getElementById('displayNote').textContent=guide.note;
  document.getElementById('displayDirect').href=href;
  frame.title=city.name+' '+view.name;frame.src=href;
  document.getElementById('displayHide').onclick=function(){setup.hidden=true;show.hidden=false;show.setAttribute('aria-expanded','false');show.focus({preventScroll:true});};
  show.onclick=function(){setup.hidden=false;show.hidden=true;show.setAttribute('aria-expanded','true');document.getElementById('displayHide').focus({preventScroll:true});};
  document.getElementById('displayFullscreen').onclick=function(){
    var root=document.documentElement,active=document.fullscreenElement||document.webkitFullscreenElement;
    function failed(){document.getElementById('displayStatus').textContent='Use your browser or TV’s own full-screen controls on this device.';}
    try{var fn=active?(document.exitFullscreen||document.webkitExitFullscreen):(root.requestFullscreen||root.webkitRequestFullscreen);if(!fn){failed();return;}var p=fn.call(active?document:root);if(p&&p.catch)p.catch(failed);}catch(e){failed();}
  };
})();
