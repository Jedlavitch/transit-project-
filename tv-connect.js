/* The system/browser owns AirPlay and tab mirroring. This panel prepares the
   correct display and explains the final device selection, without inventing
   discovery results or reporting an unverified connection. */
(function(root){
  'use strict';
  var core,options,panel,returnFocus,selectedCity,selectedView,method='airplay',kind='computer';
  function el(id){return document.getElementById(id);}
  function text(id,value){el(id).textContent=value;}
  function status(value){text('castStatus',value);}
  function base(){return core.publicBase(location.href);}
  function url(){return core.displayURL(base(),selectedCity,selectedView,method);}
  function renderQR(){
    if(!el('castShare').open)return;
    var host=el('castQR');host.textContent='';
    try{host.innerHTML=root.TBQR.svg(url(),{quiet:4}).replace('aria-label="Pairing QR code"','aria-label="Open this display on your phone"');}
    catch(e){host.textContent='Use the display link above.';}
  }
  function render(){
    var guide=core.guide(method,kind);
    text('castCityName',selectedCity.name);
    el('castCityIcon').innerHTML=root.TBCityIcon?root.TBCityIcon(selectedCity.id):'';
    el('castView').value=selectedView.id;
    text('castMethodTitle',guide.title);text('castMethodIntro',guide.intro);
    text('castNote',guide.note);text('castStop',guide.stop);
    el('castMethodPanel').setAttribute('aria-labelledby','castMethod-'+method);
    var steps=el('castSteps');steps.textContent='';
    guide.steps.forEach(function(step,index){var li=document.createElement('li'),number=document.createElement('i'),heading=document.createElement('strong'),body=document.createElement('span');number.className='cast-step-number';number.setAttribute('aria-hidden','true');number.textContent=index+1;heading.textContent=step[0];body.textContent=step[1];li.appendChild(number);li.appendChild(heading);li.appendChild(body);steps.appendChild(li);});
    document.querySelectorAll('[data-cast-method]').forEach(function(b){var on=b.dataset.castMethod===method;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
    var help=el('castOfficialHelp');help.hidden=!guide.help;if(guide.help)help.href=guide.help;
    el('castOpen').href=url();el('castURL').value=url();
    text('castOpenLabel',method==='browser'?'Open display preview':'Open display to '+(method==='airplay'?'mirror':'cast'));
    text('castTroubleText',method==='airplay'?'Keep both devices on the same Wi-Fi, wake the TV, and check that AirPlay is enabled on it. On the Mac, use Control Center → Screen Mirroring.':method==='chromecast'?'Use an updated Google Chrome on a Mac or PC and keep the TV and computer on the same Wi-Fi. On macOS, check that Chrome has local-network access if no devices appear.':'Use the TV’s own web browser. Your display link is public and contains only the city and view you selected.');
    status('');renderQR();
  }
  function update(){
    var b=el('castBtn');if(!b||!options)return;
    var city=options.getCity();
    b.classList.remove('dim','casting');b.title='Show '+city.name+' on a TV using AirPlay or Chromecast';
    b.setAttribute('aria-label','Cast '+city.name+' to TV');b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded',String(!!panel&&panel.classList.contains('show')));
    b.querySelector('.lbl').textContent='Cast to TV';
  }
  function open(){
    returnFocus=document.activeElement;selectedCity=options.getCity();selectedView=core.inferView(options.getDefaultHref());
    try{var saved=localStorage.getItem('tb.tvCastMethod');if(['airplay','chromecast','browser'].indexOf(saved)>=0)method=saved;}catch(e){}
    render();panel.classList.add('show');update();
    el('castView').focus();
  }
  function close(){panel.classList.remove('show');update();try{if(returnFocus&&returnFocus.isConnected)returnFocus.focus({preventScroll:true});else el('castBtn').focus();}catch(e){el('castBtn').focus();}}
  function choose(value){if(['airplay','chromecast','browser'].indexOf(value)<0)return;method=value;try{localStorage.setItem('tb.tvCastMethod',method);}catch(e){}render();}
  function manualCopy(){el('castShare').open=true;var input=el('castURL');input.focus();input.select();try{if(document.execCommand&&document.execCommand('copy')){status('Display link copied.');return;}}catch(e){}status('The display link is selected. Copy it using your browser’s Copy command.');}
  function copy(){
    if(navigator.clipboard&&navigator.clipboard.writeText){try{Promise.resolve(navigator.clipboard.writeText(url())).then(function(){status('Display link copied.');},manualCopy);}catch(e){manualCopy();}}
    else manualCopy();
  }
  function init(config){
    options=config;core=root.TBTVConnectCore;panel=el('castHelp');
    kind=core.device(navigator.userAgent,navigator.platform,navigator.maxTouchPoints||0);
    method=kind==='iphone'||kind==='mac'?'airplay':'chromecast';
    core.views.forEach(function(v){var o=document.createElement('option');o.value=v.id;o.textContent=v.name;el('castView').appendChild(o);});
    el('castBtn').addEventListener('click',open);el('castClose').addEventListener('click',close);el('castCopy').addEventListener('click',copy);
    el('castView').addEventListener('change',function(){selectedView=core.view(this.value);render();});
    el('castOpen').addEventListener('click',function(){status(method==='airplay'?'When the display tab opens, choose Screen Mirroring in Control Center.':method==='chromecast'?'When the display tab opens, use Chrome’s Cast menu to choose your TV.':'Enter this display link in your TV’s browser.');});
    document.querySelectorAll('[data-cast-method]').forEach(function(b){
      b.addEventListener('click',function(){choose(b.dataset.castMethod);});
      b.addEventListener('keydown',function(e){if(['ArrowLeft','ArrowRight','Home','End'].indexOf(e.key)<0)return;e.preventDefault();var list=[].slice.call(document.querySelectorAll('[data-cast-method]')),at=list.indexOf(b);at=e.key==='Home'?0:e.key==='End'?list.length-1:(at+(e.key==='ArrowLeft'?-1:1)+list.length)%list.length;choose(list[at].dataset.castMethod);list[at].focus();});
    });
    el('castShare').addEventListener('toggle',renderQR);
    panel.addEventListener('click',function(e){if(e.target===panel)close();});
    update();
  }
  root.TBTVCast={init:init,open:open,close:close,update:update};
})(window);
