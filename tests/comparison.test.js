import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonCandidates} from '../extension/core.js';
const squads=Array.from({length:40},(_,i)=>({url:`https://www.futbin.com/27/squad/${i+1}/sbc`,consolePrice:(40-i)*100}));
test('default comparison visits only the five lowest console totals',()=>{
 const selected=comparisonCandidates(squads);
 assert.deepEqual(selected.map(s=>s.consolePrice),[100,200,300,400,500]);
 assert.equal(selected.length,5);
});
test('full comparison keeps all valid listed candidates',()=>{
 assert.equal(comparisonCandidates(squads,'full').length,40);
});
test('short lists, unknown prices and duplicate links do not add visits',()=>{
 const input=[...squads.slice(0,2),squads[0],{url:'unknown',consolePrice:null}];
 assert.equal(comparisonCandidates(input).length,2);
 assert.deepEqual(comparisonCandidates([]),[]);
});
