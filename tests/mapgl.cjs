const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
  const shapes=[];
  class Shape { constructor(map,options){this.options=options;shapes.push(this);} destroy(){this.destroyed=true;} on(){} }
  const c=vm.createContext({mapgl:{Polyline:Shape,CircleMarker:Shape},window:{matchMedia:()=>({matches:false})}});
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

test('20 expanded points stay separated and inside the usable phone viewport',()=>{
  for (const [width,height] of [[320,568],[414,896],[896,414]]) {
    const {s,c}=setup();
    const element=()=>({style:{},append(){},setAttribute(){},remove(){this.removed=true;}});
    c.document={createElement:element,createElementNS:element,querySelector:selector=>({getBoundingClientRect:()=>selector==='.header'?{bottom:112}:{top:height-82,height:64}})};
    s.container={getBoundingClientRect:()=>({left:0,top:0,width,height,bottom:height}),parentNode:{append(){}}};
    s.map.project=()=>[width/2,height/2];
    const stations=Array.from({length:20},(_,i)=>({...station,id:String(i)}));
    s.stations=new Map(stations.map(s=>[s.id,s]));
    s._openGroup(stations.map(s=>({coordinates:[s.lng,s.lat],userData:{id:s.id}})),false);
    const positions=[...s._spider.positions.values()];
    assert.equal(positions.length,20);
    for(const [i,p] of positions.entries()) {
      assert.ok(p[0]>=22&&p[0]<=width-22&&p[1]>=134&&p[1]<=height-104);
      for(const q of positions.slice(i+1)) assert.ok(Math.abs(p[0]-q[0])>=44||Math.abs(p[1]-q[1])>=44);
    }
    const layer=s._spider.element;s._closeSpider();assert.equal(layer.removed,true);assert.equal(s._spider,null);
  }
});

test('closing a spider cancels pending reveal animations and is safe to repeat',()=>{
  const {s}=setup();let cancelled=0,removed=0;
  s._spider={animations:[{cancel(){cancelled++;}},{cancel(){cancelled++;}}],element:{remove(){removed++;}}};
  s._closeSpider();s._closeSpider();
  assert.equal(cancelled,2);assert.equal(removed,1);assert.equal(s._spider,null);
});
