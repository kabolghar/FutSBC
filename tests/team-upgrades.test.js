import test from 'node:test';
import assert from 'node:assert/strict';
import {rankTeamUpgrades} from '../extension/team-upgrades.js';
import {readFutbinPlayerSignal} from '../extension/futbin-player.js';
import {eaOperation} from '../extension/ea.js';

test('meta fit leads after chemistry is preserved, and weak cards are excluded',()=>{
  const options=[
    {assetId:1,rating:84,futbinRating:82,price:10000,trend:3,chemistryChange:1,slotChemistryChange:1},
    {assetId:2,rating:90,futbinRating:91,price:10000,trend:2,chemistryChange:0,slotChemistryChange:0},
    {assetId:3,rating:99,futbinRating:99,price:500,trend:10,chemistryChange:-1,slotChemistryChange:0},
    {assetId:4,rating:54,futbinRating:54,price:200,trend:0,chemistryChange:3,slotChemistryChange:3}
  ];
  const ranked=rankTeamUpgrades(options,{1:{positive:90,negative:10,games:100000},2:{positive:10,negative:90,games:1000}});
  assert.deepEqual(ranked.map(option=>option.assetId),[2,1]);
  assert.equal(ranked[1].approval,90);
});

test('meta ranking is independent of overall rating and gender',()=>{
  const base={source:'FUT.GG',price:1000,estimatedPrice:1000,chemistryChange:0,slotChemistryChange:0};
  const ranked=rankTeamUpgrades([{...base,assetId:1,rating:91,gender:'female',metaRank:20},{...base,assetId:2,rating:81,gender:'male',metaRank:2}]);
  assert.equal(ranked[0].assetId,2);
  const opposite=rankTeamUpgrades([{...base,assetId:1,rating:91,gender:'male',metaRank:20},{...base,assetId:2,rating:81,gender:'female',metaRank:2}]);
  assert.deepEqual(opposite.map(card=>card.score),ranked.map(card=>card.score));
  const tied=rankTeamUpgrades([{...base,assetId:1,rating:91,metaRank:2},{...base,assetId:2,rating:81,metaRank:2}]);
  assert.equal(tied[0].score,tied[1].score,'overall rating is not a gameplay performance bonus');
});

test('club ownership labels a FUTBIN candidate without boosting its rank',()=>{
  const common={rating:84,futbinRating:86,estimatedPrice:10000,chemistryChange:0,slotChemistryChange:0};
  const [first,second]=rankTeamUpgrades([{...common,assetId:1,price:0,owned:true},{...common,assetId:2,price:10000,owned:false}]);
  assert.equal(first.score,second.score);
});

test('FUT.GG meta rank can drive the fallback without inventing a price',()=>{
  const options=[{assetId:1,source:'FUT.GG',metaRank:2,rating:85,price:null,chemistryChange:0,slotChemistryChange:0},{assetId:2,source:'FUT.GG',metaRank:20,rating:86,price:null,chemistryChange:0,slotChemistryChange:0}];
  assert.deepEqual(rankTeamUpgrades(options).map(option=>option.assetId),[1,2]);
});

test('FUTBIN player signal reads only a matching FC 27 page and explicit votes',()=>{
  globalThis.location={href:'https://www.futbin.com/27/player/74/luis-diaz'};
  globalThis.document={title:'Luis Díaz EA FC 27',body:{innerText:'used in 186,548 games\n108\n107\nVotes'}};
  const result=readFutbinPlayerSignal(location.href);
  assert.equal(result.positive,108);assert.equal(result.negative,107);assert.equal(result.games,186548);
  assert.match(readFutbinPlayerSignal('https://www.futbin.com/27/player/75/another').error,/Waiting/);
});

test('EA evaluates exact concept chemistry without changing the active squad',async()=>{
  const original={id:100,definitionId:1,rating:70,isValid:()=>true,getStaticData:()=>({firstName:'Ada',lastName:'Example'})};
  const other={id:101,definitionId:2,rating:72,name:'Partner',isValid:()=>true};
  const slots=[{index:0,generalPositionName:'ST',item:original,chemistry:3},{index:1,generalPositionName:'ST',item:other,chemistry:3},...Array.from({length:9},(_,i)=>({index:i+2,generalPositionName:'CM',item:i===0?{id:0,definitionId:0,isValid:()=>false}:{id:102+i,definitionId:3+i,rating:70,name:`Other ${i}`,isValid:()=>true},chemistry:i===0?0:3}))];
  const team={getId:()=>5,getName:()=> 'First XI',getFormation:()=>({displayName:'4-4-2'}),getChemistry:()=>33,getPlayers:()=>slots,getManager:()=>({item:null})};
  const concept={assetId:20,definitionId:20,rating:80,name:'Upgrade',concept:true,basePossiblePositions:[25]};
  const wrongPosition={assetId:21,definitionId:21,rating:90,name:'Wrong',concept:true,basePossiblePositions:[0]};
  const noChem={assetId:22,definitionId:22,rating:83,name:'No chem',concept:true,basePossiblePositions:[25]};
  const openPosition={assetId:23,definitionId:23,rating:81,name:'New CM',concept:true,basePossiblePositions:[14]};
  const ownedConcept={assetId:24,definitionId:24,rating:82,name:'Club striker',concept:true,basePossiblePositions:[25],preferredPosition:25};
  const owned={id:500,assetId:24,definitionId:24,rating:82,name:'Club striker',concept:false,basePossiblePositions:[25],preferredPosition:25,isPlayer:()=>true,isValid:()=>true};
  const observed=data=>({observe(owner,callback){queueMicrotask(()=>callback(this,{success:true,response:{items:data}}));},unobserve(){}});
  globalThis.window={fut_year:'2027'};globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>({_squad:team})})})})});
  globalThis.GameCurrency={COINS:1};globalThis.SearchType={PLAYER:1};globalThis.UTSearchCriteriaDTO=class{};
  globalThis.repositories={Squad:{getSquadById:()=>null},TeamConfig:{}};
  globalThis.services={User:{getUser:()=>({selectedPersona:{},getSelectedPersona:()=>({getCurrentClub:()=>({isPlaystation:true})}),getCurrency:()=>({amount:20000})})},Squad:{getActiveSquadId:()=>5},Chemistry:{},Item:{searchConceptItems:()=>observed([concept,wrongPosition,noChem,openPosition,ownedConcept])},Club:{search:()=>observed([owned])}};
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){const id=items[0].definitionId;return {chemistry:id===22?32:33,getSlotChemistry:()=>({points:id===22?2:3})};}};
  const snapshot=await eaOperation('teamSnapshot');
  assert.equal(snapshot.players.length,11);assert.equal(snapshot.balance,20000);
  assert.equal(snapshot.players[0].name,'Ada Example');
  assert.equal(snapshot.players[2].name,'Open position');
  assert.equal(snapshot.players[0].itemId,100);
  slots[0].item={...concept,id:0,isValid:()=>false};
  const pinnedSnapshot=await eaOperation('teamSnapshot');
  assert.equal(pinnedSnapshot.players[0].name,'Upgrade');
  assert.equal(pinnedSnapshot.players[0].definitionId,20);
  assert.equal(pinnedSnapshot.players[0].concept,true);
  assert.notEqual(pinnedSnapshot.fingerprint,snapshot.fingerprint);
  const pinned=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:pinnedSnapshot.fingerprint,budget:20000,allowChemistryDrop:true,cards:[{...pinnedSnapshot.players[0],source:'User',price:null}]});
  assert.equal(pinned.options.length,1);assert.equal(pinned.options[0].definitionId,20);assert.equal(pinned.options[0].owned,false);
  const pinnedGroups=[{slotIndex:0,allowRetained:false,options:[{...pinned.options[0],locked:true,price:1200,priceVerified:true}]},{slotIndex:2,allowRetained:false,options:[{assetId:23,definitionId:23,rating:81,name:'CM',price:700,priceVerified:true}]}];
  assert.equal((await eaOperation('teamPlan',{fingerprint:pinnedSnapshot.fingerprint,budget:1800,groups:pinnedGroups})).plan,null,'pinned concept cost counts against the whole budget');
  const withPinned=await eaOperation('teamPlan',{fingerprint:pinnedSnapshot.fingerprint,budget:2000,groups:pinnedGroups});
  assert.equal(withPinned.plan.cost,1900);assert.equal(withPinned.plan.choices.find(card=>card.slotIndex===0).definitionId,20);
  const fakePinned=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:pinnedSnapshot.fingerprint,budget:20000,allowChemistryDrop:true,cards:[{...pinnedSnapshot.players[0],definitionId:24,assetId:24,rating:82,source:'User'}]});
  assert.equal(fakePinned.options.length,0,'a user pick must match the exact concept already in that slot');
  slots[0].item={...ownedConcept,id:0};
  const clubPinSnapshot=await eaOperation('teamSnapshot');
  const clubPin=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:clubPinSnapshot.fingerprint,budget:0,allowChemistryDrop:true,cards:[{...clubPinSnapshot.players[0],source:'User',price:null}]});
  assert.equal(clubPin.options[0].owned,true);assert.equal(clubPin.options[0].price,0);
  slots[0].item=original;

  const cards=[20,21,22].map(assetId=>({assetId,name:`Player ${assetId}`,url:`https://www.futbin.com/27/player/${assetId}/player`,price:10000,rating:{20:80,21:90,22:83}[assetId],futbinRating:82}));
  const conceptSearch=services.Item.searchConceptItems,clubSearch=services.Club.search;
  let conceptCalls=0,clubCalls=0;
  const unauthorized=()=>({observe(owner,callback){queueMicrotask(()=>callback(this,{success:false,status:'401'}));},unobserve(){}});
  services.Item.searchConceptItems=()=>{conceptCalls++;return unauthorized();};
  services.Club.search=()=>{clubCalls++;return clubSearch();};
  const expired=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:12000,cards});
  assert.equal(expired.ok,false);assert.equal(Number(expired.status),401);
  assert.equal(expired.stage,'team-concept-search');assert.match(expired.error,/Reload the EA Web App/);
  assert.equal(conceptCalls,1,'authentication failures must not retry concept requests');
  assert.equal(clubCalls,0,'authentication failures stop before further EA calls');
  assert.equal(slots[0].item,original,'authentication failure must not change the squad');
  services.Item.searchConceptItems=conceptSearch;
  services.Club.search=()=>unauthorized();
  const clubExpired=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:12000,cards});
  assert.equal(clubExpired.stage,'team-club-search');assert.equal(Number(clubExpired.status),401);
  services.Club.search=clubSearch;
  let cancelledCalls=0;
  services.Item.searchConceptItems=()=>({observe(owner,callback){cancelledCalls++;queueMicrotask(()=>{window.__futsbcCancelledTeamRead='cancel-test';callback(this,{success:true,response:{items:[concept]}});});},unobserve(){}});
  const stoppedRead=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:12000,cards:Array.from({length:25},()=>cards[0]),readToken:'cancel-test'});
  assert.equal(stoppedRead.ok,false);assert.match(stoppedRead.error,/stopped/);
  assert.equal(cancelledCalls,1,'stop between EA responses instead of processing the rest of the batches');
  assert.equal(slots[0].item,original);
  delete window.__futsbcCancelledTeamRead;services.Item.searchConceptItems=conceptSearch;
  const result=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:12000,cards});
  assert.deepEqual(result.options.map(option=>option.assetId),[20]);
  const empty=await eaOperation('teamEvaluate',{slotIndex:2,fingerprint:snapshot.fingerprint,budget:12000,cards:[{assetId:23,name:'New CM',url:'https://www.futbin.com/27/player/23/new-cm',price:10000,rating:81,futbinRating:84}]});
  assert.deepEqual(empty.options.map(option=>option.assetId),[23]);
  const ownedFit=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:0,cards:[{assetId:24,name:'Club striker',url:'https://www.futbin.com/27/player/24/club-striker',price:10000,rating:82,futbinRating:85}]});
  assert.deepEqual(ownedFit.options.map(option=>option.ownedId),[500]);
  assert.equal(ownedFit.options[0].price,0);
  assert.equal(ownedFit.options[0].estimatedPrice,10000);
  const fallback=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:0,cards:[{assetId:20,definitionId:20,name:'Upgrade',url:'https://www.fut.gg/players/20-upgrade/27-20/',price:null,rating:80,source:'FUT.GG',metaRank:1}]});
  assert.equal(fallback.options[0].price,null);
  assert.equal(fallback.options[0].priceVerified,false);
  assert.equal(fallback.screening.chemistryKept,1);
  const deepRank=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:1000,cards:[{assetId:20,definitionId:20,name:'Upgrade',price:null,rating:80,source:'FUT.GG',metaRank:65}]});
  assert.equal(deepRank.options[0].metaRank,65,'verified deeper ranks must reach EA chemistry checks');
  const omittedPrice=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:0,cards:[{assetId:20,definitionId:20,name:'Upgrade',url:'https://www.fut.gg/players/20-upgrade/27-20/',rating:80,source:'FUT.GG',metaRank:1}]});
  assert.equal(omittedPrice.screening.valid,1);
  assert.equal(omittedPrice.options[0].price,null);
  assert.equal(omittedPrice.options[0].priceVerified,false);
  const encodedDefinition=0x3000014;
  const variant={assetId:encodedDefinition,definitionId:encodedDefinition,rating:85,name:'Variant',concept:true,possiblePositions:[25]};
  const queries=[];
  globalThis.services.Item.searchConceptItems=criteria=>{queries.push(criteria.defId);return observed(criteria.defId.includes(20)?[variant]:[]);};
  const recovered=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:0,cards:[{assetId:20,definitionId:encodedDefinition,name:'Variant',url:'https://www.fut.gg/players/20-variant/27-50331668/',price:null,rating:85,source:'FUT.GG',metaRank:1}]});
  assert.equal(recovered.options[0].definitionId,encodedDefinition);
  assert.deepEqual(queries,[[encodedDefinition],[20]]);
  const variantPlan=await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:1000,groups:[{slotIndex:0,options:[{...recovered.options[0],price:1000,priceVerified:true}]}]});
  assert.equal(variantPlan.plan?.choices[0].definitionId,encodedDefinition,'final planning must recover the same exact variant as evaluation');
  globalThis.services.Item.searchConceptItems=()=>observed([concept,openPosition]);
  const planned=await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups:[
    {slotIndex:0,options:[{...result.options[0],price:10000,priceVerified:true}]},
    {slotIndex:2,options:[{...empty.options[0],price:8000,priceVerified:true}]}
  ]});
  assert.equal(planned.plan.cost,18000);
  assert.equal(planned.plan.chemistry,33);
  assert.equal(planned.plan.slotChemistry[1],3);
  assert.equal(Object.keys(planned.plan.slotChemistry).length,11);
  assert.deepEqual(planned.plan.choices.map(choice=>choice.slotIndex),[0,2]);
  const overBudget=await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:17000,groups:[
    {slotIndex:0,options:[{...result.options[0],price:10000,priceVerified:true}]},
    {slotIndex:2,options:[{...empty.options[0],price:8000,priceVerified:true}]}
  ]});
  assert.equal(overBudget.plan.cost,8000);
  assert.deepEqual(overBudget.plan.choices.map(choice=>choice.slotIndex),[2], 'keep the selected striker when only the midfield upgrade fits');
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){
    const changed=[items[0].definitionId===20,items[2].definitionId===23];
    return {chemistry:changed.every(Boolean)?34:changed.some(Boolean)?32:33,getSlotChemistry:()=>({points:3})};
  }};
  const soloDrop=await eaOperation('teamEvaluate',{slotIndex:0,fingerprint:snapshot.fingerprint,budget:18000,allowChemistryDrop:true,cards:[cards[0]]});
  assert.equal(soloDrop.options[0].chemistryChange,-1);
  const paired=await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups:[
    {slotIndex:0,options:[{...soloDrop.options[0],price:10000,priceVerified:true}]},
    {slotIndex:2,options:[{...empty.options[0],price:8000,priceVerified:true}]}
  ]});
  assert.equal(paired.plan.chemistry,34);

  globalThis.services.Item.searchConceptItems=()=>observed([concept,noChem,openPosition]);
  const groups=[{slotIndex:0,options:[{...result.options[0],price:1000,priceVerified:true,source:'FUT.GG',metaRank:30},{...result.options[0],assetId:22,definitionId:22,rating:83,price:1000,priceVerified:true,source:'FUT.GG',metaRank:1}]},{slotIndex:2,options:[{...empty.options[0],price:1000,priceVerified:true}]}];
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){return {chemistry:items[0].definitionId===1?10:13,getSlotChemistry:()=>({points:2})};}};
  const weak=await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups});
  assert.equal(weak.plan,null,'13/33 must not be presented as meeting the target');
  assert.equal(weak.progressPlan.chemistry,13);
  assert.equal(weak.progressPlan.baselineChemistry,10);
  assert.equal(weak.progressPlan.targetChemistry,30);
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){return {chemistry:items[0].definitionId===20?33:items[0].definitionId===22?30:10,getSlotChemistry:()=>({points:3})};}};
  const chemistryFirst=await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups});
  assert.equal(chemistryFirst.plan.chemistry,33);
  assert.equal(chemistryFirst.plan.choices[0].definitionId,20,'higher chemistry beats a stronger source rank');
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){return {chemistry:items[0].definitionId===1?10:33,getSlotChemistry:index=>({points:index===0&&items[0].definitionId!==1?0:3})};}};
  assert.equal((await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups})).plan,null,'no new zero-chemistry cards');
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){return {chemistry:items[0].definitionId===1?10:33,getSlotChemistry:index=>({points:index===1&&items[0].definitionId!==1?2:3})};}};
  assert.equal((await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups})).plan,null,'retained player chemistry must not drop');
  assert.equal((await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups})).progressPlan,null,'partial steps also preserve retained player chemistry');
  globalThis.UTSquadChemCalculatorUtils=class{calculate(){return {chemistry:31,getSlotChemistry:index=>({points:index===1?1:3})};}};
  const keepsLowChem=await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups});
  assert.equal(keepsLowChem.plan.chemistry,31,'an unchanged one-chemistry player must not block chemistry-preserving upgrades elsewhere');
  assert.equal(keepsLowChem.plan.slotChemistry[1],1);
  const mixed=groups.map(group=>({...group,options:group.options.map(card=>card.definitionId===22?{...card,source:'FUTBIN',futbinRating:99,metaRank:null}:card)}));
  const metaFirst=await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups:mixed});
  assert.equal(metaFirst.plan.choices.find(card=>card.slotIndex===0).definitionId,20,'do not compare FUTBIN numeric ratings with invented GG rank scores');
  // Five affordable replacements must beat one star taking the whole budget.
  for(let index=0;index<5;index++){slots[index].generalPositionName='ST';if(index===2)slots[index].item={id:902,definitionId:902,assetId:902,rating:80,isValid:()=>true};}
  const fiveCards=Array.from({length:5},(_,index)=>({concept:true,assetId:40+index,definitionId:40+index,rating:84,preferredPosition:25}));
  const star={concept:true,assetId:99,definitionId:99,rating:90,preferredPosition:25};
  globalThis.services.Item.searchConceptItems=()=>observed([...fiveCards,star]);
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){const boosted=items.some(item=>item?.definitionId===99);return {chemistry:boosted?33:31,getSlotChemistry:index=>({points:index===10&&!boosted?1:3})};}};
  const fiveSnapshot=await eaOperation('teamSnapshot');
  const fiveGroups=fiveCards.map((card,index)=>({slotIndex:index,options:[{...card,name:'Budget card',source:'FUT.GG',metaRank:25,price:2000,priceVerified:true},...(index===0?[{...star,name:'Star',source:'FUT.GG',metaRank:1,price:10000,priceVerified:true}]:[])]}));
  const balanced=await eaOperation('teamPlan',{fingerprint:fiveSnapshot.fingerprint,budget:10000,groups:fiveGroups});
  assert.equal(balanced.plan.choices.length,5);
  assert.equal(balanced.plan.cost,10000);
  assert.equal(balanced.plan.chemistry,31);
  assert.equal(balanced.plan.selectedCount,5);
  assert.deepEqual(balanced.plan.unfilledSlots,[]);
  // Swapping locks the other four suggestions and cannot retain the old card silently.
  const swapGroups=fiveGroups.map(group=>({...group,allowRetained:false}));
  const alternatives=await eaOperation('teamPlan',{fingerprint:fiveSnapshot.fingerprint,budget:18000,groups:swapGroups,alternativesForSlot:0});
  assert.equal(alternatives.alternatives.length,2);
  assert(alternatives.alternatives.every(plan=>plan.choices.length===5));
  assert(alternatives.alternatives.every(plan=>plan.choices.slice(1).map(card=>card.definitionId).join(',')==='41,42,43,44'));
  const constrained=await eaOperation('teamPlan',{fingerprint:fiveSnapshot.fingerprint,budget:10000,groups:swapGroups,alternativesForSlot:0});
  assert.deepEqual(constrained.alternatives.map(plan=>plan.choices[0].definitionId),[40]);
  const invalidSwap=await eaOperation('teamPlan',{fingerprint:fiveSnapshot.fingerprint,budget:1000,groups:swapGroups,alternativesForSlot:0});
  assert.equal(invalidSwap.plan,null);
  assert.deepEqual(invalidSwap.alternatives,[]);
  assert(invalidSwap.rejections.overBudget>0);
  assert.equal(invalidSwap.rejections.totalChemistry,0,'budget failure is not a chemistry failure');
  const stale=await eaOperation('teamPlan',{fingerprint:'stale',budget:18000,groups:swapGroups,alternativesForSlot:0});
  assert.equal(stale.ok,false);
  assert.match(stale.error,/squad changed/);
  assert.equal(slots[0].item,original);
  let saves=0;const unchanged=slots[5].item;
  team.addItemToSlot=(index,item)=>{slots.find(slot=>slot.index===index).item=item;};
  team.save=()=>{saves++;return observed([]);};
  const applyPayload={fingerprint:fiveSnapshot.fingerprint,budget:10000,minimumChemistry:31,groups:fiveGroups.map(group=>({...group,allowRetained:false,options:group.options.slice(0,1)}))};
  const badApply=await eaOperation('teamApply',{...applyPayload,minimumChemistry:33});
  assert.equal(badApply.ok,false);assert.equal(saves,0);assert.equal(slots[0].item,original);
  const beforeApply=slots.map(slot=>slot.item);
  team.save=()=>({observe(owner,callback){queueMicrotask(()=>callback(this,{success:false,status:500}));},unobserve(){}});
  const failedSave=await eaOperation('teamApply',applyPayload);
  assert.equal(failedSave.ok,false);assert.equal(failedSave.stage,'team-apply-save');
  assert.deepEqual(slots.map(slot=>slot.item),beforeApply,'restore the local lineup after a rejected save');
  team.save=()=>{saves++;return observed([]);};
  const applied=await eaOperation('teamApply',applyPayload);
  assert.equal(applied.ok,true,applied.error);assert.equal(applied.applied,5);assert.equal(saves,1);
  assert(slots.slice(0,5).every(slot=>slot.item.concept));assert.equal(slots[5].item,unchanged);
  for(let index=0;index<slots.length;index++)slots[index].item=beforeApply[index];
  const newlyOwned={...fiveCards[0],id:8000,concept:false,isValid:()=>true};
  const alreadyOwned={...fiveCards[1],id:8001,concept:false,isValid:()=>true};
  const wrongVersion={...fiveCards[2],id:8002,rating:83,concept:false,isValid:()=>true};
  services.Club.search=()=>observed([newlyOwned,alreadyOwned,wrongVersion]);
  const mixedPayload={...applyPayload,groups:applyPayload.groups.map((group,index)=>index===1?{...group,options:group.options.map(card=>({...card,owned:true,ownedId:8001,price:0}))}:group)};
  const mixedApplied=await eaOperation('teamApply',mixedPayload);
  assert.equal(mixedApplied.ok,true,mixedApplied.error);
  assert.equal(slots[0].item,newlyOwned,'use cards acquired since the recommendation was built');
  assert.equal(slots[1].item,alreadyOwned,'insert the actual owned instance, not its concept');
  assert(slots.slice(2,5).every(slot=>slot.item.concept),'wrong-rating copies do not replace the selected version');
  assert.equal(mixedApplied.owned,2);assert.equal(mixedApplied.plan.cost,6000);
  assert.equal(mixedApplied.plan.choices[0].ownedId,8000);
  for(let index=0;index<slots.length;index++)slots[index].item=beforeApply[index];
  services.Club.search=()=>observed([]);
  const saveCount=saves;
  const disappeared=await eaOperation('teamApply',mixedPayload);
  assert.equal(disappeared.ok,false);assert.match(disappeared.error,/no longer available/);
  assert.deepEqual(slots.map(slot=>slot.item),beforeApply);assert.equal(saves,saveCount);
  services.Club.search=()=>({observe(owner,callback){queueMicrotask(()=>callback(this,{success:false,status:401}));},unobserve(){}});
  const clubFailure=await eaOperation('teamApply',applyPayload);
  assert.equal(clubFailure.status,401);assert.equal(clubFailure.stage,'team-apply-club');
  assert.deepEqual(slots.map(slot=>slot.item),beforeApply);assert.equal(saves,saveCount);
  services.Club.search=()=>observed([]);
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){const replaced=items[0].definitionId!==1;return {chemistry:replaced?23:31,getSlotChemistry:index=>({points:replaced?(index===0?0:2):3})};}};
  const strict=await eaOperation('teamPlan',{...applyPayload,alternativesForSlot:0});
  assert.equal(strict.alternatives.length,0,'initial automatic planning keeps its chemistry protections');
  const tradeoff=await eaOperation('teamPlan',{...applyPayload,alternativesForSlot:0,allowChemistryTradeoff:true});
  assert.equal(tradeoff.alternatives[0].chemistry,23);
  assert.equal(tradeoff.alternatives[0].choices[0].slotChemistry,0,'show even zero-chemistry swaps for an informed choice');
  assert.equal((await eaOperation('teamPlan',{...applyPayload,budget:1,alternativesForSlot:0,allowChemistryTradeoff:true})).alternatives.length,0,'chemistry tradeoffs cannot bypass the budget');
  const chosenTradeoff=await eaOperation('teamApply',{...applyPayload,minimumChemistry:23,allowChemistryTradeoff:true});
  assert.equal(chosenTradeoff.ok,true,chosenTradeoff.error);assert.equal(chosenTradeoff.chemistry,23);


});

test('market price ceiling rounds down to an EA price step without exceeding balance',async()=>{
  const slot={index:0,item:{definitionId:1,id:1}};
  const team={getPlayers:()=>Array.from({length:11},(_,i)=>({...slot,index:i})),getFormation:()=>({})};
  globalThis.window={fut_year:'2027'};
  globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>({_squad:team})})})})});
  globalThis.GameCurrency={COINS:1};globalThis.SearchType={PLAYER:1};globalThis.UTSearchCriteriaDTO=class{};
  globalThis.services={User:{getUser:()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})}),getCurrency:()=>({amount:38243})})},Item:{clearTransferMarketCache(){},searchTransferMarket(criteria){assert.equal(criteria.maxBuy,38000);return {observe(owner,callback){queueMicrotask(()=>callback(this,{success:true,data:{items:[]}}));},unobserve(){}};}}};
  const snapshot=await eaOperation('teamSnapshot');
  const result=await eaOperation('teamQuote',{fingerprint:snapshot.fingerprint,definitionIds:[212831],maxPrice:38243});
  assert.equal(result.ok,true,result.error);
  assert.equal(result.quotes[0].price,null);
});
