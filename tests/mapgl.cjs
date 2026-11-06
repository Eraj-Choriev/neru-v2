const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
  const shapes=[];
  class Shape { constructor(map,options){this.options=options;shapes.push(this);} destroy(){this.destroyed=true;} on(){} }
  const c=vm.createContext({mapgl:{Polyline:Shape,CircleMarker:Shape},window:{matchMedia:()=>({matches:true})},i18n:{t:k=>k}});
  vm.runInContext(fs.readFileSync('js/map.js','utf8')+';this.subject=stationMap;',c);
  const s=c.subject;let loads=0;
  s.stationCluster={load(){loads++;}};s.parkingCluster={load(){}};
  s.map={fitBounds(bounds){s.bounds=bounds;}};
  return {s,shapes,c,loads:()=>loads};
}
const station={id:'1',lat:38.5,lng:68.7,freeConnectors:2,totalConnectors:2,maxChargeLevel:0};
test('identical station snapshots do not reload the cluster; changed status does',()=>{
  const {s,loads}=setup();s.renderStations([station]);s.renderStations([{...station}]);assert.equal(loads(),1);
  s.renderStations([{...station,freeConnectors:0}]);assert.equal(loads(),2);
  s.setStationsVisible(false);s.renderStations([station]);assert.equal(loads(),3);
  s.setStationsVisible(true);assert.equal(loads(),4);
});
test('routes use MapGL longitude-first geometry and named bounds; unchanged reroutes reuse shapes',()=>{
  const {s}=setup();const coords=[[38,68],[39,69]];s.drawOSRMRoute(coords,station);
  assert.deepEqual(JSON.parse(JSON.stringify(s.routeLine.options.coordinates)),[[68,38],[69,39]]);
  assert.deepEqual(JSON.parse(JSON.stringify(s.bounds)),{southWest:[68,38],northEast:[69,39]});
  const first=s.routeLine;s.drawOSRMRoute(coords,station,false);assert.equal(s.routeLine,first);
  s.drawOSRMRoute([[38.1,68.1],[39,69]],station,false);assert.equal(first.destroyed,true);
});
test('parking refresh reuses geometry and hiding it releases all strips',()=>{
  const {s}=setup();const zones=[{id:1,lat:38.5,lng:68.7,a:[38.5,68.7],b:[38.6,68.8]}];
  s.parkingVisible=true;s.renderParkingZones(zones);const first=s.parkingLines[0];
  s.renderParkingZones(zones);assert.equal(s.parkingLines[0],first);
  s.parkingVisible=false;s._syncParking();assert.equal(first.destroyed,true);assert.equal(s.parkingLines.length,0);
});

function spiderSetup(width,height,origin=[width/2,height/2]) {
  const {s,c}=setup();
  c.setTimeout=()=>0; // the pan fallback timer; moveend is driven by hand
  const element=()=>({style:{},append(){},setAttribute(){},querySelectorAll(){return []},remove(){this.removed=true;}});
  c.document={createElement:element,createElementNS:element,querySelector:selector=>({getBoundingClientRect:()=>selector==='.header'?{bottom:112}:{top:height-82,height:64}})};
  s.container={getBoundingClientRect:()=>({left:0,top:0,width,height,bottom:height}),parentNode:{append(){}}};
  s.map.project=()=>origin;
  return {s,c};
}
const group=(s,n)=>{
  const stations=Array.from({length:n},(_,i)=>({...station,id:String(i)}));
  s.stations=new Map(stations.map(x=>[x.id,x]));
  return stations.map(x=>({coordinates:[x.lng,x.lat],userData:{id:x.id}}));
};

test('a group opens as a compact web: no overlaps, hub clear, tighter than the old single circle',()=>{
  for (const n of [2,5,8,12,14,16,20]) {
    const {s}=spiderSetup(414,896);
    s._openGroup(group(s,n),false);
    const [ox,oy]=s._spider.origin;
    const layout=s._spiderLayout(n);
    const pts=[...s._spider.positions.values()];
    assert.equal(pts.length,n);
    for (const [i,p] of pts.entries()) {
      const r=Math.hypot(p[0]-ox,p[1]-oy);
      assert.ok(r>=21.5+layout.size/2+6,`n=${n}: marker ${i} touches the hub`);
      for (const q of pts.slice(i+1)) assert.ok(Math.hypot(p[0]-q[0],p[1]-q[1])>=layout.size+5.9,`n=${n}: markers overlap`);
    }
    // The previous layout put 12 markers on a 100px ring and 20 on 134px.
    assert.ok(layout.extent<=(n<=8?73.5:n<=12?100:126),`n=${n}: web too wide (${layout.extent})`);
  }
});

test('the hub sits exactly on the cluster, never nudged beside it',()=>{
  const {s}=spiderSetup(414,896,[207.25,401.5]);
  s._openGroup(group(s,12),false);
  assert.deepEqual([...s._spider.origin],[207.25,401.5]);
  assert.match(s._spider.hub.style.cssText,/left:207\.25px;top:401\.5px/);
});

test('a web that would spill off-screen pans the map, then opens over the moved cluster',()=>{
  const {s}=spiderSetup(390,844,[20,300]);
  let center=null,handlers={};
  Object.assign(s.map,{getCenter:()=>[68.7,38.5],unproject:p=>p,setCenter(c){center=c;},on(ev,fn){handlers[ev]=fn;},off(ev){delete handlers[ev];}});
  s._openGroup(group(s,8),false);
  assert.equal(s._spider,undefined,'must not open before the camera moves');
  assert.ok(center&&center[0]<20,'map must move so the cluster comes right');
  s.map.project=()=>[120,300];
  handlers.moveend();
  assert.deepEqual([...s._spider.origin],[120,300]);
  assert.equal(handlers.moveend,undefined,'listener removed');
});

test('landscape phones still fit 20 markers by shrinking them, all inside the usable area',()=>{
  const {s}=spiderSetup(896,414,[448,226]);
  s._openGroup(group(s,20),false);
  assert.ok(s._spider,'opened without needing a pan');
  for (const p of s._spider.positions.values()) assert.ok(p[0]>=8&&p[0]<=888&&p[1]>=120&&p[1]<=324,`outside: ${p}`);
  const layer=s._spider.element;s._closeSpider();assert.equal(layer.removed,true);assert.equal(s._spider,null);
});

test('closing a spider cancels pending reveal animations and is safe to repeat',()=>{
  const {s}=setup();let cancelled=0,removed=0;
  s._spider={animations:[{cancel(){cancelled++;}},{cancel(){cancelled++;}}],reveal:[],element:{style:{},querySelectorAll(){return []},remove(){removed++;}}};
  s._closeSpider();s._closeSpider();
  assert.equal(cancelled,2);assert.equal(removed,1);assert.equal(s._spider,null);
});

test('a six-station cluster opens directly without a second zoom',()=>{
 const {s,c}=setup();let handler,opened=0,zoomed=0;
 c.mapgl.Clusterer=class {on(event,fn){handler=fn;} getClusterExpansionZoom(){return 17;}};
 s.map={getZoom:()=>13,setCenter(){zoomed++},setZoom(){zoomed++}};
 s._openGroup=(data)=>{opened=data.length};
 s._cluster(false);
 handler({target:{type:'cluster',data:Array.from({length:6},(_,i)=>({coordinates:[i,i]}))},lngLat:[0,0]});
 assert.equal(opened,6);assert.equal(zoomed,0);
});
