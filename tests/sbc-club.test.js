import test from 'node:test';
import assert from 'node:assert/strict';
import {eaOperation} from '../extension/ea.js';
import {validatePlan} from '../extension/core.js';
const observed=result=>({observe(owner,fn){queueMicrotask(()=>fn(this,{success:true,...result}));},unobserve(){}});
function setup({valid=true,saveFails=false,empty=false}={}){
 const old=()=>({id:0,definitionId:0,isValid:()=>false});
 const slots=Array.from({length:3},(_,index)=>({index,generalPositionName:'CM',item:old()}));
 const card=(id,extra={})=>({id,assetId:id,definitionId:id,name:`Card ${id}`,rating:60,rareflag:0,leagueId:1,nationId:1,teamId:id,preferredPosition:14,loans:-1,isValid:()=>true,...extra});
 const good=[card(11),card(12),card(13)];
 const protectedCard=card(1,{rating:50});
 const pool=empty?[]:[protectedCard,card(2,{rareflag:3}),card(3,{loans:7}),card(4,{rating:89}),card(5,{concept:true}),...good];
 let saves=0;
 const squad={getNonBrickSlots:()=>slots,getFormation:()=>({displayName:'3 CM'}),addItemToSlot:(index,item)=>{slots[index].item=item;},getChemistry:()=>slots.filter(slot=>slot.item.leagueId===1).length*3,isSBCSquadEligible:()=>slots.every(slot=>!slot.item.concept)};
 const requirement={};
 const challenge={id:49,name:'Challenge 2',squad,eligibilityRequirements:[requirement],hasExpired:()=>false,isCompleted:()=>false,isRequirementMet:()=>valid&&slots.every(slot=>slot.item.definitionId>=10),meetsRequirements:()=>valid&&slots.every(slot=>slot.item.definitionId>=10)};
 globalThis.window={fut_year:'2027'};globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>({_challenge:challenge})})})})});
 globalThis.UTSearchCriteriaDTO=class{};globalThis.SearchType={PLAYER:1};
 globalThis.services={User:{getUser:()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})})})},Squad:{requestSquadByType:type=>{assert.equal(type,'active');return observed({data:{squad:{getPlayers:()=>[{item:protectedCard}]}}});}},Club:{search:()=>observed({response:{items:pool,retrievedAll:true}})},SBC:{saveChallenge:()=>{saves++;return saveFails?{observe(owner,fn){queueMicrotask(()=>fn(this,{success:false,status:500}));},unobserve(){}}:observed({});}}};
 return {slots,good,pool,challenge,get saves(){return saves;}};
}
async function build(){const before=await eaOperation('status');return eaOperation('sbcClubBuild',{challengeId:49,fingerprint:before.challenge.fingerprint});}
test('club fallback uses owned basic cards, excludes protected cards, validates and saves without submitting',async()=>{
 const env=setup();const result=await build();assert.equal(result.ok,true,result.error);assert.equal(env.saves,1);
 assert.deepEqual(new Set(result.players.map(p=>p.ownedId)),new Set([11,12,13]));assert(result.players.every(p=>p.owned&&p.price===0));assert(env.slots.every(slot=>!slot.item.concept));
 validatePlan({source:'club',year:27,market:'console',challengeId:49,players:result.players,total:0,checkedAt:Date.now()});
});
test('failed requirements leave every original slot untouched and never save',async()=>{
 const env=setup({valid:false});const original=env.slots.map(slot=>slot.item);const result=await build();assert.equal(result.ok,false);assert.match(result.error,/bounded search/);assert.deepEqual(env.slots.map(slot=>slot.item),original);assert.equal(env.saves,0);
});
test('insufficient club and a failed save restore the original squad',async()=>{
 let env=setup({empty:true});assert.match((await build()).error,/Not enough eligible/);assert.equal(env.saves,0);
 env=setup({saveFails:true});const original=env.slots.map(slot=>slot.item);assert.equal((await build()).ok,false);assert.deepEqual(env.slots.map(slot=>slot.item),original);assert.equal(env.saves,1);
});
test('existing owned cards remain fixed and missing active-squad protection fails closed',async()=>{
 let env=setup();env.slots[0].item=env.good[1];const existing=env.slots[0].item;assert.equal((await build()).ok,true);assert.equal(env.slots[0].item,existing);
 env=setup();services.Squad.requestSquadByType=()=>observed({data:{}});assert.match((await build()).error,/active squad/);assert.equal(env.saves,0);
});
test('club validation never accepts an unowned or priced card as a no-purchase plan',async()=>{
 setup();const result=await build();const plan={source:'club',year:27,market:'console',challengeId:49,players:result.players,total:0,checkedAt:Date.now()};
 assert.throws(()=>validatePlan({...plan,players:plan.players.map(p=>({...p,owned:false}))}));assert.throws(()=>validatePlan({...plan,players:plan.players.map(p=>({...p,price:150}))}));
});

test('a user edit while the search yields survives cancellation',async()=>{
 const env=setup({valid:false});const manual={...env.good[0],id:99,assetId:99,definitionId:99};let scheduled=false;
 env.challenge.meetsRequirements=()=>{if(!scheduled){scheduled=true;setTimeout(()=>{env.slots[0].item=manual;},0);}return false;};
 const result=await build();assert.equal(result.ok,false);assert.match(result.error,/changed during/);assert.equal(env.slots[0].item,manual);assert.equal(env.saves,0);
});
test('full XI is accepted only after EA confirms chemistry and club constraints',async()=>{
 const env=setup();for(let index=3;index<11;index++)env.slots.push({index,generalPositionName:'CM',item:{id:0,definitionId:0,isValid:()=>false}});
 env.pool.splice(0,env.pool.length,...Array.from({length:22},(_,index)=>({...env.good[0],id:100+index,assetId:100+index,definitionId:100+index,rating:60+(index%3),leagueId:index<11?1:2,teamId:index%4+1})));
 const meets=()=>{const items=env.slots.map(s=>s.item),counts=new Map();for(const item of items)counts.set(item.teamId,(counts.get(item.teamId)||0)+1);return items.every(item=>item.isValid?.())&&items.filter(item=>item.leagueId===1).length>=6&&Math.max(...counts.values())<=4;};
 env.challenge.meetsRequirements=meets;env.challenge.isRequirementMet=meets;
 const result=await build();assert.equal(result.ok,true,result.error);assert.equal(result.players.length,11);assert.equal(meets(),true);assert.equal(env.saves,1);
});

function hybridSetup(t,{balance=1000,rejected=false,requiresOwned=false}={}){
 const env=setup();env.pool.splice(env.pool.indexOf(env.good[2]),1);
 globalThis.GameCurrency={COINS:0};services.User.getUser=()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})}),getCurrency:()=>({amount:balance})});
 const realTimeout=globalThis.setTimeout;t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>realTimeout(fn,ms===1000?0:ms,...args));
 const listing=(id,price)=>({...env.good[0],id:500+id,assetId:id,definitionId:id,owners:1,tradable:true,isPlayer:()=>true,getAuctionData:()=>({buyNowPrice:price,getSecondsRemaining:()=>100,canBuy:()=>true})});
 const listings=[listing(21,650),listing(22,200),listing(22,400),listing(11,150)];
 const concepts=listings.map(item=>({...item,concept:true,id:0,tradable:false,owners:1}));
 env.challenge.meetsRequirements=()=>env.slots.every(slot=>slot.item.definitionId>=10)&&(!requiresOwned||env.slots.every(slot=>slot.item.owners===1));
 env.challenge.isRequirementMet=env.challenge.meetsRequirements;
 services.Item={clearTransferMarketCache(){},searchTransferMarket:criteria=>rejected?{observe(owner,fn){queueMicrotask(()=>fn(this,{success:false,status:429}));},unobserve(){}}:observed({data:{items:listings.filter(item=>item.getAuctionData().buyNowPrice<=criteria.maxBuy)}}),searchConceptItems:criteria=>observed({response:{items:concepts.filter(item=>criteria.defId.includes(item.definitionId)),endOfList:true}})};
 return env;
}
async function hybridBuild(){const before=await eaOperation('status');return eaOperation('sbcHybridBuild',{challengeId:49,fingerprint:before.challenge.fingerprint});}
test('hybrid keeps owned cards and selects the cheaper checked market concept',async t=>{
 const env=hybridSetup(t);const result=await hybridBuild();assert.equal(result.ok,true,result.error);
 assert.equal(result.total,200);assert.equal(result.players.filter(p=>p.owned).length,2);
 const missing=result.players.find(p=>!p.owned);assert.equal(missing.definitionId,22);assert.equal(missing.price,200);
 assert(env.slots.some(slot=>slot.item.concept));assert.equal(env.saves,1);
 validatePlan({source:'hybrid',year:27,market:'console',challengeId:49,total:200,players:result.players,checkedAt:Date.now()});
 assert.throws(()=>validatePlan({source:'hybrid',year:27,market:'console',challengeId:49,total:0,players:result.players.map(p=>({...p,price:0})),checkedAt:Date.now()}));
});
test('hybrid respects balance and does not treat purchased concepts as first-owner cards',async t=>{
 let env=hybridSetup(t,{balance:150});let original=env.slots.map(s=>s.item);let result=await hybridBuild();assert.equal(result.ok,false);assert.equal(env.saves,0);assert.deepEqual(env.slots.map(s=>s.item),original);
 env=hybridSetup(t,{requiresOwned:true});env.good.forEach(item=>{item.owners=1;});original=env.slots.map(s=>s.item);result=await hybridBuild();assert.equal(result.ok,false);assert.equal(env.saves,0);assert.deepEqual(env.slots.map(s=>s.item),original);
});
test('market rejection stops hybrid without saving or changing any cards',async t=>{
 const env=hybridSetup(t,{rejected:true});const original=env.slots.map(s=>s.item);const result=await hybridBuild();assert.equal(result.ok,false);assert.match(result.error,/429/);assert.deepEqual(env.slots.map(s=>s.item),original);assert.equal(env.saves,0);
});

test('hybrid missing concept versions are skipped without individual retry storms',async t=>{
 const env=hybridSetup(t);let calls=0;
 services.Item.searchConceptItems=()=>{calls++;return observed({response:{items:[],endOfList:true}});};
 const result=await hybridBuild();assert.equal(result.ok,false);assert.equal(calls,1);assert.equal(env.saves,0);
});

test('a stopped in-flight club request releases the solver and leaves slots untouched',async()=>{
 const env=setup(),original=env.slots.map(s=>s.item);let subscribed=false;
 services.Club.search=()=>({observe(){subscribed=true;window.__futsbcCancelledSbcBuild='stop-test';},unobserve(){}});
 const before=await eaOperation('status');
 const result=await eaOperation('sbcHybridBuild',{challengeId:49,fingerprint:before.challenge.fingerprint,sbcBuildToken:'stop-test'});
 assert.equal(subscribed,false,'coin balance guard must run before club reads');
 globalThis.GameCurrency={COINS:0};services.User.getUser=()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})}),getCurrency:()=>({amount:1000})});
 delete window.__futsbcCancelledSbcBuild;
 const stopped=await eaOperation('sbcHybridBuild',{challengeId:49,fingerprint:before.challenge.fingerprint,sbcBuildToken:'stop-test'});
 assert.match(stopped.error,/stopped/);assert.equal(subscribed,true);assert.equal(env.saves,0);assert.deepEqual(env.slots.map(s=>s.item),original);
});

test('the solver expires before applying cards when its overall time budget is exhausted',async t=>{
 const env=setup();let elapsed=0;const actualNow=Date.now;
 t.mock.method(Date,'now',()=>actualNow()+elapsed);
 const originalSearch=services.Club.search;services.Club.search=criteria=>{elapsed=120001;return originalSearch(criteria);};
 const result=await build();assert.equal(result.ok,false);assert.match(result.error,/time limit/);assert.equal(env.saves,0);assert(env.slots.every(slot=>slot.item.id===0));
});
