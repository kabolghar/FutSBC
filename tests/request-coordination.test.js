import test from 'node:test';
import assert from 'node:assert/strict';

test('slow artwork does not block actions or clear their progress, and the lock releases before replying',async()=>{
  let listener,finishArt;
  const saved={state:{progress:'Comparing squads'}};
  globalThis.chrome={
    runtime:{id:'coord',getURL:path=>`chrome-extension://coord/${path}`,onMessage:{addListener:fn=>listener=fn}},
    tabs:{},alarms:{onAlarm:{addListener:()=>{}},clear:async()=>{}},
    storage:{local:{get:async()=>({})},session:{get:async key=>({[key]:saved[key]}),set:async value=>Object.assign(saved,value)}}
  };
  globalThis.fetch=()=>new Promise(resolve=>{finishArt=()=>resolve({ok:false,status:503});});
  await import('../extension/background.js?coord');
  const send=type=>new Promise(resolve=>listener({type,assetId:212831,definitionId:212831},{id:'coord',url:'chrome-extension://coord/panel.html'},resolve));
  const art=send('cardArt');
  await new Promise(resolve=>setImmediate(resolve));
  const first=await send('reset');assert.equal(first.ok,true);
  const second=await send('reset');assert.equal(second.ok,true,'immediate next action must not see a stale lock');
  saved.state={progress:'Matching current squad'};
  finishArt();assert.equal((await art).ok,false);
  assert.equal(saved.state.progress,'Matching current squad');
});
