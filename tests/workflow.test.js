import test from 'node:test';
import assert from 'node:assert/strict';

const EA='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
const completed='https://www.futbin.com/27/squad-building-challenges/Challenges/46/england-v-spain';
const squad='https://www.futbin.com/27/squad/100013678/sbc';

test('one build action connects, compares, inserts concepts and unlocks manual shopping',async()=>{
 let listener,tabUpdated,onInstalled,alarmListener,saved={},tradeSaved={},tabURL='',inserted=false,marketStatus=null;
 const clearedAlarms=[];
 const actions=[],futbinReads=[];
 const overlayCalls=[];
 const challenge=()=>({id:46,name:'England v Spain',formation:'5-2-1-2',slots:[{index:0,position:'ST'}],fingerprint:inserted?'after':'before'});
 globalThis.chrome={
  runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:{addListener:fn=>{listener=fn;}},onInstalled:{addListener:fn=>{onInstalled=fn;}}},
  sidePanel:{setPanelBehavior:async()=>{},open:async()=>{}},action:{onClicked:{addListener:()=>{}}},
  storage:{session:{get:async()=>({state:saved}),set:async value=>{saved=value.state;}},local:{get:async()=>({'futsbc-auto-trade-v1':tradeSaved}),set:async value=>{tradeSaved=value['futsbc-auto-trade-v1'];}}},
  alarms:{create:()=>{},clear:async name=>{clearedAlarms.push(name);},onAlarm:{addListener:fn=>{alarmListener=fn;}}},
  tabs:{onUpdated:{addListener:fn=>{tabUpdated=fn;}},query:async()=>[{id:1,url:EA,active:true}],get:async id=>({id,url:id===1?EA:tabURL,status:'complete',active:id===1}),create:async({url})=>{tabURL=url;return {id:2,url};},update:async(id,value)=>{if(id===2&&value.url)tabURL=value.url;return {id,url:id===2?tabURL:EA};},remove:async()=>{}},
  scripting:{executeScript:async({target,func,args})=>{
    if(func.name==='openOverlay'){overlayCalls.push(args[0]);return [{result:undefined}];}
    if(target.tabId===1){
      const action=args[0];actions.push(action);
      if(action==='concepts')inserted=true;
      const order={definitionId:101,tradeId:'99',name:'Player',lastBid:1000,sell:1350,futbinPrice:1500,futbinURL:'https://www.futbin.com/27/player/101/player'};
      const result=action==='tradeAuctionHunt'&&marketStatus==='bid-flow'?{ok:true,balance:99000,bids:[order],checked:1,pages:2,auctions:21,candidates:1}
        :action==='tradeAuctionHunt'&&marketStatus==='uncertain-bid'?{ok:true,balance:99000,bids:[],uncertain:{...order,error:'EA rejected the request (521).',status:521,balanceBeforeBid:100000,balanceAfterBid:99000},checked:1,pages:2,auctions:21,candidates:1}
        :action==='tradeWatchBatch'&&marketStatus==='bid-flow'?{ok:true,balance:99000,updates:[{tradeId:'99',phase:'listed',paid:1000,sell:1350}],watched:1}
        :action==='tradeWatchBatch'&&marketStatus==='won-unlisted'?{ok:true,balance:99000,updates:[{tradeId:'99',phase:'won-unlisted',paid:1000,warning:'Listing rejected'}],watched:1}
        :action==='tradeWatchBatch'&&marketStatus==='watch-only'?{ok:true,balance:99000,updates:[{tradeId:'99',phase:'highest',bid:1000,seconds:60}],watched:1}
        :action==='tradeWatchBatch'&&marketStatus==='watch-521'?{ok:false,error:'EA rejected the request (521).',status:521,stage:'targets-watch'}
        :action==='tradeWatchBatch'&&marketStatus==='watch-resolved'?{ok:true,balance:100000,updates:[{tradeId:'99',phase:'lost'}],watched:1}
        :action==='tradeReview'?{ok:true,phase:'highest',tradeId:'99',bid:1000,balance:99000}
        :action==='tradeAuctionHunt'&&marketStatus?{ok:false,error:`EA rejected the request (${marketStatus}).`,status:marketStatus,stage:'market-search'}
        :action==='tradeStatus'?{ok:true,balance:100000}
        :action==='resolve'?{ok:true,players:args[1].players.map(p=>({...p,definitionId:101})),challenge:challenge()}
        :action==='concepts'?{ok:true,players:args[1].players.map(p=>({...p,owned:false})),challenge:challenge()}
        :{ok:true,challenge:challenge()};
      return [{result}];
    }
    if(func.name==='readFutbinMarket'){futbinReads.push(tabURL);return [{result:marketStatus==='futbin-blocked'?{error:'FUTBIN requires browser verification.',blocked:true}:{kind:'market',url:tabURL,checkedAt:Date.now(),rowCount:1,cards:[{assetId:101,name:'Player',url:'https://www.futbin.com/27/player/101/player',consolePrice:1500,eaAverage:1400,updatedSeconds:20,trend:2,revision:'Normal'}]}}];}
    if(func.name!=='readFutbin')throw Error('Unexpected FUTBIN reader');
    const result=tabURL.includes('/squad-building-challenge/ea/')?{kind:'lookup',url:completed}:tabURL.includes('/squad-building-challenges/')?{kind:'comparison',challengeId:46,solutions:[{url:squad,consolePrice:750,title:'Solution'}]}:{kind:'squad',year:27,market:'console',name:'England v Spain',challengeId:46,players:[{futbinSlot:1,slotPosition:'ST',name:'Player',baseId:188545,rarity:0,rating:84,position:'ST',price:750}],total:750,url:squad,checkedAt:Date.now()};
    return [{result}];
  }}
 };
 await import('../extension/background.js');
 tabUpdated(1,{status:'complete'},{id:1,url:EA});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(overlayCalls,[{initiallyOpen:false,replace:false}]);
 tabUpdated(1,{status:'complete'},{id:1,url:'https://example.com/'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(overlayCalls.length,1);
 onInstalled();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(overlayCalls[1],{initiallyOpen:false,replace:true});
 const send=(type,extra={})=>new Promise(resolve=>listener({type,...extra},{id:'test-extension',url:'chrome-extension://test-extension/panel.html'},resolve));
 const result=await send('build',{mode:'quick'});
 assert.equal(result.ok,true,result.error);
 assert.equal(result.data.inserted,true);
 assert.equal(result.data.approved,true);
 assert.equal(result.data.plan.total,750);
 assert.deepEqual(actions,['status','status','resolve','concepts','status']);
 await new Promise(resolve=>setImmediate(resolve));
 const market=await send('market',{index:0});
 assert.equal(market.ok,true,market.error);
 assert.equal(actions.at(-1),'market');
 await new Promise(resolve=>setImmediate(resolve));
 saved.resolved[0].owned=true;
 const ownedMarket=await send('market',{index:0});
 assert.equal(ownedMarket.ok,false);
 assert.match(ownedMarket.error,/already in your club/);
 assert.equal(actions.filter(action=>action==='market').length,1);
 saved.resolved[0].owned=false;
 await new Promise(resolve=>setImmediate(resolve));
 const sendTrade=(type)=>new Promise(resolve=>listener({type},{id:'test-extension',url:'chrome-extension://test-extension/trade.html'},resolve));
 const futbinCheck=await send('tradeCheckFutbin');
 assert.equal(futbinCheck.ok,true,futbinCheck.error);
 assert.equal(futbinCheck.data.marketEvidence.rows,3);
 assert.equal(actions.filter(action=>action==='tradeAuctionHunt').length,0);
 const started=await send('tradeStart');
 assert.equal(started.ok,true,started.error);
 assert.equal(started.data.enabled,true);
 assert.equal((await send('tradeState')).data.startingBalance,100000);
 await new Promise(resolve=>setImmediate(resolve));
 const stopped=await send('tradeStop');
 assert.equal(stopped.data.enabled,false);
 assert.equal((await sendTrade('tradeState')).data.enabled,false);
 tradeSaved={enabled:false,inFlight:true,status:'Stopping after the current EA request.'};
 const recoveredSearch=await send('tradeState');
 assert.equal(recoveredSearch.data.inFlight,false);
 assert.match(recoveredSearch.data.status,/pending market search did not finish/);
 assert.equal(recoveredSearch.data.recoveryRequired,false);
 tradeSaved={enabled:false,inFlight:true,candidate:{name:'Test card'},status:'Stopping after the current EA request.'};
 const uncertainPurchase=await send('tradeState');
 assert.equal(uncertainPurchase.data.inFlight,false);
 assert.equal(uncertainPurchase.data.recoveryRequired,true);
 assert.match(uncertainPurchase.data.status,/bid outcome is unknown/);
 const blocked=await send('tradeStart');
 assert.equal(blocked.ok,false);
 const reviewed=await send('tradeRecover');
 assert.equal(reviewed.data.recoveryRequired,false);
 assert.equal(reviewed.data.candidate,null);
 tradeSaved={enabled:false,recoveryRequired:true,tabId:1,pendingBid:{name:'Player',tradeId:'99',lastBid:1000},status:'Review'};
 const exactReview=await send('tradeReview');
 assert.equal(exactReview.ok,true,exactReview.error);
 assert.equal(exactReview.data.pendingBid.lastReview.phase,'highest');
 assert.equal(exactReview.data.recoveryRequired,true);
 const monitoring=await send('tradeRecover');
 assert.equal(monitoring.ok,true,monitoring.error);
 assert.equal(monitoring.data.enabled,true);
 assert.equal(monitoring.data.watchOnly,true);
 assert.equal(monitoring.data.activeBids[0].tradeId,'99');
 marketStatus='watch-only';
 const huntsBefore=actions.filter(action=>action==='tradeAuctionHunt').length;
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 const watchedOnly=await send('tradeState');
 assert.equal(watchedOnly.data.enabled,true);
 assert.match(watchedOnly.data.status,/No new auction searches/);
 assert.equal(actions.filter(action=>action==='tradeAuctionHunt').length,huntsBefore);
 marketStatus='watch-521';
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 const retry=await send('tradeState');
 assert.equal(retry.data.enabled,true);
 assert.ok(retry.data.nextAt>Date.now()+59_000);
 assert.match(retry.data.status,/Retrying in 1 minute/);
 marketStatus='watch-resolved';
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 const resolved=await send('tradeState');
 assert.equal(resolved.data.enabled,false);
 assert.equal(resolved.data.watchOnly,false);
 assert.deepEqual(resolved.data.activeBids,[]);
 assert.equal(actions.filter(action=>action==='tradeAuctionHunt').length,huntsBefore);
 tradeSaved={enabled:false,status:'Stopped.'};
 marketStatus='uncertain-bid';
 assert.equal((await send('tradeStart')).ok,true);
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 const uncertainWatch=await send('tradeState');
 assert.equal(uncertainWatch.data.enabled,true);
 assert.equal(uncertainWatch.data.watchOnly,true);
 assert.equal(uncertainWatch.data.recoveryRequired,false);
 assert.equal(uncertainWatch.data.activeBids[0].tradeId,'99');
 assert.match(uncertainWatch.data.status,/EA rejected the request \(521\)/);
 marketStatus='watch-521';
 for(let attempt=1;attempt<=3;attempt++){
   alarmListener({name:'futsbc-auto-trade'});
   await new Promise(resolve=>setImmediate(resolve));
   const watched=await send('tradeState');
   assert.equal(watched.data.watchFailures,attempt);
   assert.equal(watched.data.enabled,attempt<3);
 }
 const needsReview=await send('tradeState');
 assert.equal(needsReview.data.recoveryRequired,true);
 assert.match(needsReview.data.status,/last response 521/);
 assert.equal(actions.filter(action=>action==='tradeAuctionHunt').length,huntsBefore+1);
 tradeSaved={enabled:false,status:'Stopped.'};
 marketStatus=429;
 assert.equal((await send('tradeStart')).ok,true);
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 const rateLimited=await send('tradeState');
 assert.equal(rateLimited.data.enabled,false);
 assert.ok(rateLimited.data.cooldownUntil>Date.now()+29*60_000);
 assert.match(rateLimited.data.status,/limited market requests \(429\)/);
 assert.equal((await send('tradeStart')).ok,false);
 assert.equal((await send('tradeDiagnose')).ok,false);
 tradeSaved={enabled:false,status:'Stopped: EA rejected the request (429).'};
 const migrated=await send('tradeState');
 assert.ok(migrated.data.cooldownUntil>Date.now()+29*60_000);
 tradeSaved={enabled:false,status:'Stopped.'};
 marketStatus='bid-flow';
 assert.equal((await send('tradeStart')).ok,true);
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 const leading=await send('tradeState');
 assert.equal(leading.data.activeBids[0].tradeId,'99');
 assert.equal(leading.data.activeBids[0].lastBid,1000);
 assert.ok(leading.data.nextAt-Date.now()<9000);
 assert.equal(futbinReads.length,12);
 assert.equal(leading.data.marketEvidence.rows,3);
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 const listed=await send('tradeState');
 assert.deepEqual(listed.data.activeBids,[]);
 assert.equal(listed.data.completedTrades,1);
 assert.equal(listed.data.lastTrade.listed,true);
 marketStatus=null;
 tradeSaved={mode:'auction',enabled:true,tabId:1,inFlight:false,activeBids:[],nextBreakAt:Date.now()-1,marketEvidence:{cards:[{assetId:101,name:'Player'}],checkedAt:Date.now()}};
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 const routinePause=await send('tradeState');
 assert.ok(routinePause.data.cooldownUntil>Date.now()+4*60_000);
 assert.match(routinePause.data.status,/Cooling down from new bids/);
 marketStatus=401;
 tradeSaved={mode:'auction',enabled:true,tabId:1,inFlight:false,activeBids:[],nextBreakAt:Date.now()+35*60_000,marketEvidence:{cards:[{assetId:101,name:'Player'}],checkedAt:Date.now()}};
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 const signedOut=await send('tradeState');
 assert.equal(signedOut.data.recoveryRequired,false);
 assert.match(signedOut.data.status,/session expired \(401\)/);
  tradeSaved={enabled:true,tabId:1,inFlight:false,status:'Legacy buy-now scan'};
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match((await send('tradeState')).data.status,/saved trader mode changed/);
 assert.equal((await send('tradeState')).data.enabled,false);
 tradeSaved={mode:'auction',enabled:false,recoveryRequired:true,pendingBid:{name:'Player',tradeId:'99'},activeBids:[{name:'Player',tradeId:'99'}],spent:1000,completedTrades:1,status:'Review'};
 const actionsBeforeReset=actions.length;
 const reset=await send('tradeReset');
 assert.equal(reset.ok,true,reset.error);
 assert.equal(reset.data.enabled,false);
 assert.equal(reset.data.recoveryRequired,false);
 assert.deepEqual(reset.data.activeBids,[]);
 assert.equal(reset.data.pendingBid,undefined);
 assert.equal(reset.data.spent,undefined);
 assert.match(reset.data.status,/Check Transfer Targets and New Items/);
 assert.equal(actions.length,actionsBeforeReset);
 assert.ok(clearedAlarms.includes('futsbc-auto-trade'));
 assert.ok(clearedAlarms.includes('futsbc-stop-watchdog'));
 const pauseUntil=Date.now()+30*60_000;
 tradeSaved={mode:'auction',enabled:false,rateLimitAt:Date.now(),cooldownUntil:pauseUntil,status:'EA limited market requests (429).'};
 const pausedReset=await send('tradeReset');
 assert.equal(pausedReset.ok,true,pausedReset.error);
 assert.equal(pausedReset.data.cooldownUntil,pauseUntil);
 assert.equal((await send('tradeStart')).ok,false);
 tradeSaved={mode:'auction',enabled:true,inFlight:false,activeBids:[{tradeId:'99'}],status:'Monitoring'};
 assert.equal((await send('tradeReset')).data.enabled,false);
 // Recovering a listing must not count the same won card twice.
 marketStatus='won-unlisted';
 tradeSaved={mode:'auction',enabled:true,tabId:1,watchOnly:true,inFlight:false,activeBids:[{tradeId:'99',name:'Player'}],spent:0,completedTrades:0};
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tradeSaved.spent,1000);
 assert.equal(tradeSaved.completedTrades,1);
 assert.equal(tradeSaved.activeBids[0].winAccounted,true);
 assert.equal((await send('tradeRecover')).ok,true);
 marketStatus='bid-flow';
 alarmListener({name:'futsbc-auto-trade'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tradeSaved.spent,1000);
 assert.equal(tradeSaved.completedTrades,1);
 tradeSaved={mode:'auction',enabled:true,inFlight:true,status:'Checking EA'};
 const blockedReset=await send('tradeReset');
 assert.equal(blockedReset.ok,false);
 assert.match(blockedReset.error,/EA request may still be running/);
 assert.equal(tradeSaved.enabled,true);
});
