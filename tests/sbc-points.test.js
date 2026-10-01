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
 globalThis.window={fut_year:'2027'};globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>({workAreaController:controller})})})})});
 globalThis.UTSearchCriteriaDTO=class{};globalThis.PileSearchType={CLUB:1,STORAGE:2};globalThis.OneClickSBCWorkAreaTab={CLUB:1,STORAGE:2};
 globalThis.services={User:{getUser:()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})})})},Squad:{requestSquadByType:()=>observed({data:{squad:{getPlayers:()=>[{item:{id:999}}]}}})},Club:{search:criteria=>{assert.equal(criteria.sbcChallengeId,7);assert.equal(criteria.isFavorite,false);return observed({response:{items:criteria.pileSearchType===1?rows:[],retrievedAll:true}});}},SBC:{isItemInSquad:id=>id===999,submit:()=>submits++}};
 return {card,challenge,model,rows,ids,get refreshes(){return refreshes;},get submits(){return submits;}};
}
async function build(maxRating=82,excludedDefinitionIds=[]){const status=await eaOperation('status');assert.equal(status.challenge.kind,'points');return eaOperation('sbcPointsBuild',{fingerprint:status.challenge.fingerprint,maxRating,excludedDefinitionIds});}
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
