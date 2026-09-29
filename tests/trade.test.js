import test from 'node:test';
import assert from 'node:assert/strict';
import {tradeMath,rankQuotes,parseQuotes} from '../extension/trade-core.js';

test('trade math includes the EA sale tax before judging profit',()=>{
  const result=tradeMath(17250,18750,500);
  assert.deepEqual({tax:result.tax,netSale:result.netSale,profit:result.profit,maxBuy:result.maxBuy,breakEvenSale:result.breakEvenSale,meetsTarget:result.meetsTarget},
    {tax:938,netSale:17812,profit:562,maxBuy:17312,breakEvenSale:18158,meetsTarget:true});
  assert.equal(tradeMath(17250,18157).profit<0,true);
  assert.equal(tradeMath(17250,18158).profit,0);
});

test('watchlist ranks only after-tax opportunities meeting their target first',()=>{
  const ranked=rankQuotes([
    {name:'Loss',buy:1000,sell:900,target:0},
    {name:'Small',buy:1000,sell:1200,target:200},
    {name:'Ready',buy:1000,sell:1300,target:100}
  ]);
  assert.deepEqual(ranked.map(item=>item.name),['Ready','Small','Loss']);
  assert.deepEqual(ranked.map(item=>item.math.meetsTarget),[true,false,false]);
});

test('paste import accepts quoted names and formatted prices, and rejects broken rows atomically',()=>{
  assert.deepEqual(parseQuotes('Player, Buy, Sell\n"Smith, Jr.", "1,000", 1300\nLee, 2000, 2500',100),[
    {name:'Smith, Jr.',buy:1000,sell:1300,target:100},
    {name:'Lee',buy:2000,sell:2500,target:100}
  ]);
  assert.throws(()=>parseQuotes('A, 1000, 1300\nB, nope, 2000'),/Line 2/);
});
