import test from 'node:test';import assert from 'node:assert/strict';
import {readFutbinTab} from '../extension/tab-reader.js';
const url='https://www.futbin.com/27/squad/123/sbc';
function mock(results,{status='loading',pageURL=url}={}){
 let calls=0;const focused=[];
 return {get calls(){return calls;},focused,tabs:{get:async()=>({status,url:pageURL}),update:async(id,options)=>focused.push(options)},scripting:{executeScript:async options=>{assert.deepEqual(options.args,[null,url]);const next=results[Math.min(calls++,results.length-1)];if(next instanceof Error)throw next;return [{result:next}];}}};
}
const fast={attempts:3,delay:async()=>{}};
test('reads a rendered squad while Chrome still reports loading',async()=>{const api=mock([{kind:'squad',total:700}]);assert.equal((await readFutbinTab(api,1,url,null,fast)).total,700);assert.equal(api.calls,1);});
test('waits for incomplete DOM and recovers from navigation races',async()=>{const api=mock([Error('Frame removed'),{error:'Waiting for prices'},{kind:'squad'}]);assert.equal((await readFutbinTab(api,1,url,null,fast)).kind,'squad');assert.equal(api.calls,3);});
test('accepts trailing slash normalization',async()=>{const api=mock([{kind:'squad'}],{pageURL:url+'/'});assert.equal((await readFutbinTab(api,1,url,null,fast)).kind,'squad');});
test('does not inject into the wrong page',async()=>{const api=mock([],{pageURL:'https://other.example/27/squad/123/sbc'});await assert.rejects(()=>readFutbinTab(api,1,url,null,fast),/requested FUTBIN address/);assert.equal(api.calls,0);});
test('timeout exposes the actual failure without opening the background page',async()=>{const api=mock([{error:'Waiting for console player prices'}]);await assert.rejects(()=>readFutbinTab(api,1,url,null,fast),/Waiting for console player prices/);assert.deepEqual(api.focused,[]);});
test('a background page can recover without becoming the active tab',async()=>{
 const api=mock([{error:'No cards yet'},{error:'No cards yet'},{kind:'squad',total:4300}]);
 assert.equal((await readFutbinTab(api,1,url,null,fast)).total,4300);
 assert.deepEqual(api.focused,[]);
 assert.equal(api.calls,3);
});
test('an automatic browser check can finish in the inactive FUTBIN tab',async()=>{
 const api=mock([{error:'FUTBIN is checking this browser.',blocked:true,verification:true},{error:'FUTBIN is checking this browser.',blocked:true,verification:true},{kind:'squad',total:2200}]);
 assert.equal((await readFutbinTab(api,1,url,null,fast)).total,2200);
 assert.equal(api.calls,3);
 assert.deepEqual(api.focused,[]);
});
test('a persistent browser check stops without asking for user interaction',async()=>{
 const api=mock([{error:'FUTBIN is checking this browser.',blocked:true,verification:true}]);
 await assert.rejects(()=>readFutbinTab(api,1,url,null,fast),error=>error.verificationBlocked&&/blocked access.*No squad changes.*Try again later/.test(error.message));
 assert.equal(api.calls,3);
 assert.deepEqual(api.focused,[]);
});
test('a persistently incomplete lineup is rejected quickly and remains in the background',async()=>{
 const api=mock([{error:'Waiting for the complete squad (10/11 players loaded).',incompleteSquad:true}]);
 await assert.rejects(()=>readFutbinTab(api,1,url,null,{...fast,partialChecks:3}),error=>error.incompleteSquad&&/10\/11/.test(error.message));
 assert.equal(api.calls,3);
 assert.deepEqual(api.focused,[]);
});


test('normal browser loading can finish beyond the former eight-second cutoff',async()=>{
 const api=mock([...Array(25).fill({verification:true,blocked:true,error:'FUTBIN is checking this browser.'}),{kind:'squad',total:5000}]);
 assert.equal((await readFutbinTab(api,1,url,null,{delay:async()=>{}})).total,5000);
 assert.equal(api.calls,26);
});


test('waits for all completed-table prices instead of returning a half-loaded comparison',async()=>{
 const api=mock([{kind:'comparison',unpricedCount:3},{kind:'comparison',unpricedCount:1},{kind:'comparison',unpricedCount:0,solutions:[{consolePrice:2200}]}]);
 assert.equal((await readFutbinTab(api,1,url,null,fast)).unpricedCount,0);
 assert.equal(api.calls,3);
});
test('never accepts permanently missing comparison prices',async()=>{
 const api=mock([{kind:'comparison',unpricedCount:2}]);
 await assert.rejects(()=>readFutbinTab(api,1,url,null,fast),/console prices for 2 listed squads/);
});
test('slow card hydration is not discarded after five reads',async()=>{
 const api=mock([...Array(15).fill({incompleteSquad:true,error:'10/11 loaded'}),{kind:'squad',total:2200}]);
 assert.equal((await readFutbinTab(api,1,url,null,{delay:async()=>{}})).total,2200);
});
test('EA lookup redirects are read on the same-season group page',async()=>{
 const actual='https://www.futbin.com/27/squad-building-challenge/29';
 const expected='https://www.futbin.com/27/squad-building-challenge/ea/59/Upgrade';
 const api={tabs:{get:async()=>({url:actual})},scripting:{executeScript:async({args})=>{assert.deepEqual(args,[59,actual]);return [{result:{kind:'lookup',url:'https://www.futbin.com/27/squad-building-challenges/Upgrades/59/upgrade'}}];}}};
 assert.equal((await readFutbinTab(api,1,expected,59,fast)).kind,'lookup');
 api.tabs.get=async()=>({url:'https://www.futbin.com/26/squad-building-challenge/29'});
 await assert.rejects(()=>readFutbinTab(api,1,expected,59,fast),/requested FUTBIN address/);
});

test('not-found lookup exits immediately instead of polling for cards',async()=>{
 const api=mock([{pageUnavailable:true,error:'FUTBIN could not find this page.'}]);
 await assert.rejects(()=>readFutbinTab(api,1,url,null,fast),error=>error.pageUnavailable);
 assert.equal(api.calls,1);
});
test('empty documents retry navigation once and then allow directory fallback',async()=>{
 const api=mock([{blankPage:true,error:'FUTBIN returned an empty document.'}]);
 await assert.rejects(()=>readFutbinTab(api,1,url,null,{attempts:20,delay:async()=>{}}),error=>error.pageUnavailable);
 assert.equal(api.focused.length,1);assert.deepEqual(api.focused[0],{url});assert.equal(api.calls,16);
});
