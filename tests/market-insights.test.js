import test from 'node:test';
import assert from 'node:assert/strict';
import {recordMarketSnapshot,buildMarketBrief,validateModelBrief} from '../extension/market-insights.js';
import {readFutbinHeadlines} from '../extension/futbin-news.js';

const card=(price,assetId=123)=>({assetId,name:'Example player',url:`https://www.futbin.com/27/player/${assetId}/example-player`,consolePrice:price,eaAverage:1100,updatedSeconds:60,trend:-2,revision:'Normal'});
const page=(at,price)=>({kind:'market',url:'https://www.futbin.com/27/market-player-list?ps_price=0-5000&sort=ps_updated&order=desc',checkedAt:at,cards:[card(price),{...card(800,456),updatedSeconds:999}]});

test('daily snapshots keep fresh console prices and compare the same card across days',()=>{
  const first=Date.parse('2026-09-25T12:00:00Z');
  const second=Date.parse('2026-09-26T12:00:00Z');
  const third=Date.parse('2026-09-27T12:00:00Z');
  const day1=recordMarketSnapshot([], [page(first,1100)],first);
  const day2=recordMarketSnapshot(day1.history,[page(second,1050)],second);
  const day3=recordMarketSnapshot(day2.history,[page(third,900)],third);
  assert.equal(day3.snapshot.cards.length,1);
  assert.equal(day3.history.length,3);
  const brief=buildMarketBrief(day3.snapshot,day3.history,2000,[],third);
  assert.equal(brief.historyDays,2);
  assert.equal(brief.candidates[0].stance,'consider');
  assert.equal(brief.candidates[0].dayChange,-14.3);
  assert.equal(brief.candidates[0].buyCeiling,750);
  assert.equal(brief.candidates[0].sellTarget,900);
  assert.equal(brief.candidates[0].projectedNet,105);
  assert.equal(brief.candidates[0].risk,'medium');
  assert.equal(brief.candidates[0].hold.label,'1–3 days');
  assert.match(brief.candidates[0].filter,/max 750 coins/);
});

test('a first-day brief stays watch-only and rejects stale or distorted prices',()=>{
  const now=Date.parse('2026-09-27T12:00:00Z');
  const {snapshot,history}=recordMarketSnapshot([], [page(now,900)],now);
  assert.equal(buildMarketBrief(snapshot,history,2000,[],now).candidates[0].stance,'watch');
  assert.equal(buildMarketBrief(snapshot,history,2000,[],now).candidates[0].risk,'high');
  assert.equal(buildMarketBrief(snapshot,history,2000,[],now).candidates[0].hold.label,'Review in 24h');
  assert.throws(()=>recordMarketSnapshot([], [{...page(now,900),checkedAt:now-11*60_000}],now),/No fresh/);
  assert.equal(buildMarketBrief(snapshot,history,500,[],now).candidates.length,0);
});

test('model notes can only reference checked cards and supplied news links',()=>{
  const now=Date.parse('2026-09-27T12:00:00Z');
  const {snapshot,history}=recordMarketSnapshot([], [page(now,900)],now);
  const brief=buildMarketBrief(snapshot,history,2000,[{title:'Rumoured Example player SBC',url:'https://www.futbin.com/news/articles/1773/example',at:now}],now);
  const notes=validateModelBrief({ideas:[{assetId:999,stance:'consider',reason:'Made up'},{assetId:123,stance:'consider',reason:'Only a rumour',catalystURL:'https://evil.example/'},{assetId:123,stance:'watch',reason:'Duplicate'}]},brief);
  assert.equal(notes.length,1);
  assert.equal(notes[0].assetId,123);
  assert.equal(notes[0].stance,'watch');
  assert.equal(notes[0].catalystURL,null);
  assert.equal(brief.headlines[0].kind,'rumour');
  assert.equal(brief.headlines[0].topic,'SBC');
});

test('Marquee Matchups headlines are categorized without becoming a buy signal',()=>{
  const now=Date.parse('2026-09-27T12:00:00Z');
  const {snapshot,history}=recordMarketSnapshot([], [page(now,900)],now);
  const brief=buildMarketBrief(snapshot,history,2000,[{title:'Marquee Matchups prediction for this week',url:'https://www.futbin.com/news/articles/1774/marquee',at:now}],now);
  assert.equal(brief.headlines[0].topic,'Marquee Matchups');
  assert.equal(brief.headlines[0].kind,'rumour');
  assert.equal(brief.candidates[0].stance,'watch');
});

test('holding window lengthens only with repeated prices and positive player opinion',()=>{
  const start=Date.parse('2026-09-18T12:00:00Z');
  let history=[];
  for(let day=0;day<9;day++){
    const now=start+day*86_400_000;
    history=recordMarketSnapshot(history,[{...page(now,900),cards:[{...card(900),trend:2}]}],now).history;
  }
  const snapshot=history.at(-1),now=snapshot.at;
  const signal={123:{positive:80,negative:20,games:100000}};
  const long=buildMarketBrief(snapshot,history,2000,[],now,signal).candidates[0];
  assert.equal(long.hold.label,'1–3 weeks');
  assert.equal(long.hold.approval,80);
  assert.equal(long.risk,'high');
  const rumor=[{title:'Leaked Example player SBC',url:'https://www.futbin.com/news/articles/1773/example',at:now}];
  const uncertain=buildMarketBrief(snapshot,history,2000,rumor,now,signal).candidates[0];
  assert.equal(uncertain.hold.label,'Wait for confirmation');
  assert.equal(uncertain.hold.sourceURL,rumor[0].url);
});

test('FUTBIN news reader only accepts distinct article links',()=>{
  const article={getAttribute:()=>'/news/articles/1773/example',querySelector:()=>({textContent:'Example FC 27 SBC prediction'}),textContent:'Example FC 27 SBC prediction',closest:()=>({textContent:'Example FC 27 SBC prediction 26-Sep-26'})};
  globalThis.location={origin:'https://www.futbin.com',pathname:'/news',href:'https://www.futbin.com/news'};
  globalThis.document={title:'EA FC 27 News',body:{innerText:'EA FC 27 News'},querySelectorAll:()=>[article,article]};
  const result=readFutbinHeadlines();
  assert.equal(result.kind,'news');
  assert.equal(result.headlines.length,1);
  assert.equal(result.headlines[0].at,Date.parse('26 Sep 2026 UTC'));
});


test('brief buy filters use legal market price increments across tiers',()=>{
  const now=Date.parse('2026-09-29T12:00:00Z');
  for(const [price,expected] of [[6400,5100],[9800,7800],[14000,11000],[70000,56000],[140000,112000]]){
    const {snapshot,history}=recordMarketSnapshot([], [{kind:'market',checkedAt:now,cards:[{...card(price),eaAverage:price}]}],now);
    const idea=buildMarketBrief(snapshot,history,200000,[],now).candidates[0];
    assert.equal(idea.buyCeiling,expected);
  }
});
