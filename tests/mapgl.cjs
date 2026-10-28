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
  return {s,shapes,loads:()=>loads};
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
