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

test('portfolio shows realized losses, drawdown and pending capital separately',async()=>{
 const {portfolioSummary}=await import('../extension/trader-performance.js');
 const rows=[{...record,name:'A',soldAt:now-2,profit:100,timeToSellMs:120000},{...record,itemId:'2',soldAt:now-1,profit:-150,timeToSellMs:240000},{...record,itemId:'3',state:'expired'}];
 const summary=portfolioSummary(rows,now);
 assert.equal(summary.realized,-50);assert.equal(summary.maxDrawdown,150);assert.equal(summary.inventoryCost,700);assert.equal(summary.sales,2);assert.equal(summary.expired,1);assert.equal(summary.averageSellMinutes,3);
});

test('hunt diversification prefers a card without bids or pending inventory',async()=>{
 const {selectHuntCard}=await import('../extension/trader-performance.js');
 const cards=[{assetId:10},{assetId:11},{assetId:12}];
 assert.equal(selectHuntCard(cards,[{definitionId:10}],[{...record,definitionId:11}],0,now).assetId,12);
 assert.equal(selectHuntCard(cards,[],[],1,now).assetId,11);
});

test('learned turnover ranking compares return per coin instead of raw profit',()=>{
 const cards=[{assetId:10,consolePrice:10000,eaAverage:10000,updatedSeconds:20,trend:0},{assetId:11,consolePrice:1000,eaAverage:1000,updatedSeconds:20,trend:0}];
 const ledger=cards.flatMap(card=>Array.from({length:3},(_,index)=>({...record,itemId:`${card.assetId}-${index}`,definitionId:card.assetId,buy:card.consolePrice,soldAt:now,profit:card.assetId===10?1000:200,timeToSellMs:3600000})));
 const selected=quickFlipCards(cards,ledger,now);
 assert.equal(selected[0].assetId,11);assert.equal(selected[0].expectedSellMinutes,60);
});
