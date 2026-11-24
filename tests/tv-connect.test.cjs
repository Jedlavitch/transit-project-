const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../tv-connect-core.js');
const source=fs.readFileSync(require.resolve('../tv-connect.js'),'utf8');
function fixture({clipboard='ok',copyFallback=false,ua='Macintosh',platform='MacIntel',saved=''}={}){
  const nodes=new Map(),storage=new Map(saved?[['tb.tvCastMethod',saved]]:[]);
  let selected=false,copied='',qrURL='';
  const doc={activeElement:null,createElement:tag=>new Element(tag),getElementById:id=>nodes.get(id),querySelectorAll:()=>methods,execCommand:()=>copyFallback};
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.value='';this.textContent='';this.innerHTML='';this.attrs={};this.dataset={};this.children=[];this.handlers={};this.isConnected=true;this.open=false;const set=new Set();this.classList={add:(...a)=>a.forEach(x=>set.add(x)),remove:(...a)=>a.forEach(x=>set.delete(x)),contains:x=>set.has(x)};}
    setAttribute(k,v){this.attrs[k]=v;}
    getAttribute(k){return this.attrs[k];}
    appendChild(n){this.children.push(n);return n;}
    addEventListener(k,f){(this.handlers[k]||(this.handlers[k]=[])).push(f);}
    querySelector(){return this.label||(this.label=new Element('span'));}
    focus(){doc.activeElement=this;}
    select(){selected=true;}
    fire(k,event={}){(this.handlers[k]||[]).forEach(f=>f.call(this,{target:this,preventDefault(){},...event}));}
  }
  ['castBtn','castHelp','castClose','castStatus','castCityName','castCityIcon','castView','castMethodTitle','castMethodIntro','castNote','castStop','castSteps','castOfficialHelp','castOpen','castURL','castOpenLabel','castTroubleText','castCopy','castShare','castQR','castMethodPanel'].forEach(id=>nodes.set(id,new Element()));
  const methods=['airplay','chromecast','browser'].map(id=>{const e=new Element('button');e.dataset.castMethod=id;return e;});
  const navigator={userAgent:ua,platform,maxTouchPoints:0};
  if(clipboard!=='absent')navigator.clipboard={writeText:v=>{copied=v;return clipboard==='ok'?Promise.resolve():Promise.reject(new Error('blocked'));}};
  const context={window:{TBTVConnectCore:core,TBCityIcon:id=>'<svg>'+id+'</svg>',TBQR:{svg:v=>{qrURL=v;return '<svg aria-label="Pairing QR code"></svg>';}}},document:doc,navigator,location:{href:'https://transitproject.online/tv.html'},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},Promise};
  vm.createContext(context);vm.runInContext(source,context);
  const api=context.window.TBTVCast,city={id:'philly',name:'Philadelphia',board:'philadelphia.html'};
  const previousFocus=new Element('button');previousFocus.focus();
  api.init({getCity:()=>city,getDefaultHref:()=> 'projector.html?city=philly&surface=wall'});
  return {api,nodes,methods,doc,previousFocus,state:()=>({selected,copied,qrURL,storage})};
}
test('AirPlay opens with the chosen city and view, and accurate Control Center steps',()=>{
  const f=fixture();f.api.open();
  assert.equal(f.nodes.get('castCityName').textContent,'Philadelphia');
  assert.equal(f.nodes.get('castView').value,'projector');
  const u=new URL(f.nodes.get('castOpen').href);
  assert.equal(u.searchParams.get('city'),'philly');assert.equal(u.searchParams.get('view'),'projector');assert.equal(u.searchParams.get('method'),'airplay');
  assert.equal(f.nodes.get('castBtn').attrs['aria-expanded'],'true');
  assert.match(f.nodes.get('castNote').textContent,/Control Center/);
});
test('Chromecast tab and view selection change the display link without claiming a connection',()=>{
  const f=fixture();f.api.open();f.methods[1].fire('click');
  f.nodes.get('castView').value='departures';f.nodes.get('castView').fire('change');
  const u=new URL(f.nodes.get('castOpen').href);
  assert.equal(u.searchParams.get('method'),'chromecast');assert.equal(u.searchParams.get('view'),'departures');
  assert.equal(f.methods[1].attrs['aria-selected'],'true');
  assert.match(f.nodes.get('castMethodTitle').textContent,/Chrome/);
  f.nodes.get('castOpen').fire('click');assert.match(f.nodes.get('castStatus').textContent,/choose your TV/);
  assert.doesNotMatch(f.nodes.get('castStatus').textContent,/connected|discovered/i);
});
test('clipboard success reports success only after the write resolves',async()=>{
  const f=fixture();f.api.open();f.nodes.get('castCopy').fire('click');
  assert.equal(f.nodes.get('castStatus').textContent,'');
  await Promise.resolve();assert.equal(f.nodes.get('castStatus').textContent,'Display link copied.');
  assert.equal(f.state().copied,f.nodes.get('castOpen').href);
});
test('blocked clipboard provides a selected link and a manual-copy message',async()=>{
  const f=fixture({clipboard:'blocked'});f.api.open();f.nodes.get('castCopy').fire('click');await Promise.resolve();
  assert.equal(f.nodes.get('castShare').open,true);
  assert.equal(f.state().selected,true);assert.match(f.nodes.get('castStatus').textContent,/selected.*Copy/);
});
test('older browsers can use the legacy copy fallback',()=>{
  const f=fixture({clipboard:'absent',copyFallback:true});f.api.open();f.nodes.get('castCopy').fire('click');
  assert.equal(f.nodes.get('castStatus').textContent,'Display link copied.');
});
test('dismissal restores focus and clears expanded state',()=>{
  const f=fixture();f.api.open();f.api.close();
  assert.equal(f.doc.activeElement,f.previousFocus);assert.equal(f.nodes.get('castHelp').classList.contains('show'),false);
  assert.equal(f.nodes.get('castBtn').attrs['aria-expanded'],'false');
});
test('QR sharing uses the exact selected display URL',()=>{
  const f=fixture();f.api.open();f.nodes.get('castShare').open=true;f.nodes.get('castShare').fire('toggle');
  assert.equal(f.state().qrURL,f.nodes.get('castOpen').href);
  assert.match(f.nodes.get('castQR').innerHTML,/Open this display on your phone/);
});
test('saved method selection and keyboard method switching remain usable',()=>{
  const f=fixture({saved:'chromecast'});f.api.open();assert.equal(f.methods[1].attrs['aria-selected'],'true');
  f.methods[1].fire('keydown',{key:'ArrowRight'});assert.equal(f.methods[2].attrs['aria-selected'],'true');
  assert.equal(f.state().storage.get('tb.tvCastMethod'),'browser');assert.equal(f.doc.activeElement,f.methods[2]);
});
