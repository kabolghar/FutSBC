import test from 'node:test';
import assert from 'node:assert/strict';
import {coins,rankSolutions,validatePlan,validateMapping,futbinURL,suggestMapping} from '../extension/core.js';
const plan=()=>({year:27,market:'console',challengeId:59,checkedAt:Date.now(),url:'https://www.futbin.com/27/squad/123/sbc',total:700,players:[{baseId:236703,rating:83,rarity:0,price:700,name:'Raum'}]});
test('price formats and unknown prices',()=>{assert.equal(coins('11,250'),11250);assert.equal(coins('3.9K'),3900);for(const input of ['—','','0','-5','100 coins','NaN'])assert.equal(coins(input),null);});
test('ranking ignores missing console prices and never uses PC',()=>{assert.deepEqual(rankSolutions([{url:'b',consolePrice:800,pcPrice:1},{url:'a',consolePrice:700,pcPrice:999},{url:'c',consolePrice:null}]).map(s=>s.url),['a','b']);});
test('reject stale, future, duplicate, malformed and wrong-market squads',()=>{assert.equal(validatePlan(plan()).total,700);for(const mutate of [p=>p.checkedAt-=300001,p=>p.checkedAt+=10000,p=>p.market='pc',p=>p.players.push(p.players[0]),p=>p.total=0,p=>p.players[0].rarity=NaN,p=>p.players[0].price=0,p=>p.url='https://evil.com/27/squad/123/sbc']){const p=plan();mutate(p);assert.throws(()=>validatePlan(p));}});
test('URL restrictions reject old editions, spoofed hosts and wrong routes',()=>{assert.ok(futbinURL('https://www.futbin.com/27/squad-building-challenges/Upgrades/59/totw-upgrade'));for(const url of ['https://www.futbin.com.evil.org/27/squad-building-challenges/Upgrades/59/name','https://www.futbin.com/26/squad-building-challenges/Upgrades/59/name','https://www.futbin.com/27/player/1/name'])assert.throws(()=>futbinURL(url));});
test('slot mapping cannot duplicate, skip or overwrite a brick slot',()=>{const players=[{},{}],slots=[{index:0},{index:2}];assert.deepEqual(validateMapping(players,slots,[2,0]),[2,0]);for(const mapping of [[0,0],[0,1],[0],[]])assert.throws(()=>validateMapping(players,slots,mapping));});
test('automatic mapping uses FUTBIN formation slots, including out of position cards',()=>{
 const players=[{futbinSlot:2,slotPosition:'CB',position:'LM'},{futbinSlot:1,slotPosition:'ST',position:'ST'}];
 const slots=[{index:4,position:'CB'},{index:0,position:'ST'}];
 assert.deepEqual(suggestMapping(players,slots),[4,0]);
 assert.throws(()=>suggestMapping(players,slots.slice(1)),/different slot counts/);
});
