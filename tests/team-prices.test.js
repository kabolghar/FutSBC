import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConsolePrices,getConsoleEstimates} from '../extension/team-prices.js';
const now=1790687000000;
const quote={definitionId:1,price:1000,source:'fodder.gg',updatedAt:now-1000,fetchedAt:now-1000};
test('accepts only requested exact cards with recent console prices, not ranges or extinct cards',()=>{
 const data={prices:{1:1000,2:1200,3:900,4:950,5:1000,6:0,7:2000,8:1000},updated:{1:now/1000,2:now/1000,3:now/1000-22000,4:now/1000+600,5:now/1000,6:now/1000,7:now/1000},ranges:{5:[150,500]},extinct:[2]};
 assert.deepEqual(parseConsolePrices(data,[1,2,3,4,5,6,8],now).map(q=>q.definitionId),[1]);
});
test('batches ten cards per request, explicitly selects console and records provenance',async()=>{
 const calls=[];
 const result=await getConsoleEstimates(Array.from({length:25},(_,i)=>i+1),{},async url=>{
  if(url.endsWith('/players'))return {ok:true,text:async()=>'<title>EA FC 27 Players</title>'};
  calls.push(url);const u=new URL(url),ids=u.searchParams.get('ids').split(',');
  assert.equal(u.searchParams.get('platform'),'console');assert(ids.length<=10);
  return {ok:true,json:async()=>({prices:Object.fromEntries(ids.map(id=>[id,900])),updated:Object.fromEntries(ids.map(id=>[id,now/1000]))})};
 },now);
 assert.equal(calls.length,3);assert.equal(result.quotes.length,25);
});
test('fresh cache avoids requests; provider failure preserves recent estimates but not expired ones',async()=>{
 let calls=0;const failure=async()=>{calls++;throw Error('offline');};
 assert.equal((await getConsoleEstimates([1],{1:quote},failure,now)).quotes.length,1);assert.equal(calls,0);
 const result=await getConsoleEstimates([1,2],{1:{...quote,fetchedAt:now-700000},2:{...quote,definitionId:2,updatedAt:now-22000000}},failure,now);
 assert.equal(result.unavailable,true);assert.deepEqual(result.quotes.map(q=>q.definitionId),[1]);
});
test('a malformed response preserves cache; an explicit missing price removes it',async()=>{
 const cached={1:{...quote,fetchedAt:now-700000}};
 const bad=await getConsoleEstimates([1],cached,async url=>url.endsWith('/players')?{ok:true,text:async()=>'<title>EA FC 27 Players</title>'}:{ok:true,json:async()=>({})},now);
 assert.equal(bad.quotes.length,1);assert.equal(bad.unavailable,true);
 const empty=await getConsoleEstimates([1],cached,async url=>url.endsWith('/players')?{ok:true,text:async()=>'<title>EA FC 27 Players</title>'}:{ok:true,json:async()=>({prices:{},updated:{}})},now);
 assert.equal(empty.quotes.length,0);assert.deepEqual(empty.cache,{});
});

test('rejects prices when the provider switches to a different season',async()=>{
 const result=await getConsoleEstimates([1],{},async()=>({ok:true,text:async()=>'<title>EA FC 28 Players</title>'}),now);
 assert.equal(result.unavailable,true);assert.deepEqual(result.quotes,[]);
});

test('a provider verification page uses recent cache without attempting price requests',async()=>{
 let calls=0;
 const result=await getConsoleEstimates([1],{1:{...quote,fetchedAt:now-700000}},async()=>{calls++;return {ok:true,text:async()=>'<title>Just a moment...</title>'};},now);
 assert.equal(calls,1);assert.equal(result.unavailable,true);assert.equal(result.quotes[0].price,1000);
});
