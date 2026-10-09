import test from 'node:test';
import assert from 'node:assert/strict';
import {eaOperation} from '../extension/ea.js';
import {paletoolsEstimates,validEstimate} from '../extension/team-prices.js';

const observed=result=>({observe(owner,callback){queueMicrotask(()=>callback(this,result));},unobserve(){}});
function setup(){
  const club={isPlaystation:true},persona={id:1,sku:'console',getCurrentClub:()=>club};
  let view={},owned=[],balance=1000;const requests=[];
  globalThis.window={fut_year:'2027',paletools:{}};
  globalThis.GameCurrency={COINS:'coins'};globalThis.SearchType={PLAYER:'player'};globalThis.ItemPile={CLUB:7,PURCHASED:6};globalThis.UTSearchCriteriaDTO=class{};
  globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>({getView:()=>view})})})})});
  globalThis.services={User:{getUser:()=>({getSelectedPersona:()=>persona,getCurrency:()=>({amount:balance})})},Club:{search:()=>observed({success:true,response:{items:owned,retrievedAll:true}})},Item:{clearTransferMarketCache(){},searchTransferMarket(criteria,page){requests.push({criteria,page});return observed({success:true,data:{items:[]}});},bid(item,price){requests.push({buy:price});balance-=price;return observed({success:true,data:{items:[{...item,id:200,pile:6}]}});},move(item){owned=[item];return observed({success:true});}}};
  const row=(id=10,price=450)=>({data:{definitionId:id,rating:81,rareflag:0},__externalPrice:{getValue:()=>price,getRootElement:()=>({style:{}})}});
  const listing=(price=450,id=100)=>({id,definitionId:10,assetId:10,rating:81,rareflag:0,concept:false,loans:-1,isPlayer:()=>true,getAuctionData:()=>({buyNowPrice:price,tradeId:String(id),getSecondsRemaining:()=>90,canBuy:()=>true})});
  return {row,listing,requests,persona,view:value=>view=value,balance:value=>balance=value};
}
const player={definitionId:10,assetId:10,rating:81,rarity:0,name:'Exact card'};
const buy=()=>eaOperation('galleryBuyOne',{player,maxPrice:1000,remaining:1000});

test('Paletools displayed estimates read exact cards without any market request or provider timestamp',async()=>{
  const e=setup(),r=e.row();const view={_list:{listRows:[r]},_subviews:[r]};view._subviews.push(view);e.view(view);
  const result=await eaOperation('paletoolsPrices',{definitionIds:[10,11]});
  assert.equal(result.ok,true,result.error);assert.equal(result.quotes.length,1);assert.equal(result.quotes[0].price,450);assert.equal(result.quotes[0].updatedAt,null);assert.equal(result.quotes[0].source,'Paletools display');assert.equal(e.requests.length,0);
  assert.equal(validEstimate(result.quotes[0],10),false,'display observations must not become daily history quotes');
  e.view({});assert.equal((await eaOperation('paletoolsPrices',{definitionIds:[10]})).quotes.length,1,'navigation retains only scoped recent observations');
  e.persona.id=2;assert.deepEqual((await eaOperation('paletoolsPrices',{definitionIds:[10]})).quotes,[],'changing club discards observations');
});
test('hidden, extinct, malformed and throwing controls invalidate displayed prices',async()=>{
  const e=setup(),r=e.row();e.view({_list:{listRows:[r]}});await eaOperation('paletoolsPrices',{definitionIds:[10]});
  r.__externalPrice.getValue=()=> 'Extinct';assert.deepEqual((await eaOperation('paletoolsPrices',{definitionIds:[10]})).quotes,[]);
  r.__externalPrice.getValue=()=>450;r.__externalPrice.getRootElement=()=>({style:{display:'none'}});assert.deepEqual((await eaOperation('paletoolsPrices',{definitionIds:[10]})).quotes,[]);
  r.__externalPrice.getRootElement=()=>{throw Error('Plugin changed');};assert.equal((await eaOperation('paletoolsPrices',{definitionIds:[10]})).ok,true);
  delete window.paletools;assert.deepEqual((await eaOperation('paletoolsPrices',{definitionIds:[10]})).quotes,[]);
});
test('display cache expires, is bounded and never returns another requested card',async()=>{
  const e=setup();e.view({_list:{listRows:Array.from({length:600},(_,i)=>e.row(i+1))}});
  await eaOperation('paletoolsPrices',{definitionIds:[600]});assert.equal(window.__futsbcPaletoolsEstimateCache.quotes.size,528);
  e.view({});for(const quote of window.__futsbcPaletoolsEstimateCache.quotes.values())quote.observedAt-=11*60_000;
  assert.deepEqual((await eaOperation('paletoolsPrices',{definitionIds:[600]})).quotes,[]);
  assert.equal((await eaOperation('paletoolsPrices',{definitionIds:[-1]})).ok,false);
});
test('planning estimates require exact rating, rarity, account and observation time; never price owned cards',()=>{
  const now=Date.now(),quote={definitionId:10,rating:81,rarity:0,price:450,source:'Paletools display',estimated:true,updatedAt:null,observedAt:now};
  const snapshot={accountKey:'2027:1:console',quotes:[quote]};assert.equal(paletoolsEstimates(snapshot,[player],now).length,1);
  for(const patch of [{rating:82},{rarity:1},{price:'450'},{observedAt:now+1},{observedAt:now-11*60_000},{updatedAt:now}])assert.deepEqual(paletoolsEstimates({...snapshot,quotes:[{...quote,...patch}]},[player],now),[]);
  assert.deepEqual(paletoolsEstimates({...snapshot,accountKey:'2026:1:console'},[player],now),[]);assert.deepEqual(paletoolsEstimates(snapshot,[{...player,owned:true}],now),[]);
});
test('lowest-price search narrows below a full page, ignores plugin overrides and buys only the cheaper verified listing',async()=>{
  const e=setup();services.Item.searchTransferMarket=(criteria,page)=>{e.requests.push({criteria,page});assert.equal(criteria.disableOverrides,true);return observed({success:true,data:{items:criteria.maxBuy===1000?Array.from({length:20},(_,i)=>e.listing(600,100+i)):[e.listing(450,300)]}});};
  const result=await buy();assert.equal(result.phase,'in-club',result.error);assert.equal(result.price,450);assert.deepEqual(e.requests.filter(r=>r.criteria).map(r=>[r.criteria.maxBuy,r.page]),[[1000,1],[550,1]]);assert.deepEqual(e.requests.filter(r=>r.buy),[{buy:450}]);
});
test('EA rejection during price narrowing stops before buying; no retries are hidden',async()=>{
  const e=setup();let count=0;services.Item.searchTransferMarket=()=>{count++;return observed(count===1?{success:true,data:{items:Array.from({length:20},(_,i)=>e.listing(600,100+i))}}:{success:false,status:429});};
  const result=await buy();assert.equal(result.ok,false);assert.equal(result.status,429);assert.equal(result.stage,'gallery-market');assert.equal(result.purchaseAttempted,false);assert.equal(count,2);assert.equal(e.requests.some(r=>r.buy),false);
});
test('wrong versions and expired auctions cannot be used to buy a cheaper card',async()=>{
  const e=setup();services.Item.searchTransferMarket=()=>observed({success:true,data:{items:[{...e.listing(150),rating:80},{...e.listing(200),getAuctionData:()=>({buyNowPrice:200,tradeId:'202',getSecondsRemaining:()=>0,canBuy:()=>true})},e.listing(450)]}});
  assert.equal((await buy()).price,450);
});
test('a balance change during narrowing prevents a purchase',async()=>{
  const e=setup();services.Item.searchTransferMarket=()=>{e.balance(200);return observed({success:true,data:{items:[e.listing(450)]}});};
  const result=await buy();assert.equal(result.ok,false);assert.match(result.error,/balance changed/);assert.equal(e.requests.some(r=>r.buy),false);
});
test('full pages have a bounded search budget and the 150-coin floor needs no extra request',async()=>{
  let e=setup(),count=0;services.Item.searchTransferMarket=criteria=>{count++;return observed({success:true,data:{items:Array.from({length:20},(_,i)=>e.listing(criteria.maxBuy-50,100+i))}});};
  assert.equal((await buy()).price,450);assert.equal(count,6);assert.equal(e.requests.filter(r=>r.buy).length,1);
  e=setup();count=0;services.Item.searchTransferMarket=()=>{count++;return observed({success:true,data:{items:Array.from({length:20},(_,i)=>e.listing(150,100+i))}});};
  assert.equal((await buy()).price,150);assert.equal(count,1);
});
