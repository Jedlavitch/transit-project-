const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const core=require('../tv-connect-core.js');
const context={window:{}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../projector-cities.js'),'utf8'),context);
const cities=context.window.TBProjectorCities.all;

test('every city and display view resolves to the correct first-party page',()=>{
  assert.equal(cities.length,13);
  for(const city of cities)for(const view of core.views){
    const route=new URL(core.route(city,view),'https://transitproject.online/');
    assert.equal(route.origin,'https://transitproject.online');
    assert.equal(route.pathname,'/'+(view.file||city.board));
    assert.equal(route.searchParams.get('city'),view.city?city.id:null);
    assert.equal(route.searchParams.get('surface'),view.id==='projector'?'wall':null);
  }
});
test('share links preserve city, view and selected connection method',()=>{
  for(const city of cities)for(const view of core.views)for(const method of ['airplay','chromecast','browser']){
    const share=new URL(core.displayURL('https://transitproject.online/',city,view,method));
    assert.equal(share.pathname,'/display.html');
    assert.equal(share.searchParams.get('city'),city.id);
    assert.equal(share.searchParams.get('view'),view.id);
    assert.equal(share.searchParams.get('method'),method);
  }
});
test('unknown city and view values cannot become external iframe destinations',()=>{
  for(const value of ['constructor','toString','__proto__','https://example.com/','javascript:alert(1)','../../profile.html',null]){
    assert.equal(core.city(cities,value).id,'dc');
    assert.equal(core.view(value).id,'live');
    assert.equal(core.route(cities[0],value),'dc.html');
  }
});
test('local previews copy published links rather than inaccessible loopback addresses',()=>{
  for(const host of ['http://localhost:4218/tv.html','http://127.0.0.1:4218/tv.html','https://localhost/tv.html','https://[::1]/tv.html'])assert.equal(core.publicBase(host),'https://transitproject.online/');
  assert.equal(core.publicBase('https://example.com/transit/tv.html'),'https://example.com/transit/');
});
test('the selected display is inferred from view links without changing its city',()=>{
  assert.equal(core.inferView('projector.html?city=philly&surface=wall').id,'projector');
  assert.equal(core.inferView('https://transitproject.online/night.html?city=la').id,'sky');
  assert.equal(core.inferView('flipboard.html?city=rome').id,'departures');
  assert.equal(core.inferView('philadelphia.html').id,'live');
  assert.equal(core.inferView('profile.html').id,'live');
});
test('iPad desktop mode receives the iPhone/iPad mirroring instructions',()=>{
  assert.equal(core.device('Mozilla/5.0 (Macintosh)','MacIntel',5),'iphone');
  assert.equal(core.device('Mozilla/5.0 (iPhone)','iPhone',0),'iphone');
  assert.equal(core.device('Mozilla/5.0 (Macintosh)','MacIntel',0),'mac');
  assert.equal(core.device('Mozilla/5.0 (Windows NT 10.0)','Win32',0),'computer');
});
test('setup explains the actual system handoff and never reports an unverified connection',()=>{
  for(const kind of ['iphone','mac','computer','android']){
    const airplay=core.guide('airplay',kind),cast=core.guide('chromecast',kind);
    assert.match(JSON.stringify(airplay),/Control Center/);
    assert.match(JSON.stringify(cast),/Cast tab/);
    assert.match(airplay.note,/Keep the display tab open/);
    assert.match(cast.note,kind==='iphone'?/computer/:/Chrome open/);
    assert.doesNotMatch(JSON.stringify(airplay)+JSON.stringify(cast),/connected successfully|TV found|is connected|can close this tab/i);
  }
});
