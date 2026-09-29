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
