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
