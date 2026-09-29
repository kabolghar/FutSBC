import test from 'node:test';
import assert from 'node:assert/strict';

const EA='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
const player={futbinSlot:1,slotPosition:'ST',baseId:101,rating:80,rarity:0,name:'Starter',position:'ST',definitionId:101,price:500};
const alternate={...player,baseId:202,name:'Cheaper',definitionId:202,price:300};
const plan=(card=player)=>({kind:'squad',year:27,market:'console',challengeId:46,url:'https://www.futbin.com/27/squad/100013678/sbc',name:'SBC',players:[card],total:card.price,checkedAt:Date.now(),mode:'quick'});
let saved={},buySaved={enabled:false},tradeSaved={enabled:false},listener,alarmListener,actions=[],buyOutcome='in-club',quoteFailure=null;
const challenge=(fingerprint='fp')=>({id:46,name:'SBC',formation:'4-3-3',slots:[{index:0,position:'ST'}],fingerprint});
const reset=()=>{saved={tabId:1,plan:plan(),resolved:[{...player}],challenge:challenge(),mapping:[0],approved:true,inserted:true,alternatives:[plan()],listedSolutions:[]};buySaved={enabled:false};tradeSaved={enabled:false};actions=[];buyOutcome='in-club';quoteFailure=null;};
reset();
globalThis.chrome={
 runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:{addListener:fn=>{listener=fn;}},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},
 tabs:{onUpdated:{addListener:()=>{}},get:async()=>({id:1,url:EA}),query:async()=>[{id:1,url:EA,active:true}]},
 alarms:{create:()=>{},clear:async()=>{},onAlarm:{addListener:fn=>{alarmListener=fn;}}},
 storage:{session:{get:async()=>({state:saved}),set:async value=>{saved=value.state;}},local:{get:async key=>({[key]:key==='futsbc-sbc-buy-v1'?buySaved:tradeSaved}),set:async value=>{if(value['futsbc-sbc-buy-v1'])buySaved=value['futsbc-sbc-buy-v1'];if(value['futsbc-auto-trade-v1'])tradeSaved=value['futsbc-auto-trade-v1'];}}},
 scripting:{executeScript:async({target,args})=>{
  assert.equal(target.tabId,1);
  const [action,payload]=args;actions.push(action);
  if(action==='sbcQuote'&&quoteFailure===payload.player.definitionId)return [{result:{ok:false,status:521,error:'EA rejected the request (521).'}}];
  const result=action==='status'?{ok:true,challenge:challenge()}
   :action==='sbcQuote'?{ok:true,phase:'quoted',definitionId:payload.player.definitionId,price:payload.player.definitionId===202?300:500,tradeId:'999',balance:1000}
   :action==='sbcBuyOne'?buyOutcome==='uncertain'?{ok:true,phase:'uncertain',definitionId:payload.player.definitionId,price:500,warning:'EA did not confirm the purchase. Check New Items.'}:{ok:true,phase:'in-club',definitionId:payload.player.definitionId,price:500,balance:500}
   :action==='concepts'?{ok:true,players:payload.players.map(card=>({...card,owned:true})),challenge:challenge('final')}
   :action==='sbcSwapCheck'?{ok:true,valid:true,player:{...payload.player,definitionId:202}}
   :action==='sbcSwapApply'?{ok:true,player:{...payload.player,definitionId:202,owned:false},challenge:challenge('swapped')}
   :{ok:false,error:`Unexpected ${action}`};
  return [{result}];
 }}
};
await import('../extension/background.js');
const send=(type,extra={})=>new Promise(resolve=>listener({type,...extra},{id:'test-extension',url:'chrome-extension://test-extension/panel.html'},resolve));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error('Timed out waiting for SBC workflow.');}

test('reviewed checkout buys one card, moves on, and leaves submission to the user',async()=>{
 reset();
 const prepared=await send('sbcPrepare');
 assert.equal(prepared.ok,true,prepared.error);
 assert.equal(prepared.data.checkout.total,500);
 assert.equal(prepared.data.checkout.quotes.length,1);
 await tick();
 const started=await send('sbcBuyStart');
 assert.equal(started.ok,true,started.error);
 assert.equal(buySaved.maxTotal,500);
 await tick();
 alarmListener({name:'futsbc-sbc-buy'});
 await until(()=>buySaved.index===1);
 assert.equal(buySaved.spent,500);
 assert.equal(saved.resolved[0].owned,true);
 alarmListener({name:'futsbc-sbc-buy'});
 await until(()=>buySaved.done===true);
 assert.equal(buySaved.enabled,false);
 assert.equal(saved.challenge.fingerprint,'final');
 assert.equal(saved.checkout,null);
 assert.equal(actions.filter(action=>action==='sbcBuyOne').length,1);
 assert.equal(actions.includes('submit'),false);
});

test('swap options show a cheaper checked card and apply only the chosen slot',async()=>{
 reset();
 saved.alternatives=[plan(),plan(alternate)];
 await tick();
 const found=await send('swapOptions',{index:0});
 assert.equal(found.ok,true,found.error);
 assert.equal(found.data.swapOptions.options.length,1);
 assert.equal(found.data.swapOptions.options[0].price,300);
 assert.equal(found.data.swapOptions.options[0].player.name,'Cheaper');
 await tick();
 const applied=await send('swapApply',{option:0});
 assert.equal(applied.ok,true,applied.error);
 assert.equal(applied.data.plan.total,300);
 assert.equal(applied.data.resolved[0].definitionId,202);
 assert.equal(applied.data.challenge.fingerprint,'swapped');
  assert.equal(actions.filter(action=>action==='sbcSwapApply').length,1);
});

test('a lower live EA price qualifies even when FUTBIN estimates are equal',async()=>{
 reset();
 saved.alternatives=[plan(),plan({...alternate,price:player.price})];
 await tick();
 const found=await send('swapOptions',{index:0});
 assert.equal(found.ok,true,found.error);
 assert.equal(found.data.swapOptions.currentPrice,500);
 assert.equal(found.data.swapOptions.options.length,1);
 assert.equal(found.data.swapOptions.options[0].price,300);
});

test('an uncertain EA purchase halts without retrying or filling the SBC',async()=>{
 reset();buyOutcome='uncertain';
 assert.equal((await send('sbcPrepare')).ok,true);
 await tick();
 assert.equal((await send('sbcBuyStart')).ok,true);
 await tick();
 alarmListener({name:'futsbc-sbc-buy'});
 await until(()=>buySaved.review===true);
 assert.equal(buySaved.enabled,false);
 assert.equal(buySaved.index,0);
 assert.equal(buySaved.pending.name,'Starter');
 alarmListener({name:'futsbc-sbc-buy'});
 await tick();
 assert.equal(actions.filter(action=>action==='sbcBuyOne').length,1);
 assert.equal(actions.includes('concepts'),false);
});


test('a failed swap price check cannot be reported as no cheaper alternatives',async()=>{
 reset();saved.alternatives=[plan(),plan(alternate)];quoteFailure=202;
 const result=await send('swapOptions',{index:0});
 assert.equal(result.ok,false);
 assert.match(result.error,/Could not verify swap Cheaper.*521/);
 assert.equal(saved.swapOptions,null);
 assert.equal(actions.includes('sbcSwapApply'),false);
});

test('checkout price failures identify the card and never authorize buying',async()=>{
 reset();quoteFailure=101;
 const result=await send('sbcPrepare');
 assert.equal(result.ok,false);
 assert.match(result.error,/Could not price Starter.*1\/1.*521/);
 assert.equal(saved.checkout,null);
 assert.equal(buySaved.enabled,false);
});


test('saved squads can refresh live quotes after FUTBIN prices expire',async()=>{
 reset();
 saved.plan.checkedAt=Date.now()-3600000;
 const original=saved.plan.checkedAt;
 const prepared=await send('sbcPrepare');
 assert.equal(prepared.ok,true,prepared.error);
 assert.equal(prepared.data.checkout.total,500);
 assert.equal(prepared.data.plan.checkedAt,original,'must not pretend old FUTBIN prices are fresh');
 assert.ok(actions.includes('sbcQuote'));
 assert.equal(actions.includes('sbcBuyOne'),false);
});
