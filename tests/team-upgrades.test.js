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
  const cards=[20,21,22].map(assetId=>({assetId,name:`Player ${assetId}`,url:`https://www.futbin.com/27/player/${assetId}/player`,price:10000,rating:{20:80,21:90,22:83}[assetId],futbinRating:82}));
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
  assert.equal(overBudget.plan,null);
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
  assert.equal(weak.plan,null,'13/33 must not be recommended just because the empty squad started lower');
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){return {chemistry:items[0].definitionId===20?33:items[0].definitionId===22?30:10,getSlotChemistry:()=>({points:3})};}};
  const chemistryFirst=await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups});
  assert.equal(chemistryFirst.plan.chemistry,33);
  assert.equal(chemistryFirst.plan.choices[0].definitionId,20,'higher chemistry beats a stronger source rank');
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){return {chemistry:items[0].definitionId===1?10:33,getSlotChemistry:index=>({points:index===0&&items[0].definitionId!==1?0:3})};}};
  assert.equal((await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups})).plan,null,'no new zero-chemistry cards');
  globalThis.UTSquadChemCalculatorUtils=class{calculate(_,items){return {chemistry:items[0].definitionId===1?10:33,getSlotChemistry:index=>({points:index===1&&items[0].definitionId!==1?2:3})};}};
  assert.equal((await eaOperation('teamPlan',{fingerprint:snapshot.fingerprint,budget:18000,groups})).plan,null,'retained player chemistry must not drop');
  assert.equal(slots[0].item,original);
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
