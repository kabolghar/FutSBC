import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewSquad,supportCandidates,requestedCovered} from '../extension/squad-review.js';
const now=Date.UTC(2026,9,3),day=86400000;
const player={index:0,definitionId:123,position:'ST',name:'Card',tradable:true};
const team={fingerprint:'XI',players:[player]};
const quote={definitionId:123,price:8000,source:'fodder.gg',updatedAt:now};
const ranking={definitionId:123,position:'ST',source:'FUT.GG',rank:25,url:'best/cheap/st',checkedAt:now};
const history={'123:ST':[{at:now-2*day,price:10000,priceSource:'fodder.gg',rank:10,rankingURL:'best/cheap/st'}]};
test('review separates measured price decline and relative ranking drift with dated evidence',()=>{
  const result=reviewSquad(team,[quote],[ranking],history,now);
  assert.equal(result.rows[0].signals.length,2);assert.equal(result.rows[0].priceChange,-20);
  assert.equal(result.rows[0].netSaleEstimate,7600);assert.deepEqual(result.suggestedSlots,[0]);
  assert.equal(result.rows[0].signals[0].since,now-2*day);
});
test('first snapshot and missing rankings never invent a decline or a gameplay downgrade',()=>{
  const result=reviewSquad(team,[quote],[],{},now);
  assert.deepEqual(result.suggestedSlots,[]);assert.equal(result.rows[0].rank,null);
  assert.equal(result.history['123:ST'].length,1);
  const again=reviewSquad(team,[],[],history,now);
  assert.deepEqual(again.rows[0].signals,[]);assert.equal(again.rows[0].price,null);
});
test('exact versions, positions, source universe and freshness prevent false comparisons',()=>{
  const result=reviewSquad(team,[{...quote,definitionId:456}],[{...ranking,position:'CAM'}],history,now);
  assert.deepEqual(result.rows[0].signals,[]);
  for(const bad of [{...quote,updatedAt:now-7*3600000},{...quote,price:-5},{...quote,updatedAt:now+2*day}])assert.equal(reviewSquad(team,[bad],[],history,now).rows[0].price,null);
  assert.equal(reviewSquad(team,[quote],[{...ranking,url:'best/all/st'}],history,now).rows[0].rankChange,null);
  assert.equal(reviewSquad({...team,players:[{...player,tradable:false}]},[quote],[],history,now).rows[0].netSaleEstimate,null);
});
test('same-day refreshes do not become new trend evidence and old history expires',()=>{
  const first=reviewSquad(team,[quote],[ranking],{},now);
  const second=reviewSquad(team,[{...quote,price:5000}],[ranking],first.history,now+60000);
  assert.equal(second.history['123:ST'].length,1);assert.deepEqual(second.suggestedSlots,[]);
  assert.equal(reviewSquad(team,[quote],[ranking],{'123:ST':[{...history['123:ST'][0],at:now-31*day}]},now).history['123:ST'].length,1);
});
test('supporting positions protect user anchors and original requested upgrades are required',()=>{
  const players=[{...player,index:0},{...player,index:1,concept:true},{...player,index:2},{...player,index:3},{...player,index:4,definitionId:0}];
  assert.deepEqual(supportCandidates({players},[0],[{slotIndex:2}],[]),[3]);
  assert.equal(requestedCovered({choices:[{slotIndex:3}]},[0]),false);
  assert.equal(requestedCovered({choices:[{slotIndex:0},{slotIndex:3}]},[0]),true);
  assert.equal(requestedCovered(null,[0]),false);
});
