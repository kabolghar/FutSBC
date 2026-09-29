import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {cleanTradingHeadlines,researchTraderCards} from '../extension/trading-evidence.js';
import {buildMarketBrief,validateModelBrief} from '../extension/market-insights.js';
import {readFutggHeadlines} from '../extension/futbin-news.js';
const now=Date.parse('2026-09-29T12:00:00Z');
const news=[{title:'FC 27 market and rewards review',url:'https://www.fut.gg/news/market-review/',at:now}];
const card={assetId:123,name:'Example Player',url:'https://www.futbin.com/27/player/123/example',price:1000,eaAverage:1050,trend:1};
const snapshot={day:'2026-09-29',at:now,cards:[card]};
const history=[26,27,28].map(day=>({day:`2026-09-${day}`,cards:[{...card,price:1050}]}));
const signals={123:{positive:90,negative:10,games:50000}};
const brief=(overrides={})=>buildMarketBrief({...snapshot,...overrides.snapshot},overrides.history||history,5000,overrides.news||news,now,overrides.signals||signals);
test('discounts alone cannot authorize a new trade and no price-only fallback survives',()=>{
 const b=brief({signals:{}});assert.equal(b.candidates[0].stance,'watch');assert.equal(b.candidates[0].risk,'unrated');
 assert.match(b.candidates[0].evidence.reason,/demand/);
 assert.deepEqual(researchTraderCards([card],b),[]);
});
test('supported short flips require recent history, community use and dated coverage',()=>{
 const b=brief(),idea=b.candidates[0];assert.equal(idea.stance,'consider');assert.equal(idea.risk,'medium');
 assert.match(idea.evidence.reason,/do not prove sales/);
 assert.equal(researchTraderCards([card],b)[0].researchBidCeiling,idea.buyCeiling);
 for(const change of [{news:[]},{history:history.slice(0,1)},{snapshot:{cards:[{...card,price:800}]}},{snapshot:{cards:[{...card,trend:-8}]}}])assert.equal(brief(change).candidates[0].stance,'watch');
});
test('rumours and named-player SBCs do not prove demand for that base version',()=>{
 for(const title of ['Leaked Example Player SBC','Example Player SBC released']){
 const b=brief({news:[{...news[0],title}]});assert.equal(b.candidates[0].stance,'watch');assert.equal(b.candidates[0].risk,'high');
 assert.deepEqual(validateModelBrief({ideas:[{assetId:123,stance:'consider',reason:'Buy this'}]},b),[]);
 }
});
test('source filtering rejects stale, future, wrong-edition and forged sources',()=>{
 const rows=[...news,{...news[0]},...[
 {at:now-8*86400000},{at:now+1},{title:'FC 26 rewards guide'},{url:'https://www.fut.gg.evil.example/news/test/'},{url:'javascript:alert(1)'}
 ].map((change,i)=>({...news[0],url:`https://www.fut.gg/news/article-${i}/`,...change}))];
 assert.equal(cleanTradingHeadlines(rows,now).length,1);
 const b=brief();assert.deepEqual(validateModelBrief({ideas:[{assetId:123,stance:'watch',reason:'Unrelated story',catalystURL:news[0].url}]},b),[]);
});
test('FUT.GG collector reads dated article cards, ignoring navigation and undated items',()=>{
 const dom=new JSDOM('<a href="/news/test/"><h3>FC 27 market review</h3><time datetime="2026-09-28">Yesterday</time></a><a href="/news/test/"><h3>Duplicate</h3><time datetime="2026-09-28"></time></a><a href="/news/other/"><h3>No date</h3></a>',{url:'https://www.fut.gg/news/'});
 globalThis.document=dom.window.document;globalThis.location=dom.window.location;
 const result=readFutggHeadlines();assert.equal(result.headlines.length,1);assert.equal(result.headlines[0].at,Date.parse('2026-09-28'));
 dom.window.close();delete globalThis.document;delete globalThis.location;
});

test('stable supported short flips can be low risk, with explicit conditions and confidence',()=>{
 const stableHistory=[23,24,25,26,27,28].map(day=>({day:`2026-09-${day}`,cards:[{...card,price:1000}]}));
 const b=brief({history:stableHistory,snapshot:{cards:[{...card,updatedSeconds:30}]}}),idea=b.candidates[0];
 assert.equal(idea.risk,'low');assert.equal(idea.confidence,'strong');assert.equal(idea.stance,'consider');
 assert.equal(idea.hold.maxDays,3);assert(idea.evidence.stressedNet>=100);assert.match(idea.riskReason,/buy ceiling/);
 assert.equal(brief({history:stableHistory}).candidates[0].risk,'medium','unknown quote age cannot qualify as low risk');
 assert.equal(brief({history:stableHistory,signals:{}}).candidates[0].risk,'unrated');
 const falling=brief({history:stableHistory,snapshot:{cards:[{...card,price:850,trend:-6,updatedSeconds:30}]}}).candidates[0];
 assert.equal(falling.risk,'high');assert.equal(falling.stance,'watch');
 const noNews=brief({history:stableHistory,news:[],snapshot:{cards:[{...card,updatedSeconds:30}]}}).candidates[0];
 assert.equal(noNews.confidence,'limited');assert.equal(noNews.risk,'unrated');
});
test('missing evidence and concrete hazards remain separate and ungraded cards cannot enter trader',()=>{
 const idea=brief({history:[],signals:{},news:[]}).candidates[0];assert.equal(idea.risk,'unrated');assert.equal(idea.confidence,'limited');assert(idea.evidence.dataGaps.length>=3);
 const bad=brief({history:[],signals:{},news:[],snapshot:{cards:[{...card,trend:10}]}}).candidates[0];assert.equal(bad.risk,'high');assert.equal(bad.confidence,'limited');
 assert.deepEqual(researchTraderCards([card],{candidates:[{...idea,stance:'consider',evidence:{eligible:true}}]}),[]);
});
test('low-risk qualification rejects stale quotes and an inadequate stressed margin',()=>{
 const h=[23,24,25,26,27,28].map(day=>({day:`2026-09-${day}`,cards:[{...card,price:1000}]}));
 assert.equal(brief({history:h,snapshot:{cards:[{...card,updatedSeconds:601}]}}).candidates[0].risk,'medium');
 const cheapHistory=h.map(row=>({...row,cards:[{...card,price:500}]}));
 const cheap=brief({history:cheapHistory,snapshot:{cards:[{...card,price:500,eaAverage:500,updatedSeconds:30}]}}).candidates[0];
 assert.equal(cheap.risk,'medium');assert(cheap.evidence.stressedNet<100);
});
