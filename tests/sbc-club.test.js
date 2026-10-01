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
 const squad={_players:slots,updateChemistry(){},_calculateRating(){},_updateType(){},getNonBrickSlots(){return this._players;},getFormation:()=>({displayName:'3 CM'}),addItemToSlot:(index,item)=>{slots[index].item=item;},getChemistry(){return this._players.filter(slot=>slot.item.leagueId===1).length*3;},isSBCSquadEligible(){return this._players.every(slot=>!slot.item.concept);}};
 const requirement={};
 const challenge={id:49,name:'Challenge 2',squad,eligibilityRequirements:[requirement],hasExpired:()=>false,isCompleted:()=>false,isRequirementMet(){return valid&&this.squad.getNonBrickSlots().every(slot=>slot.item.definitionId>=10);},meetsRequirements(){return valid&&this.squad.getNonBrickSlots().every(slot=>slot.item.definitionId>=10);}};
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
 const meets=function(){const items=(this?.squad?.getNonBrickSlots()||env.slots).map(s=>s.item),counts=new Map();for(const item of items)counts.set(item.teamId,(counts.get(item.teamId)||0)+1);return items.every(item=>item.isValid?.())&&items.filter(item=>item.leagueId===1).length>=6&&Math.max(...counts.values())<=4;};
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
 env.challenge.meetsRequirements=function(){const rows=this.squad.getNonBrickSlots();return rows.every(slot=>slot.item.definitionId>=10)&&(!requiresOwned||rows.every(slot=>slot.item.owners===1));};
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

 test('search evaluates detached EA slots without redrawing the live squad',async()=>{
 const env=setup({valid:false});let redraws=0,checks=0;
 env.challenge.squad.addItemToSlot=()=>{redraws++;throw Error('Unexpected live redraw');};
 env.challenge.meetsRequirements=function(){checks++;assert.notEqual(this.squad,env.challenge.squad);assert.notEqual(this.squad.getNonBrickSlots()[0],env.slots[0]);return false;};
 const result=await build();assert.equal(result.ok,false);assert(checks>0);assert.equal(redraws,0);assert.equal(env.saves,0);
 });
 test('stop during requirement evaluation interrupts before saving',async()=>{
 const env=setup({valid:false});let scheduled=false;
 env.challenge.meetsRequirements=function(){if(!scheduled){scheduled=true;setTimeout(()=>{window.__futsbcCancelledSbcBuild='cpu-stop';},0);}return false;};
 const before=await eaOperation('status');const result=await eaOperation('sbcClubBuild',{challengeId:49,fingerprint:before.challenge.fingerprint,sbcBuildToken:'cpu-stop'});
 assert.match(result.error,/stopped/);assert.equal(env.saves,0);assert(env.slots.every(slot=>slot.item.id===0));
 });

test('hybrid can solve from an empty club entirely with the cheapest checked market versions',async t=>{
 const env=hybridSetup(t,{balance:2000});env.pool.length=0;
 const cards=[101,102,103,104].map((id,index)=>({...env.good[0],id,assetId:id,definitionId:id,rating:80,concept:false,isPlayer:()=>true,getAuctionData:()=>({buyNowPrice:[200,300,400,900][index],getSecondsRemaining:()=>100,canBuy:()=>true})}));
 services.Item.searchTransferMarket=criteria=>observed({data:{items:cards.filter(item=>item.getAuctionData().buyNowPrice<=criteria.maxBuy)}});
 services.Item.searchConceptItems=criteria=>observed({response:{items:cards.filter(item=>criteria.defId.includes(item.definitionId)).map(item=>({...item,id:0,concept:true})),endOfList:true}});
 const result=await hybridBuild();assert.equal(result.ok,true,result.error);assert.equal(result.total,900);assert(result.players.every(player=>!player.owned));assert.deepEqual(new Set(result.players.map(player=>player.definitionId)),new Set([101,102,103]));assert.equal(env.saves,1);
});
test('hybrid includes high-rated basic club fodder while protecting active squad and unrelated specials',async t=>{
 const env=hybridSetup(t,{balance:2000});env.pool.splice(0,env.pool.length,...env.good.map(item=>({...item,rating:88})),{...env.good[0],id:999,assetId:999,definitionId:999,rating:99,rareflag:3});
 env.challenge.meetsRequirements=function(){return this.squad.getNonBrickSlots().every(slot=>slot.item.rating===88);};env.challenge.isRequirementMet=env.challenge.meetsRequirements;
 const result=await hybridBuild();assert.equal(result.ok,true,result.error);assert.equal(result.total,0);assert(result.players.every(player=>player.owned&&player.rating===88));assert(!result.players.some(player=>player.definitionId===999));
});
test('rating and rarity requirements drive searches beyond 10,000 coins without losing cheaper filler',async t=>{
 const env=hybridSetup(t,{balance:50000});env.pool.length=0;
 globalThis.SBCEligibilityKey={TEAM_RATING:1,PLAYER_RARITY:2};globalThis.SBCEligibilityScope={GREATER:1,LOWER:2,EXACT:3};
 env.challenge.eligibilityRequirements=[{getFirstKey:()=>1,getValue:()=>[84],scope:1},{getFirstKey:()=>2,getValue:()=>[3],count:1,scope:1}];
 const query=[];const cards=[{id:101,rating:80,rareflag:0,price:500},{id:102,rating:84,rareflag:0,price:2000},{id:103,rating:88,rareflag:3,price:35000}].map(card=>({...env.good[0],...card,assetId:card.id,definitionId:card.id,isPlayer:()=>true,getAuctionData:()=>({buyNowPrice:card.price,getSecondsRemaining:()=>100,canBuy:()=>true})}));
 services.Item.searchTransferMarket=criteria=>{query.push({...criteria});return observed({data:{items:cards.filter(item=>item.price<=criteria.maxBuy&&(!criteria.ovrMin||item.rating>=criteria.ovrMin)&&(!criteria.ovrMax||item.rating<=criteria.ovrMax)&&(!criteria.rarities||criteria.rarities.includes(item.rareflag)))}});};
 services.Item.searchConceptItems=criteria=>observed({response:{items:cards.filter(item=>criteria.defId.includes(item.definitionId)).map(item=>({...item,id:0,concept:true})),endOfList:true}});
 env.challenge.meetsRequirements=function(){const items=this.squad.getNonBrickSlots().map(slot=>slot.item);return items.every(item=>item.isValid?.())&&items.reduce((sum,item)=>sum+item.rating,0)>=252&&items.some(item=>item.rareflag===3);};env.challenge.isRequirementMet=env.challenge.meetsRequirements;
 const result=await hybridBuild();assert.equal(result.ok,true,result.error);assert.equal(result.total,37500);assert(query.some(row=>row.maxBuy===50000));assert(query.some(row=>row.rarities?.includes(3)));assert(query.some(row=>row.ovrMin===84));
 delete globalThis.SBCEligibilityKey;delete globalThis.SBCEligibilityScope;
});

test('smooth requirement scoring finds a mixed cheap lineup while a minimum-rating rule is still unmet',async t=>{
 const env=hybridSetup(t,{balance:5000});env.pool.length=0;
 globalThis.SBCEligibilityKey={PLAYER_MIN_OVR:1};globalThis.SBCEligibilityScope={GREATER:1,LOWER:2,EXACT:3};
 env.challenge.eligibilityRequirements=[{getFirstKey:()=>1,getValue:()=>[80],count:2,scope:1}];
 const cards=Array.from({length:33},(_,index)=>({...env.good[0],id:100+index,assetId:100+index,definitionId:100+index,rating:index>=30?80:60,price:index>=30?500:200,isPlayer:()=>true,getAuctionData(){return {buyNowPrice:this.price,getSecondsRemaining:()=>100,canBuy:()=>true};}}));
 services.Item.searchTransferMarket=criteria=>observed({data:{items:cards.filter(item=>item.price<=criteria.maxBuy&&(!criteria.ovrMin||item.rating>=criteria.ovrMin))}});
 services.Item.searchConceptItems=criteria=>observed({response:{items:cards.filter(item=>criteria.defId.includes(item.definitionId)).map(item=>({...item,id:0,concept:true})),endOfList:true}});
 env.challenge.getNumberOfPlayersByOVR=function(){return this.squad.getNonBrickSlots().filter(slot=>slot.item.rating>=80).length;};
 env.challenge.meetsRequirements=function(){return this.squad.getNonBrickSlots().every(slot=>slot.item.isValid?.())&&this.getNumberOfPlayersByOVR()>=2;};env.challenge.isRequirementMet=env.challenge.meetsRequirements;
 const result=await hybridBuild();assert.equal(result.ok,true,result.error);assert.equal(result.total,1200);assert.equal(result.players.filter(player=>player.rating>=80).length,2);
 delete globalThis.SBCEligibilityKey;delete globalThis.SBCEligibilityScope;
});

test('hybrid builds an eleven-player gold chemistry puzzle from club cards without FUTBIN',async t=>{
 const env=hybridSetup(t,{balance:2000});for(let index=3;index<11;index++)env.slots.push({index,generalPositionName:'CM',item:{id:0,definitionId:0,isValid:()=>false}});
 globalThis.SBCEligibilityKey={PLAYER_QUALITY:1,LEAGUE_COUNT:2,NATION_COUNT:3,SAME_LEAGUE_COUNT:4,SAME_NATION_COUNT:5};globalThis.SBCEligibilityScope={GREATER:1,LOWER:2,EXACT:3};globalThis.ItemRatingTier={BRONZE:1,SILVER:2,GOLD:3};
 const rule=(key,value,scope)=>({getFirstKey:()=>key,getValue:()=>[value],scope});
 env.challenge.eligibilityRequirements=[rule(1,3,3),rule(2,3,3),rule(3,2,3),rule(4,6,2),rule(5,6,2)];
 env.pool.splice(0,env.pool.length,...Array.from({length:18},(_,index)=>({...env.good[0],id:100+index,assetId:100+index,definitionId:100+index,rating:index<3?60:80,nationId:index<9?1:2,leagueId:index<9?1:index<14?2:3})));
 const counts=items=>{const result=new Map();for(const id of items)result.set(id,(result.get(id)||0)+1);return result;};
 env.challenge.isRequirementMet=function(rule){const items=this.squad.getNonBrickSlots().map(slot=>slot.item),key=rule.getFirstKey(),value=rule.getValue()[0];if(key===1)return items.every(item=>item.rating>=75);const map=counts(items.map(item=>key===2||key===4?item.leagueId:item.nationId));return key===2||key===3?map.size===value:Math.max(...map.values())<=value;};
 env.challenge.meetsRequirements=function(){return this.eligibilityRequirements.every(rule=>this.isRequirementMet(rule));};
 const result=await hybridBuild();assert.equal(result.ok,true,result.error);assert.equal(result.total,0);assert.equal(result.players.length,11);assert(result.players.every(player=>player.owned&&player.rating>=75));assert.equal(env.challenge.meetsRequirements(),true);
 delete globalThis.SBCEligibilityKey;delete globalThis.SBCEligibilityScope;delete globalThis.ItemRatingTier;
});

test('from-rules hybrid rebuild replaces stale concepts instead of requiring their exact expensive versions',async t=>{
 const env=hybridSetup(t);env.slots[0].item={...env.good[0],id:0,assetId:99999,definitionId:99999,concept:true,rating:90};
 const result=await hybridBuild();assert.equal(result.ok,true,result.error);assert.equal(result.total,200);assert(!result.players.some(player=>player.definitionId===99999));assert.equal(env.saves,1);
});
