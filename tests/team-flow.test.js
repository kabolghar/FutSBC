import test from 'node:test';
import assert from 'node:assert/strict';

test('Team prices only proposed fallback cards and uses FUTBIN estimates without market searches',async()=>{
  const EA='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
  const players=Array.from({length:11},(_,index)=>({index,position:index===0?'GK':index===1?'RB':'CM',name:index<2?'Open position':`Current ${index}`,definitionId:index<2?0:1000+index,assetId:index<2?0:1000+index,rating:index<2?0:82}));
  const session={};let fingerprint='current',rankingGap=false;
  const calls=[];let listener,tabURL='',failQuotes=false,holdQuote=false,releaseQuote,estimates=false,forceLimit=false,partialKnown=false;
  globalThis.fetch=async()=>({ok:true,json:async()=>({prices:{},updated:{}})});
  globalThis.chrome={
    runtime:{id:'team-flow-test',getURL:path=>`chrome-extension://team-flow-test/${path}`,onMessage:{addListener:fn=>{listener=fn;}},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},
    action:{onClicked:{addListener:()=>{}}},sidePanel:{setPanelBehavior:async()=>{},open:async()=>{}},
    storage:{session:{get:async key=>key==='futsbc-team-plan'?session:{state:{}},set:async value=>{Object.assign(session,value);}},local:{get:async()=>({}),set:async()=>{}}},
    alarms:{create:()=>{},clear:async()=>{},onAlarm:{addListener:()=>{}}},
    tabs:{onUpdated:{addListener:()=>{}},query:async()=>[{id:1,url:EA,active:true}],get:async id=>({id,url:id===1?EA:tabURL,status:'complete'}),create:async({url})=>{tabURL=url;return {id:2,url};},update:async(_,value)=>{tabURL=value.url;return {id:2,url:tabURL};},remove:async()=>{}},
    scripting:{executeScript:async({target,func,args=[]})=>{
      if(func.name==='openOverlay')return [{result:undefined}];
      if(target.tabId===2&&func.name==='readFutbinTeamPlayers')return [{result:estimates?{kind:'team-players',checkedAt:Date.now(),cards:[{assetId:200,rating:85,name:'Estimate GK',url:'https://www.futbin.com/27/player/200/gk',price:1000,futbinRating:90,revision:'Normal',positions:['GK']},{assetId:300,rating:85,name:'Estimate RB',url:'https://www.futbin.com/27/player/300/rb',price:1200,futbinRating:90,revision:'Normal',positions:['RB']}]}:{blocked:true,error:'Browser verification'}}];
      if(target.tabId===2&&func.name==='readFutggBest'){
        const position=tabURL.includes('/gk/')?'GK':'RB';
        if(rankingGap&&position==='GK')return [{result:{error:'Unavailable ranking'}}];
        return [{result:{kind:'futgg-best',url:tabURL,checkedAt:Date.now(),cards:Array.from({length:30},(_,i)=>({assetId:(position==='GK'?200:300)+i,definitionId:(position==='GK'?200:300)+i,rating:85-Math.floor(i/5),name:`${position} ${i}`,url:`https://www.fut.gg/players/${(position==='GK'?200:300)+i}-card/27-${(position==='GK'?200:300)+i}/`,metaRank:i+1,source:'FUT.GG'}))}}];
      }
      if(target.tabId!==1)throw Error(`Unexpected tab ${target.tabId}`);
      const [action,payload]=args;calls.push({action,payload});
      if(action==='teamSnapshot')return [{result:{ok:true,players,balance:50000,chemistry:10,fingerprint,formation:'4-4-2',name:'Current XI'}}];
      if(action==='teamEvaluate')return [{result:{ok:true,checked:payload.cards.length,options:payload.cards.map(card=>({...card,slotIndex:payload.slotIndex,position:players[payload.slotIndex].position,owned:false,price:card.price??null,estimatedPrice:card.price??null,priceVerified:false,chemistryChange:-1,slotChemistryChange:-1}))}}];
      if(action==='teamApply'){assert(payload.groups.every(group=>group.allowRetained===false&&group.options.length===1));assert.equal(payload.minimumChemistry,12);return [{result:{ok:true,applied:2,chemistry:12}}];}
      if(action==='teamQuote'&&holdQuote){holdQuote=false;await new Promise(resolve=>{releaseQuote=resolve;});}
      if(action==='teamQuote')return [{result:failQuotes?{ok:false,error:'EA rejected the request (429).',status:429}:{ok:true,checkedAt:Date.now(),balance:50000,quotes:payload.definitionIds.map(id=>({definitionId:id,price:1000+id,listingCount:3}))}}];
      if(action==='teamPlan'){
        if(Number.isInteger(payload.alternativesForSlot)){
          assert(payload.groups.every(group=>group.allowRetained===false));
          const target=payload.groups.find(group=>group.slotIndex===payload.alternativesForSlot);
          return [{result:{ok:true,alternatives:target.options.map(card=>({chemistry:12,cost:2000,remaining:payload.budget-2000,choices:payload.groups.map(group=>({...group.options[0],...(group===target?card:{}),slotIndex:group.slotIndex}))})),combinationsChecked:target.options.length}}];
        }
        if(forceLimit&&!payload.groups.some(group=>group.options.some(card=>card.pricePending)))return [{result:{ok:true,plan:null,reason:'No known fit'}}];
        if(payload.groups.some(group=>!group.options.length))return [{result:{ok:true,plan:null,reason:'Missing position data'}}];
        assert.equal(payload.groups.length,2);
        assert(payload.groups.every(group=>group.options.length>0),'known-only planning retains the affordable candidates');
        assert(payload.groups.every(group=>group.options.every(option=>option.priceVerified&&option.price>0)));
        assert(payload.budget<=50000);
        return [{result:{ok:true,plan:{cost:3000,chemistry:12,remaining:47000,choices:payload.groups.map(group=>forceLimit?(group.options.find(card=>card.pricePending)||group.options[0]):group.options[0]).slice(0,partialKnown&&payload.groups.every(group=>group.options.length===1)?1:2)},combinationsChecked:4}}];
      }
      throw Error(`Unexpected EA action ${action}`);
    }}
  };
  await import('../extension/background.js?team-flow');
  const result=await new Promise(resolve=>listener({type:'teamRecommend',slots:[0,1],budget:50000},{id:'team-flow-test',url:'chrome-extension://team-flow-test/panel.html'},resolve));
  assert.equal(result.ok,true,result.error);
  assert.equal(result.data.plan.chemistry,12);
  assert.equal(result.data.results.length,2);
  assert.equal(result.data.cardsPriced,2);
  assert(calls.filter(call=>call.action==='teamPlan').some(call=>call.payload.groups.every(group=>group.options.length===1&&!group.options[0].pricePending)),'return a priced plan before chasing more unknown cards');
  assert.equal(result.data.results.flatMap(group=>group.options).filter(option=>option.priceVerified).length,2);
  assert.equal(calls.filter(call=>call.action==='teamQuote').flatMap(call=>call.payload.definitionIds).length,2);
  await new Promise(resolve=>setImmediate(resolve));
  const cached=await new Promise(resolve=>listener({type:'teamRecommend',slots:[0,1],budget:50000},{id:'team-flow-test',url:'chrome-extension://team-flow-test/panel.html'},resolve));
  assert.equal(cached.ok,true,cached.error);
  assert.equal(calls.filter(call=>call.action==='teamQuote').length,2,'retry reuses checked prices for same squad and budget');
  partialKnown=true;
  const allPositions=await new Promise(resolve=>listener({type:'teamRecommend',slots:[0,1],budget:50000},{id:'team-flow-test',url:'chrome-extension://team-flow-test/panel.html'},resolve));
  assert.equal(allPositions.data.plan.choices.length,2,'a known partial plan must not stop the search for all selected positions');
  partialKnown=false;
  failQuotes=true;
  const before=calls.filter(call=>call.action==='teamPlan').length;
  const limited=await new Promise(resolve=>listener({type:'teamRecommend',slots:[0,1],budget:49000},{id:'team-flow-test',url:'chrome-extension://team-flow-test/panel.html'},resolve));
  assert.equal(limited.ok,false);
  assert.match(limited.error,/Could not price the proposed lineup/);
  assert(calls.filter(call=>call.action==='teamPlan').length>=before);
  failQuotes=false;holdQuote=true;
  const send=(type,extra={})=>new Promise(resolve=>listener({type,planId:session['futsbc-team-plan']?.planId,...extra},{id:'team-flow-test',url:'chrome-extension://team-flow-test/panel.html'},resolve));
  const running=send('teamRecommend',{slots:[0,1],budget:48000});
  for(let attempt=0;attempt<100&&!releaseQuote;attempt++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof releaseQuote,'function');
  const progress=await send('teamRunState');assert.match(progress.data.status,/Pricing proposed lineup/);
  assert.equal((await send('teamCancel')).ok,true);
  releaseQuote();
  const stopped=await running;assert.equal(stopped.ok,false);assert.match(stopped.error,/stopped/);
  assert.equal((await send('teamRunState')).data.running,false);
  assert(calls.filter(call=>call.action==='teamPlan').length>=before);

  forceLimit=true;
  const countBeforeLimit=calls.filter(call=>call.action==='teamQuote').length;
  const incomplete=await send('teamRecommend',{slots:[0,1],budget:47000});
  assert.equal(incomplete.ok,true,incomplete.error);
  assert.equal(incomplete.data.pricingIncomplete,true);
  assert.equal(incomplete.data.plan,null,'never return optimistic prices when coverage is incomplete');
  assert.match(incomplete.data.planReason,/does not mean your budget is too low/);
  assert.equal(calls.filter(call=>call.action==='teamQuote').length-countBeforeLimit,24);
  forceLimit=false;
  const resumed=await send('teamRecommend',{slots:[0,1],budget:47000});
  assert.equal(resumed.ok,true,resumed.error);
  assert.equal(resumed.data.cardsPriced,0,'reuse saved quotes on continuation');
  estimates=true;
  await import('../extension/background.js?team-estimates');
  const priceCalls=calls.filter(call=>call.action==='teamQuote').length;
  const estimated=await send('teamRecommend',{slots:[0,1],budget:50000});
  assert.equal(estimated.ok,true,estimated.error);
  assert.equal(estimated.data.priceMode,'estimate');
  assert.equal(estimated.data.cardsPriced,0);
  assert.equal(calls.filter(call=>call.action==='teamQuote').length,priceCalls);
  assert(estimated.data.plan.choices.every(card=>card.priceEstimated&&!card.pricePending));
  estimates=false;
  globalThis.fetch=async url=>{if(url.endsWith('/players'))return {ok:true,text:async()=>'<title>EA FC 27 Players</title>'};const ids=new URL(url).searchParams.get('ids').split(',').map(Number);return {ok:true,json:async()=>({prices:Object.fromEntries(ids.map(id=>[id,1000])),updated:Object.fromEntries(ids.map(id=>[id,Math.floor(Date.now()/1000)])),extinct:[]})};};
  await import('../extension/background.js?team-alternative-prices');
  const liveBefore=calls.filter(call=>call.action==='teamQuote').length;
  const alternative=await send('teamRecommend',{slots:[0,1],budget:50000});
  assert.equal(alternative.ok,true,alternative.error);
  assert.equal(alternative.data.priceMode,'estimate');
  assert.equal(calls.filter(call=>call.action==='teamQuote').length,liveBefore,'batch estimates avoid all live price checks');
  assert(alternative.data.plan.choices.every(card=>card.priceSource==='fodder.gg'&&card.priceUpdatedAt));
  const oldPanel=await send('teamAlternatives',{slotIndex:0,planId:'outdated'});assert.equal(oldPanel.ok,false);assert.match(oldPanel.error,/another panel/);
  const suggestions=await send('teamAlternatives',{slotIndex:0});
  assert.equal(suggestions.ok,true,suggestions.error);
  assert(suggestions.data.alternatives.length>0);
  const originalRB=alternative.data.plan.choices.find(card=>card.slotIndex===1).definitionId;
  const newCard=suggestions.data.alternatives[0].card;
  const swapped=await send('teamSwap',{slotIndex:0,definitionId:newCard.definitionId,price:1,budget:9999999});
  assert.equal(swapped.ok,true,swapped.error);
  assert.equal(swapped.data.plan.choices.find(card=>card.slotIndex===0).price,1000,'UI price overrides are ignored');
  assert.equal(swapped.data.plan.choices.find(card=>card.slotIndex===1).definitionId,originalRB);
  const unknown=await send('teamSwap',{slotIndex:0,definitionId:999999});assert.equal(unknown.ok,false);
  fingerprint='different';
  const staleSwap=await send('teamAlternatives',{slotIndex:0});assert.equal(staleSwap.ok,false);assert.match(staleSwap.error,/squad changed/);
  fingerprint='current';
  const applyResult=await send('teamApply');assert.equal(applyResult.ok,true,applyResult.error);assert.equal(applyResult.data.applied,true);
  const doubleApply=await send('teamApply');assert.equal(doubleApply.ok,false);
  session['futsbc-team-plan'].checkedAt=Date.now()-11*60_000;
  const expiredSwap=await send('teamAlternatives',{slotIndex:0});assert.equal(expiredSwap.ok,false);assert.match(expiredSwap.error,/expired/);
  rankingGap=true;
  await import('../extension/background.js?team-partial-source');
  const partialSource=await send('teamRecommend',{slots:[0,1],budget:50000});
  assert.equal(partialSource.ok,true,partialSource.error);
  assert.equal(partialSource.data.results[0].options.length,0);
  assert.equal(partialSource.data.results[1].options.length,30,'one failed ranking page must not discard other positions');
});
