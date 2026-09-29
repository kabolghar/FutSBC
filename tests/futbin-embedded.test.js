import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFutbin} from '../extension/futbin.js';
import {validatePlan} from '../extension/core.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/futbin-embedded.json',import.meta.url),'utf8'));
const squadURL='https://www.futbin.com/27/squad/100013678/sbc';
const challengeURL='https://www.futbin.com/27/squad-building-challenges/Challenges/46/england-v-spain';
function read(data,link=challengeURL){
 const anchor={href:link,textContent:'England v Spain'};
 globalThis.location=new URL(squadURL);
 globalThis.document={
  querySelectorAll(selector){return selector==='a[href]'?[anchor]:[];},
  querySelector(selector){return selector==='script[data-react-data]'?{textContent:JSON.stringify(data)}:null;}
 };
 return readFutbin(null,squadURL);
}
test('saved FUTBIN page data produces 11 console players and excludes spare player',()=>{
 const plan=read(fixture);
 assert.equal(plan.kind,'squad');
 assert.equal(plan.challengeId,46);
 assert.equal(plan.players.length,11);
 assert.deepEqual(plan.players.map(p=>p.futbinSlot),[1,2,3,4,5,6,7,8,9,10,11]);
 assert.equal(plan.players[0].baseId,188545);
 assert.equal(plan.players[0].rating,84);
 assert.equal(plan.players[0].clubId,693);
 assert.equal(plan.players[0].leagueId,39);
 assert.equal(plan.players[0].nationId,37);
 assert.equal(plan.players[0].attributes,null);
 assert.equal(plan.players[0].price,750);
 assert.equal(plan.players[6].slotPosition,'CB');
 assert.equal(plan.total,4550);
 assert.ok(plan.players.every(p=>p.rarity===0));
 assert.equal(validatePlan(plan),plan);
});
test('embedded identities take priority over rendered card markup',()=>{
 const anchor={href:challengeURL,textContent:'England v Spain'};
 globalThis.location=new URL(squadURL);
 globalThis.document={
  querySelectorAll(selector){return selector==='a[href]'?[anchor]:selector==='.playercard-field[id^="cardlid"]'?[{id:'cardlid1'}]:[];},
  querySelector(selector){return selector==='script[data-react-data]'?{textContent:JSON.stringify(fixture)}:null;}
 };
 const plan=readFutbin(null,squadURL);
 assert.equal(plan.players.length,11);
 assert.equal(plan.players[0].clubId,693);
});
test('reads the six FUTBIN face stats when the embedded squad supplies them',()=>{
 const data=structuredClone(fixture);
 data.squadData.squad[1].playerStats={BasePace:67,BaseShooting:85,BasePassing:79,BaseDribbling:80,BaseDefending:44,BasePhysicality:80};
 assert.deepEqual(read(data).players[0].attributes,[67,85,79,80,44,80]);
});
test('a ten-player SBC with one locked formation slot is complete at 10/10',()=>{
 const data=structuredClone(fixture);
 data.squadData.squad.splice(-4,2);
 data.sbcChallengeRequirementData.requirements=[{type:'futbin.frontenddata.components.SbcRequirement.PlayerCount',value:10,operator:{type:'futbin.frontenddata.components.SbcRequirementOperator.Exactly'}}];
 data.sbcChallengeRequirementData.lockedCardlids=['cardlid11'];
 const plan=read(data);
 assert.equal(plan.kind,'squad');
 assert.equal(plan.requiredPlayers,10);
 assert.equal(plan.players.length,10);
 assert.equal(plan.total,4150);
 assert.equal(validatePlan(plan),plan);
});
test('missing player and missing console price fail closed',()=>{
 const missing=structuredClone(fixture);
 missing.squadData.squad.splice(1,1);
 assert.match(read(missing).error,/Waiting for a player/);
 const unpriced=structuredClone(fixture);
 unpriced.squadData.squad[1].price.ps.price=0;
 assert.match(read(unpriced).error,/console player prices/);
});
test('complete rendered cards recover a squad whose embedded data has only 10 of 11 players',()=>{
 const missing=structuredClone(fixture);
 missing.squadData.squad.splice(-4,2);
 const anchor={href:challengeURL,textContent:'England v Spain'};
 const cards=Array.from({length:11},(_,index)=>{
  const playerCard={getAttribute:()=>`Player ${index+1}`,querySelector:selector=>selector==='.playercard-27-base-img'?{getAttribute:()=>`https://cdn3.futbin.com/players/${1000+index}.png`}:selector==='.playercard-27-bg'?{getAttribute:()=>'/cards/hd/0_gold.png'}:selector==='.playercard-27-rating'?{textContent:'64'}:selector==='.playercard-27-position'?{textContent:'CM'}:null};
  return {id:`cardlid${index+1}`,querySelector:selector=>selector==='.playercard-27'?playerCard:selector==='.platform-ps-only .price-segment'?{textContent:'200'}:selector==='a'?{href:`https://www.futbin.com/27/player/${1000+index}/player`}:null};
 });
 globalThis.location=new URL(squadURL);
 globalThis.document={body:{innerText:'# of players in squad: 11'},querySelectorAll:selector=>selector==='a[href]'||selector==='a'?[anchor]:selector==='.playercard-field[id^="cardlid"]'?cards:[],querySelector:selector=>selector==='script[data-react-data]'?{textContent:JSON.stringify(missing)}:null};
 const plan=readFutbin(null,squadURL);
 assert.equal(plan.kind,'squad');
 assert.equal(plan.players.length,11);
 assert.equal(plan.total,2200);
});
test('rendered ten-player squad ignores its locked eleventh formation tile',()=>{
 const anchor={href:challengeURL,textContent:'England v Spain'};
 const cards=Array.from({length:11},(_,index)=>{
  const playerCard=index===10?null:{getAttribute:()=>`Player ${index+1}`,querySelector:selector=>selector==='.playercard-27-base-img'?{getAttribute:()=>`https://cdn3.futbin.com/players/${1000+index}.png`}:selector==='.playercard-27-bg'?{getAttribute:()=>'/cards/hd/0_gold.png'}:selector==='.playercard-27-rating'?{textContent:'64'}:selector==='.playercard-27-position'?{textContent:'CM'}:null};
  return {id:`cardlid${index+1}`,querySelector:selector=>selector==='.playercard-27'?playerCard:selector==='.platform-ps-only .price-segment'?{textContent:'200'}:selector==='a'?{href:`https://www.futbin.com/27/player/${1000+index}/player`}:null};
 });
 globalThis.location=new URL(squadURL);
 globalThis.document={body:{innerText:'# of players in squad: 10'},querySelectorAll:selector=>selector==='a[href]'||selector==='a'?[anchor]:selector==='.playercard-field[id^="cardlid"]'?cards:[],querySelector:()=>null};
 const plan=readFutbin(null,squadURL);
 assert.equal(plan.kind,'squad');
 assert.equal(plan.requiredPlayers,10);
 assert.equal(plan.players.length,10);
 assert.equal(plan.total,2000);
});
test('requires a challenge breadcrumb before trusting embedded squad',()=>{
 assert.match(read(fixture,'https://www.futbin.com/27/squad/100013678/sbc').error,/matching SBC challenge link/);
});
