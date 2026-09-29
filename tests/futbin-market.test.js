import test from 'node:test';
import assert from 'node:assert/strict';
import {marketBands,readFutbinMarket,selectMarketCards} from '../extension/futbin-market.js';

const page='https://www.futbin.com/27/market-player-list?ps_price=5000-10000&sort=ps_updated&order=desc';

test('reads exact FC 27 console fields from FUTBIN market rows',()=>{
  const elements={
    'a.table-player-name[href^="/27/player/"]':{textContent:'Carlos Gruezo',getAttribute:()=>'/27/player/3637/carlos-gruezo'},
    'img.playersquare-base-img':{getAttribute:()=> 'https://cdn3.futbin.com/content/fifa27/img/players/123456.png?w=50'},
    '.table-price.platform-ps-only':{textContent:'9.4K'},
    '.table-ea-average.platform-ps-only':{textContent:'8.9K'},
    '.table-updated.platform-ps-only':{textContent:'39 secs ago'},
    '.table-trend.platform-ps-only .price-diff':{textContent:'5.05%',classList:{contains:name=>name==='negative-color'}},
    '.table-player-revision':{textContent:'Normal'}
  };
  const row={querySelector:selector=>elements[selector]||null};
  globalThis.document={title:'EA FC 27 Market player list',body:{innerText:'EA FC 27 market'},querySelectorAll:selector=>selector==='table.market-player-list-table tr.player-row'?[row]:[]};
  globalThis.location={href:page};
  const result=readFutbinMarket(page);
  assert.equal(result.kind,'market');
  assert.equal(result.rowCount,1);
  assert.deepEqual(result.cards[0],{assetId:123456,name:'Carlos Gruezo',url:'https://www.futbin.com/27/player/3637/carlos-gruezo',consolePrice:9400,eaAverage:8900,updatedSeconds:39,trend:-5.05,revision:'Normal'});
  assert.match(readFutbinMarket(page.replace('5000-10000','10000-20000')).error,/Waiting/);
});

test('selects recent stable FUTBIN cards within balance and rejects distorted quotes',()=>{
  const now=Date.now();
  const card={assetId:123,name:'Card',url:'https://www.futbin.com/27/player/1/card',consolePrice:9400,eaAverage:8900,updatedSeconds:39,trend:-5.05,revision:'Normal'};
  const pageData={kind:'market',checkedAt:now,rowCount:5,cards:[card,{...card,assetId:124,consolePrice:9900,eaAverage:300},{...card,assetId:125,updatedSeconds:601},{...card,assetId:126,trend:30},{...card,assetId:127,consolePrice:20000}]};
  assert.deepEqual(selectMarketCards([pageData],10000,now).map(row=>row.assetId),[123]);
  assert.deepEqual(selectMarketCards([{...pageData,checkedAt:now-61_000}],10000,now),[]);
  assert.deepEqual(marketBands(35000).map(url=>new URL(url).searchParams.get('ps_price')),['20000-50000','10000-20000','5000-10000']);
});

test('identifies a FUTBIN verification interstitial instead of treating it as market data',()=>{
  globalThis.location={href:page};
  globalThis.document={title:'Just a moment...',body:{innerText:'Performing security verification'},querySelectorAll:()=>[]};
  const result=readFutbinMarket(page);
  assert.equal(result.blocked,true);
  assert.match(result.error,/blocked market data/);
});
