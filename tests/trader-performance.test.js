import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileSales,tradingPerformance,quickFlipCards} from '../extension/trader-performance.js';
const now=1_800_000_000_000;
const record={itemId:'1',tradeId:'99',definitionId:10,buy:700,listedAt:now-120000,state:'selling'};
test('only a confirmed exact-card sale contributes profit, including losses',()=>{
 assert.equal(reconcileSales([record],[{itemId:'1',definitionId:11,phase:'sold',sale:800}],now)[0].soldAt,undefined);
 assert.equal(reconcileSales([record],[{itemId:'1',definitionId:10,phase:'unverified'}],now)[0].soldAt,undefined);
 const sale=reconcileSales([record],[{itemId:'1',definitionId:10,phase:'sold',sale:800}],now)[0];
 assert.equal(sale.profit,60);assert.equal(sale.timeToSellMs,120000);
 assert.deepEqual(reconcileSales([sale],[{itemId:'1',definitionId:10,phase:'sold',sale:900}],now+1000),[sale]);
 const loss=reconcileSales([record],[{itemId:'1',definitionId:10,phase:'sold',sale:650}],now)[0];
 assert.equal(loss.profit,-83);assert.equal(tradingPerformance([loss],now).get(10).losses,1);
});
test('quick flips need stable recent estimates, not community or news claims',()=>{
 const card={assetId:10,consolePrice:800,eaAverage:800,updatedSeconds:30,trend:1};
 assert.equal(quickFlipCards([card],[],now)[0].marginStrategy,'quick-flip');
 for(const change of [{updatedSeconds:121},{trend:6},{eaAverage:500}])assert.deepEqual(quickFlipCards([{...card,...change}],[],now),[]);
 const losses=Array.from({length:3},(_,index)=>({...record,itemId:String(index),soldAt:now,profit:-50,timeToSellMs:120000}));
 assert.deepEqual(quickFlipCards([card],losses,now),[]);
 assert.equal(quickFlipCards([card],losses,now+8*86400000).length,1);
});
