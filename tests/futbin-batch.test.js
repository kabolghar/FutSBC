import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFutbinSquadBatch} from '../extension/futbin-batch.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/futbin-embedded.json',import.meta.url),'utf8'));
const squadURL='https://www.futbin.com/27/squad/100013678/sbc';
const challengeURL='https://www.futbin.com/27/squad-building-challenges/Challenges/46/england-v-spain';
const setup=data=>{
  globalThis.location=new URL(challengeURL);
  globalThis.DOMParser=class {parseFromString(){return {querySelector:()=>({textContent:JSON.stringify(data)}),querySelectorAll:()=>[{href:challengeURL,getAttribute:()=>challengeURL,textContent:'England v Spain'}]};}};
  globalThis.fetch=async()=>({ok:true,url:squadURL,text:async()=>'<html><script data-react-data></script></html>'});
};

test('same-origin batch read verifies a ten-player locked-slot solution',async()=>{
  const data=structuredClone(fixture);
  data.squadData.squad.splice(-4,2);
  data.sbcChallengeRequirementData.requirements=[{type:'futbin.frontenddata.components.SbcRequirement.PlayerCount',value:10,operator:{type:'futbin.frontenddata.components.SbcRequirementOperator.Exactly'}}];
  setup(data);
  const batch=await readFutbinSquadBatch([squadURL],46);
  assert.equal(batch.kind,'batch');
  assert.equal(batch.results[0].kind,'squad');
  assert.equal(batch.results[0].players.length,10);
  assert.equal(batch.results[0].total,4150);
});

test('same-origin batch rejects an incomplete squad and falls back when the page has no embedded data',async()=>{
  const data=structuredClone(fixture);
  data.squadData.squad.splice(-4,2);
  setup(data);
  assert.equal((await readFutbinSquadBatch([squadURL],46)).results[0].incompleteSquad,true);
  globalThis.DOMParser=class {parseFromString(){return {querySelector:()=>null};}};
  assert.equal((await readFutbinSquadBatch([squadURL],46)).results[0].fallback,true);
});

test('a browser check falls back to ordinary navigation without accepting a squad',async()=>{
  setup(fixture);
  globalThis.fetch=async()=>({ok:true,url:squadURL,text:async()=>'<html><title>Just a moment...</title><body>Checking your browser</body></html>'});
  const result=(await readFutbinSquadBatch([squadURL],46)).results[0];
  assert.equal(result.fallback,true);
  assert.equal(result.verification,true);
  assert.equal(result.kind,undefined);
});


test('a throttled response stops the remaining batch requests',async()=>{
  setup(fixture);
  let calls=0;
  globalThis.fetch=async()=>{calls++;return {ok:false,status:429};};
  const result=await readFutbinSquadBatch([squadURL,squadURL,squadURL],46);
  assert.equal(calls,1);
  assert.equal(result.results.length,3);
  assert.equal(result.results[0].verification,true);
  assert.ok(result.results.every(row=>row.fallback));
});


test('missing static challenge links use rendered fallback, but a different challenge is rejected',async()=>{
 setup(fixture);
 assert.equal((await readFutbinSquadBatch([squadURL],99)).results[0].fallback,undefined);
 globalThis.DOMParser=class {parseFromString(){return {querySelector:()=>({textContent:JSON.stringify(fixture)}),querySelectorAll:()=>[]};}};
 assert.equal((await readFutbinSquadBatch([squadURL],46)).results[0].fallback,true);
});
test('missing static card prices use rendered fallback',async()=>{
 const data=structuredClone(fixture);
 const item=data.squadData.squad.find(item=>item.price);
 item.price.ps.price=null;
 setup(data);
 assert.equal((await readFutbinSquadBatch([squadURL],46)).results[0].fallback,true);
});

test('accessible squad reads overlap at most two requests and preserve input order',async()=>{
  setup(fixture);
  const urls=Array.from({length:5},(_,i)=>`https://www.futbin.com/27/squad/${100013678+i}/sbc`);
  let active=0,peak=0,calls=0;
  globalThis.fetch=async url=>{
    calls++;active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,5));active--;
    return {ok:true,url,text:async()=>'<html><script data-react-data></script></html>'};
  };
  const batch=await readFutbinSquadBatch(urls,46);
  assert.equal(peak,2);assert.equal(calls,5);
  assert.deepEqual(batch.results.map(row=>row.url),urls);
  assert(batch.results.every(row=>row.kind==='squad'));
});

test('overlapped throttle prevents subsequent reads beyond those already in flight',async()=>{
  setup(fixture);
  const urls=Array.from({length:6},(_,i)=>`https://www.futbin.com/27/squad/${100013678+i}/sbc`);
  let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    if(url===urls[1])return {ok:false,status:429};
    if(url===urls[2])await new Promise(resolve=>setTimeout(resolve,5));
    return {ok:true,url,text:async()=>'<html><script data-react-data></script></html>'};
  };
  const batch=await readFutbinSquadBatch(urls,46);
  assert.equal(calls,3);
  assert(batch.results.slice(3).every(row=>row.fallback));
});
