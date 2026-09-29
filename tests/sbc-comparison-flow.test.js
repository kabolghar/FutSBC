import test from 'node:test';
import assert from 'node:assert/strict';

test('SBC build checks all listed squads in reused inactive tabs and closes them on success or failure',async()=>{
  const EA='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
  const listing='https://www.futbin.com/27/squad-building-challenges/Upgrades/28/2x-79-upgrade';
  const urls=[1,2,3].map(id=>`https://www.futbin.com/27/squad/${1000+id}/sbc`);
  const tabs=new Map([[1,{id:1,url:EA,active:true}]]);
  const created=[],closed=[],actions=[],squadReads=[];
  let nextTabId=2,listener,session={},inserted=false,blocked=false,unmatchable=false,lookupMissing=false,directoryMissing=false;
  const players=()=>Array.from({length:10},(_,index)=>({futbinSlot:index+1,slotPosition:'CM',name:`Player ${index+1}`,baseId:1000+index,rarity:0,rating:64,position:'CM',price:200}));
  const plan=(url,price)=>({kind:'squad',year:27,market:'console',name:'2x 79+ Upgrade',challengeId:28,requiredPlayers:10,players:players().map((player,index)=>({...player,baseId:index===0?2000+Number(url.match(/(\d+)\/sbc$/)[1])%100:player.baseId,price:index===0?price-1800:200})),total:price,url,checkedAt:Date.now()});
  const challenge=()=>({id:28,name:'2x 79+ Upgrade',formation:'4-4-2',slots:Array.from({length:10},(_,index)=>({index,position:'CM'})),fingerprint:inserted?'after':'before'});
  globalThis.chrome={
    runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:{addListener:fn=>{listener=fn;}}},
    storage:{session:{get:async()=>({state:session}),set:async value=>{session=value.state;}},local:{get:async()=>({}),set:async()=>{}}},
    alarms:{create:()=>{},clear:async()=>{},onAlarm:{addListener:()=>{}}},
    tabs:{onUpdated:{addListener:()=>{}},query:async()=>[tabs.get(1)],get:async id=>tabs.get(id),create:async options=>{assert.equal(options.active,false);const tab={id:nextTabId++,url:options.url,active:false};tabs.set(tab.id,tab);created.push(tab.id);return tab;},update:async(id,options)=>{assert.equal(options.active,undefined,'FUTBIN must not take focus');Object.assign(tabs.get(id),options);return tabs.get(id);},remove:async id=>{closed.push(id);tabs.delete(id);}},
    scripting:{executeScript:async({target,func,args})=>{
      if(target.tabId===1){
        const action=args[0];actions.push(action);
        if(action==='sbcClubBuild'){inserted=true;return [{result:{ok:true,challenge:challenge(),checks:12,players:players().map((p,index)=>({...p,owned:true,ownedId:index+1,definitionId:p.baseId,price:0,slotIndex:index}))}}];}
        if(action==='concepts')inserted=true;
        const result=action==='resolve'&&unmatchable&&args[1].players[0].price===100?{ok:false,error:'Could not uniquely match Player 1 (64): 0 distinct EA cards found. No squad changes were made.',unmatchedPlayer:args[1].players[0]}:action==='resolve'?{ok:true,players:args[1].players.map((player,index)=>({...player,definitionId:2000+index})),challenge:challenge()}:action==='concepts'?{ok:true,players:args[1].players.map(player=>({...player,owned:false})),challenge:challenge()}:{ok:true,challenge:challenge()};
        return [{result}];
      }
      if(func.name==='readFutbinSquadBatch'){
        squadReads.push(...args[0]);
        const result={kind:'batch',results:args[0].map(url=>url===urls[0]?blocked?{url,fallback:true,verification:true,error:'FUTBIN is checking this browser.'}:{url,incompleteSquad:true,error:'FUTBIN has 9/10 required players.'}:url===urls[1]?plan(url,2000):plan(url,1900))};
        return [{result}];
      }
      if(func.name==='readSbcDirectory')return [{result:{kind:'discovery',completed:directoryMissing?[]:[{id:28,url:listing}],groups:[],pages:[]}}];
      assert.equal(func.name,'readFutbin');
      const url=tabs.get(target.tabId).url;
      const result=url.includes('/squad-building-challenge/ea/')?lookupMissing?{pageUnavailable:true,error:'FUTBIN could not find this page.'}:{kind:'lookup',url:listing}:url.includes('/squad-building-challenges/')?{kind:'comparison',challengeId:28,solutions:urls.map((item,index)=>({url:item,consolePrice:1700+index*100})),rowCount:3,unpricedCount:0}:url===urls[0]?blocked?{error:'FUTBIN is checking this browser.',blocked:true,verification:true}:{error:'Waiting for the complete squad (9/10 players loaded).',incompleteSquad:true}:url===urls[1]?plan(url,2000):plan(url,1900);
      return [{result}];
    }}
  };
  await import('../extension/background.js');
  const send=(type,extra={})=>new Promise(resolve=>listener({type,...extra},{id:'test-extension',url:'chrome-extension://test-extension/panel.html'},resolve));
  const built=await send('build');
  assert.equal(built.ok,true,built.error);
  assert.equal(built.data.plan.total,1900);
  assert.equal(built.data.plan.attemptedCount,3);
  assert.equal(built.data.plan.recheckedCount,2);
  assert.equal(built.data.plan.incompleteCount,1);
  assert.deepEqual(built.data.incompleteSolutions,[urls[0]]);
  assert.equal(actions.filter(action=>action==='concepts').length,1);
  assert.equal(created.length,1,'fast path uses one temporary FUTBIN tab');
  assert.deepEqual(new Set(closed),new Set(created));
  assert.equal(tabs.size,1);
  await new Promise(resolve=>setImmediate(resolve));
  blocked=true;
  const failed=await send('compare');
  assert.equal(failed.ok,false);
  assert.match(failed.error,/could not verify every listed squad/);
  assert.match(failed.error,/blocked access.*No squad changes were made/);
  assert.equal(actions.filter(action=>action==='concepts').length,1);
  assert.equal(session.plan.total,1900,'failed comparison preserves the saved squad');
  assert.equal(session.approved,true,'failed comparison preserves manual shopping');
  assert.equal(session.comparisonCheckpoint.entries.length,2);
  const readsBeforeRetry=squadReads.length;
  assert.deepEqual(new Set(closed),new Set(created));
  assert.equal(tabs.size,1);
  await new Promise(resolve=>setImmediate(resolve));
  blocked=false;unmatchable=true;inserted=false;lookupMissing=true;
  const recovered=await send('build');
  assert.equal(recovered.ok,true,recovered.error+' (directory recovery)');
  assert.deepEqual(squadReads.slice(readsBeforeRetry),[urls[0]],'retry reads only the unresolved squad');
  assert.equal(session.comparisonCheckpoint,null);
  assert.equal(recovered.data.plan.total,2000);
  assert.equal(recovered.data.plan.eaSkippedCount,1);
  assert.equal(actions.filter(action=>action==='concepts').length,2);
  directoryMissing=true;inserted=false;
  const club=await send('build');
  assert.equal(club.ok,true,club.error);assert.equal(club.data.plan.source,'club');
  assert.equal(club.data.plan.total,0);assert.equal(club.data.approved,true);
  assert.equal(actions.filter(action=>action==='sbcClubBuild').length,1);
  assert.equal(tabs.size,1,'unavailable FUTBIN worker is closed before club fallback');
  const beforeDirect=created.length;
  const direct=await send('clubBuild');assert.equal(direct.ok,true,direct.error);
  assert.equal(created.length,beforeDirect,'direct club build skips FUTBIN completely');

});
