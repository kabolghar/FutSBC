import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateListing,rankOpportunities} from '../extension/auto-trade-core.js';
import {eaOperation} from '../extension/ea.js';

test('a trade needs five comparable listings and positive margin after tax',()=>{
  const prices=[1500,1550,1600,1650,1700];
  assert.equal(evaluateListing(1000,prices,100000).profit,330);
  assert.equal(evaluateListing(1000,prices.slice(0,4),100000),null);
  assert.equal(evaluateListing(1300,prices,100000),null);
  assert.equal(evaluateListing(15000,prices,100000),null);
});

test('ranking chooses the highest estimated net profit within the current balance',()=>{
  const listings=[
    {buy:1000,comparables:[1500,1550,1600,1650,1700]},
    {buy:15000,comparables:[20000,21000,22000,22500,23000]},
    {buy:110000,comparables:[150000,155000,160000,165000,170000]}
  ];
  const ranked=rankOpportunities(listings,100000);
  assert.deepEqual(ranked.map(entry=>entry.row.buy),[15000,1000]);
  assert.ok(ranked[0].offer.profit>ranked[1].offer.profit);
  assert.equal(evaluateListing(15000,listings[1].comparables,14999),null);
});

function setupMarket({stale=false,omitFromExact=false,listFails=false,broadStatus=null,exactStatus=null,watchedStatus=null,watchedShape='response',closed=false,rejectCombinedBid=false,buyPrice=1000,extraBroad=0,auctionMode=false,comparablePrices=[1300,1350,1400,1450,1500]}={}){
  const obs=result=>({observe(owner,fn){queueMicrotask(()=>fn(this,result));},unobserve(){}});
  let currentBid=900,highest=false,auctionWon=false,lastPlacedBid=0;
  const listing=(tradeId,buyNowPrice,definitionId=10)=>({definitionId,rating:83,name:'Test Player',isPlayer:()=>true,getAuctionData:()=>({tradeId,buyNowPrice,currentBid,startingBid:900,getSecondsRemaining:()=>600,canBuy:()=>true,canBid:()=>true,isWon:()=>auctionMode?auctionWon:bids>0,isHighestBid:()=>highest,isClosedTrade:()=>closed})});
  const broad=[listing(99,buyPrice),...Array.from({length:extraBroad},(_,index)=>listing(200+index,buyPrice+index+1,11+index))];
  const target=listing(99,stale?buyPrice+100:buyPrice);
  const exact=[...(omitFromExact?[]:[target]),...comparablePrices.map((price,index)=>listing(index+1,price))];
  let bids=0,lists=0,cacheClears=0,marketSelections=0,cachedItems=null;
  const searches=[];
  globalThis.window={fut_year:'2027'};
  globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({})})})});
  globalThis.GameCurrency={COINS:'coins'};
  globalThis.UTSearchCriteriaDTO=class{};
  globalThis.UTCurrencyInputControl={getIncrementAboveVal:value=>value+50};
  globalThis.SearchType={PLAYER:'player'};
  globalThis.services={Module:{set:value=>{assert.equal(value,3355443200);marketSelections++;}},User:{getUser:()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})}),getCurrency:()=>({amount:100000})})},Item:{
    clearTransferMarketCache:()=>{cacheClears++;cachedItems=null;},
    searchTransferMarket:criteria=>{
      searches.push({...criteria});
      if(!cachedItems) cachedItems=!criteria.defId?broad:criteria.maxBid?[target]:criteria.maxBuy?(stale?[]:[target]):exact;
      const status=rejectCombinedBid&&criteria.defId&&criteria.maxBid?512:criteria.defId?exactStatus:broadStatus;
      return obs({success:status===null,status,data:{items:status===null?cachedItems:[]}});
    },
    target:()=>obs({success:true}),
    bid:(_item,amount)=>{bids++;if(auctionMode){currentBid=amount;lastPlacedBid=amount;highest=true;return obs({success:true,data:{items:[target]}});}return obs({success:true,data:{items:[{definitionId:10}]}});},
    list:()=>{lists++;return obs({success:!listFails,status:listFails?500:200,data:{}});},
    requestWatchedItems:()=>obs({success:watchedStatus===null,status:watchedStatus,...(watchedShape==='data'?{data:{items:watchedStatus===null?[target]:[]}}:watchedShape==='missing'?{}:{response:{items:watchedStatus===null?[target]:[]}})})
  }};
  return {get bids(){return bids;},get lists(){return lists;},get cacheClears(){return cacheClears;},get marketSelections(){return marketSelections;},searches,outbid:amount=>{currentBid=amount;highest=false;},win:()=>{auctionWon=true;currentBid=lastPlacedBid;}};
}

test('EA market adapter scans and buys once only after a fresh exact-card check',async()=>{
  const market=setupMarket();
  const scan=await eaOperation('tradeScan',{maxBuy:12000});
  assert.equal(scan.ok,true);
  assert.equal(scan.listings[0].comparables.length,5);
  assert.equal(market.cacheClears,2);
  const order=await eaOperation('tradeExecute',{definitionId:10,tradeId:'99',buy:1000,sell:1350,maxBuy:12000});
  assert.equal(order.listed,true);
  assert.equal(market.bids,1);
  assert.equal(market.lists,1);
});

test('a broad-search listing is evaluated when the first exact-card page omits its auction',async()=>{
  const market=setupMarket({omitFromExact:true});
  const scan=await eaOperation('tradeScan',{maxBuy:12000});
  assert.equal(scan.marketCount,1);
  assert.equal(scan.checked,1);
  assert.equal(scan.listings[0].tradeId,'99');
  const order=await eaOperation('tradeExecute',{definitionId:10,tradeId:'99',buy:1000,sell:1350,maxBuy:12000});
  assert.equal(order.listed,true);
  assert.equal(market.bids,1);
});

test('each scan limits itself to two exact-card searches',async()=>{
  const market=setupMarket({extraBroad:3});
  const scan=await eaOperation('tradeScan',{maxBuy:12000});
  assert.equal(scan.marketCount,4);
  assert.equal(scan.checked,2);
  assert.equal(market.cacheClears,3);
});

test('auction trader bids, watches, stops at the margin, and lists a won card',async()=>{
  const market=setupMarket({auctionMode:true,buyPrice:2000,rejectCombinedBid:true,comparablePrices:[1500,1600,1700,1800,1900]});
  const card={assetId:10,name:'Test Player',consolePrice:1500,eaAverage:1400,updatedSeconds:20,trend:2,revision:'Normal',checkedAt:Date.now(),url:'https://www.futbin.com/27/player/10/test-player'};
  const scan=await eaOperation('tradeBidScan',{cards:[card]});
  assert.equal(scan.ok,true);
  assert.equal(scan.listings[0].buy,950);
  assert.equal(scan.listings[0].comparables.length,5);
  assert.equal(market.cacheClears,1);
  assert.deepEqual(market.searches[0].defId,[10]);
  assert.equal(market.searches[0].maxBid,undefined);
  const order={definitionId:10,tradeId:'99',sell:1400,comparables:scan.listings[0].comparables,futbinPrice:1500,quoteAt:Date.now()};
  const first=await eaOperation('tradeBidStep',{...order,existing:false});
  assert.equal(first.phase,'bid');
  assert.equal(first.bid,950);
  assert.equal(market.bids,1);
  assert.equal((await eaOperation('tradeBidStep',{...order,existing:true,lastBid:950})).phase,'highest');
  market.outbid(1000);
  const second=await eaOperation('tradeBidStep',{...order,existing:true,lastBid:950});
  assert.equal(second.phase,'bid');
  assert.equal(second.bid,1050);
  assert.equal(market.bids,2);
  market.outbid(1100);
  assert.equal((await eaOperation('tradeBidStep',{...order,existing:true,lastBid:1050})).phase,'outbid-cap');
  assert.equal(market.bids,2);
  market.win();
  const won=await eaOperation('tradeBidStep',{...order,existing:true,lastBid:1050});
  assert.equal(won.phase,'listed');
  assert.equal(won.paid,1050);
  assert.equal(market.lists,1);
});

test('auction scan rejects missing or stale FUTBIN evidence before searching EA',async()=>{
  const market=setupMarket({auctionMode:true});
  assert.equal((await eaOperation('tradeBidScan')).ok,false);
  assert.equal(market.cacheClears,0);
  const card={assetId:10,consolePrice:1500,checkedAt:Date.now()-61_000,url:'https://www.futbin.com/27/player/10/test-player'};
  const stale=await eaOperation('tradeBidScan',{cards:[card]});
  assert.equal(stale.checked,0);
  assert.equal(market.cacheClears,0);
});

test('FUTBIN price caps the planned sale even when EA ask prices are higher',()=>{
  const offer=evaluateListing(1000,[1500,1550,1600,1650,1700],10000,1300);
  assert.equal(offer.sell,1300);
  assert.equal(evaluateListing(1200,[1500,1550,1600,1650,1700],10000,1300),null);
});

test('a fresh EA price drop cancels the first bid',async()=>{
  const market=setupMarket({auctionMode:true,comparablePrices:[1100,1150,1200,1250,1300]});
  const order={definitionId:10,tradeId:'99',sell:1550,comparables:[1500,1550,1600,1650,1700],futbinPrice:1600,quoteAt:Date.now(),existing:false};
  const step=await eaOperation('tradeBidStep',order);
  assert.equal(step.phase,'outbid-cap');
  assert.equal(market.bids,0);
});

test('read-only market check identifies the search stage EA rejects',async()=>{
  const healthy=setupMarket();
  assert.deepEqual(await eaOperation('tradeDiagnose'),{ok:true,stage:'complete',broadCount:1,exactCount:6,sameCount:6});
  assert.equal(healthy.cacheClears,2);
  assert.equal(healthy.marketSelections,2);
  assert.equal(healthy.bids,0);
  setupMarket({exactStatus:512});
  assert.deepEqual(await eaOperation('tradeDiagnose'),{ok:true,stage:'exact',status:512,broadCount:1});
  setupMarket({broadStatus:512});
  assert.deepEqual(await eaOperation('tradeDiagnose'),{ok:true,stage:'broad',status:512});
  const target=setupMarket();
  assert.deepEqual(await eaOperation('tradeDiagnose',{assetId:10}),{ok:true,stage:'target-complete',assetId:10,exactCount:6,sameCount:6,pages:1});
  assert.equal(target.searches.length,1);
  setupMarket({exactStatus:512});
  assert.deepEqual(await eaOperation('tradeDiagnose',{assetId:10}),{ok:true,stage:'target',status:512,assetId:10});
  const watched=setupMarket({watchedStatus:426});
  assert.deepEqual(await eaOperation('tradeDiagnose'),{ok:true,stage:'targets',status:426});
  assert.equal(watched.searches.length,0);
  assert.equal(watched.bids,0);
  const card={assetId:10,name:'Test Player',consolePrice:1500,checkedAt:Date.now(),url:'https://www.futbin.com/27/player/10/test-player'};
  const hunt=await eaOperation('tradeAuctionHunt',{cards:[card]});
  assert.equal(hunt.ok,false);
  assert.equal(hunt.stage,'targets-read');
  assert.equal(hunt.status,426);
  assert.equal(watched.searches.length,0);
});

test('a 429 market rejection preserves its status and stops the scan',async()=>{
  const market=setupMarket({broadStatus:429});
  const result=await eaOperation('tradeScan',{maxBuy:12000});
  assert.equal(result.ok,false);
  assert.equal(result.status,429);
  assert.equal(market.cacheClears,1);
  assert.equal(market.bids,0);
});

test('EA adapter accepts a profitable order above the former per-purchase cap',async()=>{
  const market=setupMarket({buyPrice:15000,comparablePrices:[20000,21000,22000,22500,23000]});
  const order=await eaOperation('tradeExecute',{definitionId:10,tradeId:'99',buy:15000,sell:22250,maxBuy:100000});
  assert.equal(order.listed,true);
  assert.equal(market.bids,1);
});

test('EA adapter does not bid when the listing price changed',async()=>{
  const market=setupMarket({stale:true});
  const result=await eaOperation('tradeExecute',{definitionId:10,tradeId:'99',buy:1000,sell:1350,maxBuy:12000});
  assert.equal(result.ok,false);
  assert.equal(market.bids,0);
  assert.equal(market.lists,0);
});

test('a bought card with a failed listing halts with a manual recovery instruction',async()=>{
  const market=setupMarket({listFails:true});
  const result=await eaOperation('tradeExecute',{definitionId:10,tradeId:'99',buy:1000,sell:1350,maxBuy:12000});
  assert.equal(result.ok,true);
  assert.equal(result.purchased,true);
  assert.equal(result.listed,false);
  assert.match(result.warning,/Check New Items/);
  assert.equal(market.bids,1);
  assert.equal(market.lists,1);
});

test('page hunt bids on multiple expiring auctions and retries delayed Transfer Targets',async()=>{
  const obs=result=>({observe(owner,fn){queueMicrotask(()=>fn(this,result));},unobserve(){}});
  const watched=[],won=new Set(),pages=[],listed=[],actions=[];
  let hideWatch=false;
  const card=(id,price,seconds)=>{
    const data={tradeId:String(id),buyNowPrice:price,currentBid:900,startingBid:900,getSecondsRemaining:()=>seconds,canBid:()=>true,isWon:()=>won.has(String(id)),isHighestBid:()=>watched.includes(item),isClosedTrade:()=>false};
    const item={assetId:10,definitionId:10,rareflag:0,name:'Test Player',isPlayer:()=>true,hasPriceLimits:()=>true,getAuctionData:()=>data};
    return item;
  };
  const comparison=Array.from({length:20},(_,index)=>card(index+1,1500+index*50,900));
  const first=card(99,2200,50),second=card(100,2300,40);
  globalThis.window={fut_year:'2027'};
  globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({})})})});
  globalThis.GameCurrency={COINS:'coins'};
  globalThis.UTSearchCriteriaDTO=class{};
  globalThis.UTCurrencyInputControl={getIncrementAboveVal:value=>value+50};
  globalThis.SearchType={PLAYER:'player'};
  globalThis.services={User:{getUser:()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})}),getCurrency:()=>({amount:100000})})},Item:{
    clearTransferMarketCache:()=>{},
    searchTransferMarket:(_criteria,page)=>{pages.push(page);return obs({success:true,data:{items:page===1?[...comparison,first]:page===2?[second,...comparison]:[]}});},
    requestWatchedItems:()=>obs({success:true,response:{items:hideWatch?[]:[...watched]}}),
    target:item=>{actions.push(`target:${item.getAuctionData().tradeId}`);watched.push(item);return obs({success:true});},
    bid:(item,amount)=>{actions.push(`bid:${item.getAuctionData().tradeId}`);item.getAuctionData().currentBid=amount;return obs({success:true});},
    list:(item,_start,sell)=>{listed.push({id:item.getAuctionData().tradeId,sell});return obs({success:true});}
  }};
  const evidence={assetId:10,name:'Test Player',consolePrice:1600,checkedAt:Date.now(),url:'https://www.futbin.com/27/player/10/test-player'};
  const blocked=await eaOperation('tradeAuctionHunt',{cards:[{...evidence,researchBidCeiling:900}]});
  assert.equal(blocked.bids.length,0);assert.equal(actions.length,0);pages.length=0;
  const hunt=await eaOperation('tradeAuctionHunt',{cards:[{...evidence,researchBidCeiling:950}]});
  assert.ok(hunt.bids.every(order=>order.researchBidCeiling===950));
  assert.equal(hunt.ok,true);
  assert.deepEqual(pages,[1,2]);
  assert.equal(hunt.bids.length,2);
  assert.equal(watched.length,2);
  assert.equal(actions.length,4);
  assert.deepEqual(actions.slice(0,2),[`target:${hunt.bids[0].tradeId}`,`bid:${hunt.bids[0].tradeId}`]);
  assert.deepEqual(actions.slice(2,4),[`target:${hunt.bids[1].tradeId}`,`bid:${hunt.bids[1].tradeId}`]);
  hideWatch=true;
  const pending=await eaOperation('tradeWatchBatch',{orders:hunt.bids});
  assert.deepEqual(pending.updates.map(update=>update.phase),['pending','pending']);
  hideWatch=false;
  won.add('99');
  const checked=await eaOperation('tradeWatchBatch',{orders:hunt.bids.map((order,index)=>({...order,misses:pending.updates[index].misses}))});
  assert.deepEqual(checked.updates.map(update=>update.phase).sort(),['highest','listed']);
  assert.deepEqual(listed,[{id:'99',sell:1400}]);
  second.getAuctionData().isHighestBid=()=>false;second.getAuctionData().currentBid=1000;
  const count=actions.length;
  const capped=await eaOperation('tradeWatchBatch',{orders:hunt.bids.filter(order=>order.tradeId==='100')});
  assert.equal(capped.updates[0].phase,'outbid-cap');assert.equal(actions.length,count);
});

test('market authentication failure is identified before any auction bid',async()=>{
  const market=setupMarket({exactStatus:401});
  const card={assetId:10,name:'Test Player',consolePrice:1500,checkedAt:Date.now(),url:'https://www.futbin.com/27/player/10/test-player'};
  const result=await eaOperation('tradeAuctionHunt',{cards:[card]});
  assert.equal(result.ok,false);
  assert.equal(result.status,401);
  assert.equal(result.stage,'market-search');
  assert.equal(market.bids,0);
});

test('Transfer Targets accepts EA item lists in either response shape',async()=>{
  setupMarket({watchedShape:'data'});
  const review=await eaOperation('tradeReview',{tradeId:'99',lastBid:900});
  assert.equal(review.phase,'unconfirmed');
  const diagnostic=await eaOperation('tradeDiagnose');
  assert.notEqual(diagnostic.stage,'targets-data');
});

test('a missing Transfer Targets item list is diagnosed and retried while monitoring',async()=>{
  setupMarket({watchedShape:'missing'});
  const review=await eaOperation('tradeReview',{tradeId:'99',lastBid:900});
  assert.equal(review.reason,'items-missing');
  const watched=await eaOperation('tradeWatchBatch',{orders:[{tradeId:'99',definitionId:10,lastBid:900}]});
  assert.equal(watched.ok,false);
  assert.equal(watched.stage,'targets-watch');
});

test('review distinguishes an expired auction from a bid below the attempted amount',async()=>{
  setupMarket({closed:true});
  assert.equal((await eaOperation('tradeReview',{tradeId:'99',lastBid:900})).phase,'lost');
  setupMarket();
  const lower=await eaOperation('tradeReview',{tradeId:'99',lastBid:950});
  assert.equal(lower.phase,'below-attempt');
  assert.equal(lower.bid,900);
});

for(const confirm of [true,false])test(`a rejected bid ${confirm?'is recovered only from its exact Transfer Target':'stays uncertain when Transfer Targets cannot be read'}`,async()=>{
  const obs=result=>({observe(owner,fn){queueMicrotask(()=>fn(this,result));},unobserve(){}});
  let balance=10000,watchReads=0,bidCalls=0;
  const listing=(id,price,seconds)=>{
    const data={tradeId:String(id),buyNowPrice:price,currentBid:900,startingBid:900,getSecondsRemaining:()=>seconds,canBid:()=>true,isHighestBid:()=>id===99&&bidCalls>0,isWon:()=>false};
    return {assetId:10,definitionId:10,rareflag:0,name:'Test Player',isPlayer:()=>true,getAuctionData:()=>data};
  };
  const candidate=listing(99,2000,50);
  const rows=[candidate,...[1500,1550,1600,1650,1700].map((price,index)=>listing(index+1,price,900))];
  globalThis.window={fut_year:'2027'};
  globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({})})})});
  globalThis.GameCurrency={COINS:'coins'};
  globalThis.UTSearchCriteriaDTO=class{};
  globalThis.UTCurrencyInputControl={getIncrementAboveVal:value=>value+50};
  globalThis.SearchType={PLAYER:'player'};
  globalThis.services={User:{getUser:()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})}),getCurrency:()=>({amount:balance})})},Item:{
    clearTransferMarketCache:()=>{},searchTransferMarket:()=>obs({success:true,data:{items:rows}}),
    requestWatchedItems:()=>{watchReads++;return obs(watchReads===1?{success:true,response:{items:[]}}:confirm?{success:true,response:{items:[candidate]}}:{success:false,status:521});},
    target:()=>obs({success:true}),
    bid:()=>{bidCalls++;balance-=950;candidate.getAuctionData().currentBid=950;return obs({success:false,status:521});}
  }};
  const evidence={assetId:10,name:'Test Player',consolePrice:1600,checkedAt:Date.now(),url:'https://www.futbin.com/27/player/10/test-player'};
  const hunt=await eaOperation('tradeAuctionHunt',{cards:[evidence]});
  assert.equal(hunt.ok,true);
  assert.equal(bidCalls,1);
  assert.equal(watchReads,2);
  assert.equal(hunt.balance,9050);
  if(confirm){
    assert.equal(hunt.uncertain,null);
    assert.equal(hunt.bids[0].tradeId,'99');
    const review=await eaOperation('tradeReview',{tradeId:'99',lastBid:950});
    assert.equal(review.phase,'highest');
    assert.equal(review.bid,950);
  }else{
    assert.deepEqual(hunt.bids,[]);
    assert.equal(hunt.uncertain.tradeId,'99');
    assert.equal(hunt.uncertain.reconciliation,'unavailable');
    assert.equal(hunt.uncertain.balanceBeforeBid,10000);
    assert.equal(hunt.uncertain.balanceAfterBid,9050);
    const review=await eaOperation('tradeReview',{tradeId:'99',lastBid:950});
    assert.equal(review.phase,'unavailable');
    assert.equal(review.status,521);
  }
});

 test('resale prices remain on valid steps at market tier boundaries',()=>{
  for(const [reference,expected,buy] of [[1000,950,500],[10000,9900,7000],[50000,49750,30000],[100000,99500,70000]]){
    assert.equal(evaluateListing(buy,Array(5).fill(reference),200000).sell,expected);
  }
  assert.equal(evaluateListing(7000,Array(5).fill(12000),200000,10243).sell,10000);
});
