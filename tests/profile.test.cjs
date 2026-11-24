const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const markup=fs.readFileSync(require.resolve('../profile.html'),'utf8'),source=fs.readFileSync(require.resolve('../profile.js'),'utf8');
function fixture({signed=false,configured=true,stored={},blockedStorage=false,methods={code:true,password:true,google:false,apple:false},syncError=false}={}){
  const storage=new Map(Object.entries(stored)),nodes=new Map(),calls=[];
  class Element{
    constructor(){this.textContent='';this.innerHTML='';this.value='';this.className='';this.children=[];this.listeners={};this.focused=false;this.classes=new Set();this.classList={add:(...a)=>a.forEach(x=>this.classes.add(x)),remove:(...a)=>a.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x),toggle:(x,force)=>{const on=force===undefined?!this.classes.has(x):force;on?this.classes.add(x):this.classes.delete(x);return on;}};}
    addEventListener(k,f){this.listeners[k]=f;}
    appendChild(e){this.children.push(e);}
    focus(){this.focused=true;}
  }
  for(const m of markup.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){const el=new Element();if(/class="[^"]*\bhide\b/.test(m[0]))el.classes.add('hide');nodes.set(m[1],el);}
  const localStorage={getItem:k=>{if(blockedStorage)throw Error('unavailable');return storage.get(k)||null;},setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),key:i=>Array.from(storage.keys())[i],get length(){if(blockedStorage)throw Error('unavailable');return storage.size;}};
  const A={configured:()=>configured,signedIn:()=>signed,email:()=> 'test@example.test',hasPassword:()=>false,methods:async()=>methods,completeReturn:async()=>null,
    start:async email=>{calls.push(['start',email]);return 'test-ticket';},verify:async(token,code)=>{calls.push(['verify',token,code]);signed=true;},signInPassword:async(email,pw)=>{calls.push(['password',email,pw]);signed=true;},setPassword:async(...a)=>calls.push(['setPassword',...a]),signOut:async()=>{signed=false;calls.push(['signOut']);},sync:async()=>{calls.push(['sync']);if(syncError){signed=false;throw Error('not signed in');}return {count:3};},oauthGo:p=>calls.push(['oauth',p])};
  const context={document:{querySelector:s=>nodes.get(s.slice(1)),createElement:()=>new Element()},window:{TBAccount:A,TBLicense:{configured:false}},TBAccount:A,localStorage,navigator:{userAgent:'Mozilla/5.0 Macintosh Safari/605.1',clipboard:{writeText:async text=>calls.push(['copy',text])}},location:{search:'?from=philly.html'},URLSearchParams,Intl,Date,setTimeout:()=>0,confirm:()=>true,fetch:()=>{throw Error('Unexpected network call');}};
  vm.createContext(context);vm.runInContext(source,context);
  return {context,nodes,storage,calls,A,settle:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('redesign retains every existing account, licence, and device control without duplicate IDs',()=>{
  const ids=Array.from(markup.matchAll(/\bid="([^"]+)"/g),m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  for(const m of source.matchAll(/\$\("#([^"]+)"\)/g))assert.ok(ids.includes(m[1]),m[1]+' missing');
  for(const id of ['overview','security','screens','sightings','preferences','browser'])assert.ok(ids.includes(id));
});
test('email code sign-in preserves ticket, validates code, then shows the signed-in state',async()=>{
  const f=fixture();await f.settle();f.nodes.get('emailInput').value='test@example.test';await f.nodes.get('sendCodeBtn').onclick();
  assert.deepEqual(f.calls[0],['start','test@example.test']);assert.equal(f.nodes.get('stepEmail').classList.contains('hide'),true);
  f.nodes.get('codeInput').value='123';await f.nodes.get('verifyBtn').onclick();assert.equal(f.calls.length,1);
  f.nodes.get('codeInput').value='123456';await f.nodes.get('verifyBtn').onclick();await f.settle();
  assert.deepEqual(f.calls[1],['verify','test-ticket','123456']);assert.equal(f.nodes.get('acctUser').classList.contains('hide'),false);assert.equal(f.nodes.get('codeInput').value,'');
});
test('password sign-in follows supported server methods and clears the typed password',async()=>{
  const f=fixture();await f.settle();f.nodes.get('emailInput').value='test@example.test';f.nodes.get('pwInput').value='test-fixture-password';await f.nodes.get('sendCodeBtn').onclick();
  assert.equal(f.calls[0][0],'password');assert.equal(f.nodes.get('pwInput').value,'');assert.equal(f.nodes.get('acctUser').classList.contains('hide'),false);
});
test('expired sync sessions return to a usable sign-in form with a visible explanation',async()=>{
  const f=fixture({signed:true,syncError:true});await f.settle();await f.nodes.get('syncBtn').onclick();
  assert.equal(f.nodes.get('acctIn').classList.contains('hide'),false);assert.match(f.nodes.get('acctMsg').textContent,/session has ended/);
});
test('unconfigured accounts show local mode and do not expose unavailable sign-in controls',async()=>{
  const f=fixture({configured:false});await f.settle();assert.equal(f.nodes.get('acctOff').classList.contains('hide'),false);assert.equal(f.nodes.get('acctIn').classList.contains('hide'),true);assert.equal(f.calls.length,0);
});
test('malformed sightings and unavailable browser storage do not stop page initialization',async()=>{
  const bad=fixture({stored:{'tb.spots':'{"not":"an array"}'}});await bad.settle();assert.equal(bad.nodes.get('spotCount').textContent,'None yet');
  const blocked=fixture({blockedStorage:true});await blocked.settle();assert.equal(blocked.nodes.get('spotCount').textContent,'None yet');assert.equal(blocked.nodes.get('acctIn').classList.contains('hide'),false);
});
test('clearing this browser preserves its licence device ID, managed configuration, and unrelated data',async()=>{
  const f=fixture({stored:{'tb.device':'fixture-device','tb.configWrote':'{"tb.acctUrl":true}','tb.acctUrl':'https://example.test','tb.theme':'day','transitboard.loc':'{}','unrelated':'keep'}});await f.settle();f.nodes.get('forgetBtn').onclick();
  assert.equal(f.storage.has('tb.theme'),false);assert.equal(f.storage.has('transitboard.loc'),false);for(const k of ['tb.device','tb.acctUrl','tb.configWrote','unrelated'])assert.ok(f.storage.has(k));
});
test('signing out leaves local sightings in place and reports success in the visible form',async()=>{
  const f=fixture({signed:true,stored:{'tb.spots':'[{"ts":1000}]'}});await f.settle();await f.nodes.get('signOutBtn').onclick();assert.ok(f.storage.has('tb.spots'));assert.equal(f.nodes.get('acctIn').classList.contains('hide'),false);assert.match(f.nodes.get('acctMsg').textContent,/Signed out/);
});
