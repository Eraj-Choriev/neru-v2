const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function context(files, extra={}) {
 const c=vm.createContext({console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,AbortController,Intl,Date,
 window:{dispatchEvent(){}},CustomEvent:class{},...extra});
 for(const f of files) vm.runInContext(fs.readFileSync(f,'utf8'),c);
 return c;
}
const station={id:1,marker1:'38.5',marker2:'68.7',connectors_info:[]};
test('concurrent station requests share one response; malformed proxy response falls through',async()=>{
 let calls=0;const c=context(['js/api.js'],{fetch:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {ok:true,json:async()=>calls===1?{error:'upstream'}:{code:200,powers:[station]}}}});
 const results=await vm.runInContext('Promise.all([stationAPI.fetchStations(),stationAPI.fetchStations()])',c);
 assert.equal(calls,2);assert.equal(results[0].length,1);assert.equal(results[1],results[0]);
});
test('normalization rejects invalid locations and handles malformed connectors',()=>{
 const c=context(['js/api.js']);c.raw=station;
 assert.equal(vm.runInContext('stationAPI.normalizeStation({...raw,marker1:"bad"})',c),null);
 assert.equal(vm.runInContext('stationAPI.normalizeStation({...raw,connectors_info:{}}).totalConnectors',c),0);
 assert.equal(vm.runInContext('stationAPI.normalizeStation({...raw,connectors_info:[null,{status:"Start charging",charging_level:130}]}).connectors[0].chargeLevel',c),100);
});
function router(){let resolvers=[];const c=context(['js/router.js'],{
 geoLocation:{getPosition:()=>({isLocated:true,lat:38,lng:68})},ui:{showToast(){},showRoutePanel(){},hideRoutePanel(){}},i18n:{t:x=>x},stationMap:{drawOSRMRoute(){},clearHighlight(){}}});
 c.pending=()=>new Promise(r=>resolvers.push(r));vm.runInContext('stationRouter._fetch=pending',c);
 return {c,resolvers,reply:{routes:[{geometry:{coordinates:[[68,38],[69,39]]},distance:100,duration:30}]}};
}
test('cancelled route cannot reappear after delayed response',async()=>{
 const {c,resolvers,reply}=router();const pending=vm.runInContext('stationRouter.routeTo({id:1,lat:39,lng:69})',c);
 vm.runInContext('stationRouter.clear()',c);resolvers[0](reply);await pending;
 assert.equal(vm.runInContext('stationRouter.activeRoute',c),null);
});
test('latest destination wins when route responses arrive out of order',async()=>{
 const {c,resolvers,reply}=router();const a=vm.runInContext('stationRouter.routeTo({id:1})',c);const b=vm.runInContext('stationRouter.routeTo({id:2})',c);
 resolvers[1](reply);await b;resolvers[0](reply);await a;
 assert.equal(vm.runInContext('stationRouter.activeRoute.station.id',c),2);
});
test('schedule validates hours; midnight closing does not mean 24/7',()=>{
 const c=context(['js/ui.js']);
 assert.equal(vm.runInContext('parseSchedule("08:00–24:00").is24',c),false);
 assert.equal(vm.runInContext('parseSchedule("00:00–24:00").is24',c),true);
 assert.equal(vm.runInContext('parseSchedule("99:00–24:00")',c),null);
});
test('offline shell includes every local script and stylesheet from HTML',()=>{
 const html=fs.readFileSync('index.html','utf8'); const sw=fs.readFileSync('sw.js','utf8');
 for(const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^" ]+)"/g)) assert.ok(sw.includes('/'+match[1]),match[1]);
});
test('failed station refresh preserves the last successful timestamp',async()=>{
 const c=context(['js/api.js'],{fetch:async()=>({ok:false})});
 vm.runInContext('stationAPI.stations=[{id:7}];stationAPI.lastFetch=new Date(123)',c);
 const r=await vm.runInContext('stationAPI.fetchStations()',c);
 assert.equal(r[0].id,7);assert.equal(vm.runInContext('stationAPI.lastFetch.getTime()',c),123);
});
test('refresh of old route cannot overwrite a newly selected destination',async()=>{
 const {c,resolvers,reply}=router();let a=vm.runInContext('stationRouter.routeTo({id:1})',c);resolvers[0](reply);await a;
 const refresh=vm.runInContext('stationRouter.refreshFromCurrent()',c);
 const next=vm.runInContext('stationRouter.routeTo({id:2})',c);resolvers[2](reply);await next;resolvers[1](reply);await refresh;
 assert.equal(vm.runInContext('stationRouter.activeRoute.station.id',c),2);
});
test('nearest search does not turn the fallback city centre into a GPS fix',async()=>{
 let markers=0,warnings=0;
 const c=context(['js/app.js'],{document:{addEventListener(){}},ui:{statsMode:'ev',showLoading(){},hideLoading(){},showToast(){warnings++;}},geoLocation:{getUserLocation:async()=>{throw Error('denied')},getPosition:()=>({lat:38,lng:68,isLocated:false})},stationAPI:{fetchStations:async()=>[]},stationMap:{setUserLocation(){markers++;}},i18n:{t:x=>x}});
 await vm.runInContext('app.handleFindNearest()',c);assert.equal(markers,0);assert.equal(warnings,1);
});
