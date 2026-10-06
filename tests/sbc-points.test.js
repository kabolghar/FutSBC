import test from 'node:test';
import assert from 'node:assert/strict';
import {eaOperation} from '../extension/ea.js';
const observed=response=>({observe(owner,fn){queueMicrotask(()=>fn(this,{success:true,...response}));},unobserve(){}});
function setup({target=2500,submitted=0,limit=30,pool,fail=false}={}){
 const card=(id,score,rating=80,extra={})=>({id,definitionId:id,name:`Card ${id}`,sbsScore:score,rating,rareflag:0,loans:-1,isValid:()=>true,...extra});
 const rows=pool||[card(1,180),card(2,180),card(3,180),card(4,180),card(5,280),card(6,280),card(7,340),card(8,340),card(9,410),card(10,830,84)];
 const challenge={id:7,name:'Points challenge',scoreRequirement:target,submittedScore:submitted,isOneClickChallenge:()=>true};
 const ids=new Set(),items=new Map(),scores=new Map();let refreshes=0,submits=0;
 const model={getChallenge:()=>challenge,getSelectedScore:()=>[...ids].reduce((sum,id)=>sum+scores.get(id),0),getSelectionLimit:()=>limit,getSelectedItemIds:()=>[...ids],clearSelection:()=>ids.clear(),selectItem:item=>{if(fail||ids.size>=limit)return false;ids.add(item.id);return true;},_itemEntityMap:items,_itemScoreMap:scores,_itemTabMap:new Map()};
 const controller={getViewModel:()=>model,_refreshCurrentPage:()=>refreshes++};
 const current={workAreaController:controller},club={isXbox:true};let displayed=current;
 globalThis.window={fut_year:'2027'};globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>displayed})})})});
 globalThis.UTSearchCriteriaDTO=class{};globalThis.PileSearchType={CLUB:1,STORAGE:2};globalThis.OneClickSBCWorkAreaTab={CLUB:1,STORAGE:2};
 globalThis.services={User:{getUser:()=>({getSelectedPersona:()=>({getCurrentClub:()=>club})})},Squad:{requestSquadByType:()=>observed({data:{squad:{getPlayers:()=>[{item:{id:999}}]}}})},Club:{search:criteria=>{assert.equal(criteria.sbcChallengeId,7);assert.equal(criteria.isFavorite,false);return observed({response:{items:criteria.pileSearchType===1?rows:[],retrievedAll:true}});}},SBC:{isItemInSquad:id=>id===999,submit:()=>submits++}};
 return {card,challenge,model,rows,ids,current,navigate:()=>{displayed={};},get refreshes(){return refreshes;},get submits(){return submits;}};
}
async function build(maxRating=82,excludedDefinitionIds=[],extra={}){const status=await eaOperation('status');assert.equal(status.challenge.kind,'points');return eaOperation('sbcPointsBuild',{fingerprint:status.challenge.fingerprint,maxRating,excludedDefinitionIds,...extra});}
// Accelerate only backoff slices; request timeouts and cancellation timers stay real.
function fastBackoff(t){const timeout=globalThis.setTimeout;t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>timeout(fn,ms===100?0:ms,...args));}
function retainSelection(env){env.model._itemEntityMap.set(50,env.card(50,10));env.model._itemScoreMap.set(50,10);env.ids.add(50);}
test('points SBC reads authoritative item scores and stages a low-waste batch without submission',async()=>{
 const env=setup();const result=await build();assert.equal(result.ok,true,result.error);assert.equal(result.score,2370);assert.equal(result.shortfall,130);assert.equal(env.ids.size,9);assert.equal(env.submits,0);assert.equal(env.refreshes,1);
});
test('duplicate owned instances count separately and submitted progress reduces the target',async()=>{
 const env=setup({target:2500,submitted:1500});env.rows.splice(0,env.rows.length,env.card(1,500,80,{definitionId:42}),env.card(2,500,80,{definitionId:42}),env.card(3,1100,81));
 const result=await build();assert.equal(result.ok,true,result.error);assert.equal(result.target,1000);assert.equal(result.score,1000);assert.equal(result.players.length,2);assert.equal(result.excess,0);
});
test('rating cap, exclusions, loans, specials, favorites and active squad are protected',async()=>{
 const env=setup({target:200});env.rows.splice(0,env.rows.length,env.card(999,200),env.card(1,200,89),env.card(2,200,80,{loans:0}),env.card(3,200,80,{rareflag:3}),env.card(4,200,80,{isFavorite:true}),env.card(5,200),env.card(6,250));
 const result=await build(82,[5]);assert.equal(result.ok,true,result.error);assert.deepEqual(result.players.map(row=>row.itemId),['6']);assert.equal(result.excess,50);
});
test('submission batch limit yields a clearly marked partial batch',async()=>{
 const env=setup({target:1000,limit:2});env.rows.splice(0,env.rows.length,...[1,2,3].map(id=>env.card(id,300)));
 const result=await build();assert.equal(result.ok,true,result.error);assert.equal(result.score,600);assert.equal(result.shortfall,400);assert.equal(env.ids.size,2);
});
test('failed selection restores the original selected IDs',async()=>{
 const env=setup({target:180,fail:true});env.model._itemEntityMap.set(50,env.card(50,10));env.model._itemScoreMap.set(50,10);env.ids.add(50);
 // Fail only the proposed card; restoring the prior selection still works.
 env.model.selectItem=item=>{if(item.id!==50)return false;env.ids.add(50);return true;};
 const result=await build();assert.equal(result.ok,false);assert.deepEqual([...env.ids],[50]);assert.equal(env.submits,0);
});
test('no active squad response fails before selection',async()=>{
 const env=setup();services.Squad.requestSquadByType=()=>observed({data:{}});const result=await build();assert.equal(result.ok,false);assert.match(result.error,/active squad/);assert.equal(env.ids.size,0);
});
test('manual Work Area edits during loading are preserved',async()=>{
 const env=setup();const original=services.Club.search;let edited=false;
 services.Club.search=criteria=>{if(!edited){edited=true;env.model._itemEntityMap.set(50,env.card(50,10));env.model._itemScoreMap.set(50,10);env.ids.add(50);}return original(criteria);};
 const result=await build();assert.equal(result.ok,false);assert.match(result.error,/selection changed/);assert.deepEqual([...env.ids],[50]);assert.equal(env.refreshes,0);
});
test('503 reads recover with a fresh active squad request and retry only the failed club page',async t=>{
 fastBackoff(t);const env=setup({target:10000,limit:100});let activeCalls=0;
 const active=services.Squad.requestSquadByType;
 services.Squad.requestSquadByType=()=>++activeCalls===1?observed({success:false,status:503}):active();
 const calls=[];let failed=false;
 services.Club.search=criteria=>{
  calls.push([criteria.pileSearchType,criteria.offset,criteria.sbcChallengeId,criteria.count]);
  if(criteria.pileSearchType===PileSearchType.STORAGE)return observed({response:{items:[],retrievedAll:true}});
  if(criteria.offset===0)return observed({response:{items:Array.from({length:100},(_,i)=>env.card(i+1,100)),retrievedAll:false}});
  if(!failed){failed=true;return observed({success:false,status:'503'});}
  return observed({response:{items:[env.card(101,100)],retrievedAll:true}});
 };
 const result=await build();assert.equal(result.ok,true,result.error);assert.equal(activeCalls,2);
 assert.deepEqual(calls,[[1,0,7,100],[1,100,7,100],[1,100,7,100],[2,0,7,100]]);
 assert.equal(result.checked,101);assert.equal(result.score,10000);assert.equal(result.players.length,100);assert.equal(env.refreshes,1);assert.equal(env.submits,0);
});
for(const stage of ['pointsActiveSquad','pointsClubCards','pointsStorageCards'])test(`persistent 503 in ${stage} is bounded and preserves an existing selection`,async t=>{
 fastBackoff(t);const env=setup();retainSelection(env);let calls=0;
 if(stage==='pointsActiveSquad')services.Squad.requestSquadByType=()=>{calls++;return observed({success:false,status:503});};
 else{const search=services.Club.search;services.Club.search=criteria=>{if((criteria.pileSearchType===2)===(stage==='pointsStorageCards')){calls++;return observed({success:false,status:503});}return search(criteria);};}
 const result=await build();assert.equal(result.ok,false);assert.equal(result.status,503);assert.equal(result.stage,stage);assert.equal(calls,3);
 assert.match(result.error,/temporarily unavailable.*503/);assert.match(result.error,/selection was not changed/);assert.deepEqual([...env.ids],[50]);assert.equal(env.refreshes,0);assert.equal(env.submits,0);
});
test('503 retry budget applies to the whole selection, not every club page',async t=>{
 fastBackoff(t);const env=setup();let calls=0;const active=services.Squad.requestSquadByType;
 services.Squad.requestSquadByType=()=>++calls<=2?observed({success:false,status:503}):active();
 let clubCalls=0;services.Club.search=()=>{clubCalls++;return observed({success:false,status:503});};
 const result=await build();assert.equal(result.ok,false);assert.equal(result.stage,'pointsClubCards');assert.equal(calls,3);assert.equal(clubCalls,1);assert.equal(env.refreshes,0);
});
test('authentication, throttling and other EA errors are never retried by the selector',async()=>{
 for(const status of [401,429,512,521]){
  const env=setup();let calls=0;services.Club.search=()=>{calls++;return observed({success:false,status});};
  const result=await build();assert.equal(result.ok,false);assert.equal(result.status,status);assert.equal(calls,1);assert.equal(env.refreshes,0);assert.equal(env.submits,0);
 }
});
test('Stop during 503 backoff cancels before issuing another EA read',async t=>{
 fastBackoff(t);const env=setup();retainSelection(env);let calls=0;
 services.Club.search=()=>{calls++;setTimeout(()=>{window.__futsbcCancelledSbcBuild='run';},5);return observed({success:false,status:503});};
 const result=await build(82,[],{sbcBuildToken:'run'});assert.equal(result.ok,false);assert.match(result.error,/stopped/);assert.equal(calls,1);assert.deepEqual([...env.ids],[50]);assert.equal(env.refreshes,0);
});
test('manual changes during 503 backoff preserve the edit and prevent a retry',async t=>{
 fastBackoff(t);const env=setup();let calls=0;
 services.Club.search=()=>{calls++;setTimeout(()=>retainSelection(env),5);return observed({success:false,status:503});};
 const result=await build();assert.equal(result.ok,false);assert.match(result.error,/selection changed/);assert.equal(calls,1);assert.deepEqual([...env.ids],[50]);assert.equal(env.refreshes,0);
});
test('navigation or challenge progress during backoff prevents retries and staging',async t=>{
 fastBackoff(t);
 for(const change of [env=>env.navigate(),env=>{env.current.workAreaController={};},env=>{env.challenge.submittedScore=100;}]){
  const env=setup();retainSelection(env);let calls=0;
  services.Club.search=()=>{calls++;setTimeout(()=>change(env),5);return observed({success:false,status:503});};
  const result=await build();assert.equal(result.ok,false);assert.match(result.error,/screen or club changed|challenge progress changed/);assert.equal(calls,1);assert.deepEqual([...env.ids],[50]);assert.equal(env.refreshes,0);
 }
});
test('retry waits remain inside the original 90-second deadline',async t=>{
 fastBackoff(t);const env=setup();let elapsed=0,calls=0;const now=Date.now();t.mock.method(Date,'now',()=>now+elapsed);
 services.Club.search=()=>{calls++;elapsed=89950;setTimeout(()=>{elapsed=90000;},5);return observed({success:false,status:503});};
 const result=await build();assert.equal(result.ok,false);assert.match(result.error,/timed out/);assert.equal(calls,1);assert.equal(env.refreshes,0);
});
test('staging errors with status 503 do not replay selection or EA reads',async t=>{
 fastBackoff(t);const env=setup();retainSelection(env);let selections=0,reads=0;const search=services.Club.search;
 services.Club.search=criteria=>{reads++;return search(criteria);};
 env.model.selectItem=item=>{selections++;if(item.id!==50){const error=Error('Selection failed');error.status=503;throw error;}env.ids.add(item.id);return true;};
 const result=await build();assert.equal(result.ok,false);assert.equal(result.status,503);assert.equal(reads,2);assert.equal(selections,2);assert.deepEqual([...env.ids],[50]);assert.equal(env.submits,0);
});
