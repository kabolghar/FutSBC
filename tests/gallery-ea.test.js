import test from 'node:test';import assert from 'node:assert/strict';import {eaOperation} from '../extension/ea.js';
const observed=result=>({observe(owner,callback){queueMicrotask(()=>callback(this,result));},unobserve(){}});
const player={definitionId:10,assetId:10,rating:81,rarity:0,name:'Gallery player'};
function setup(){
 const club={isPlaystation:true},persona={id:1,sku:'console',getCurrentClub:()=>club};let balance=1000,rows=[],bidResult,current={};const events=[];
 globalThis.window={fut_year:'2027'};globalThis.UTSearchCriteriaDTO=class {};globalThis.SearchType={PLAYER:'player'};globalThis.GameCurrency={COINS:'coins'};globalThis.ItemPile={PURCHASED:6,CLUB:7};
 globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>current})})})});
 const card=(price=450,id=100)=>({id,definitionId:10,rating:81,rareflag:0,concept:false,loans:-1,isPlayer:()=>true,getAuctionData:()=>({tradeId:String(id),buyNowPrice:price,getSecondsRemaining:()=>90,canBuy:()=>true})});
 globalThis.services={User:{getUser:()=>({getSelectedPersona:()=>persona,getCurrency:()=>({amount:balance})})},Club:{search:criteria=>{events.push(['club',criteria]);return observed({success:true,response:{items:rows,retrievedAll:true}});}},Item:{clearTransferMarketCache(){},searchTransferMarket:()=>observed({success:true,data:{items:[card(600,101),card()]}}),bid:(item,price)=>{events.push(['buy',price]);balance-=price;return observed(bidResult||{success:true,data:{items:[{...item,id:200,pile:6}]}});},move:(item,pile)=>{events.push(['move',pile]);rows=[item];return observed({success:true});}}};
 return {events,persona,card,owned:items=>rows=items,result:value=>bidResult=value,controller:value=>current=value};
}
test('Paletools Gallery bridge reads the open set and only positive collection records without requests',async()=>{
 const e=setup();globalThis.document={querySelector:selector=>selector==='.gallery-view'?{}:null};
 const controller={selectedSet:{id:116,name:'Starter Set',requiredItems:5,grades:[{name:'D',requiredScore:10}]},selectedCards:new Set(),albumEntries:[{item:{definitionId:10},tracked:true,status:'tracked'},{item:{definitionId:11},tracked:false,status:'missing'},{item:{definitionId:12},tracked:'true',status:'tracked'},{item:{definitionId:10},tracked:true,status:'tracked'},{item:{definitionId:-1},tracked:true,status:'tracked'}],isLoading:false};
 e.controller(controller);const result=await eaOperation('galleryPaletools',{accountKey:'2027:1:console'});assert.equal(result.ok,true,result.error);assert.equal(result.setId,116);assert.deepEqual(result.collected,[10]);assert.deepEqual(result.grades,[{name:'D',threshold:10}]);assert.equal(e.events.length,0);
 controller.albumEntries[0].item={definitionId:10,rating:81,rareflag:0,concept:true,loans:-1,commonName:'Exact player',preferredPosition:'GK'};
 const metadata=await eaOperation('galleryPaletools',{accountKey:'2027:1:console',setId:116,definitionIds:[10]});assert.equal(metadata.cards[0].commonName,'Exact player');assert.equal(metadata.cards[0].overall,81);assert.equal(metadata.cards[0].playerEaId,10);assert.equal(e.events.length,0);
 assert.match((await eaOperation('galleryPaletools',{setId:117})).error,/set changed/);
 controller.isLoading=true;assert.match((await eaOperation('galleryPaletools')).error,/still loading/);controller.isLoading=false;
 assert.equal((await eaOperation('galleryPaletools',{accountKey:'2027:2:console'})).ok,false);e.controller({});assert.match((await eaOperation('galleryPaletools')).error,/Open a set/);
 delete globalThis.document;
});
test('Gallery club checks work without an SBC or active XI and exclude loans and concepts',async()=>{
 const e=setup();e.owned([{...e.card(),loans:7},{...e.card(),concept:true}]);const result=await eaOperation('galleryOwnership',{players:[player]});assert.equal(result.ok,true,result.error);assert.deepEqual(result.owned,[]);e.owned([e.card()]);assert.deepEqual((await eaOperation('galleryOwnership',{players:[player]})).owned,[10]);assert.equal(e.events.some(e=>e[0]==='buy'),false);
});
test('Gallery buyer skips owned cards and buys the lowest checked exact listing within caps',async()=>{
 let e=setup();e.owned([e.card()]);assert.equal((await eaOperation('galleryBuyOne',{player,maxPrice:650,remaining:650})).phase,'owned');assert.equal(e.events.some(e=>e[0]==='buy'),false);
 e=setup();const result=await eaOperation('galleryBuyOne',{accountKey:'2027:1:console',player,maxPrice:650,remaining:650});assert.equal(result.phase,'in-club',result.error);assert.equal(result.price,450);assert.deepEqual(e.events.filter(e=>e[0]!=='club'),[['buy',450],['move',7]]);
});
test('Gallery account switches and invalid budgets never buy a card',async()=>{
 const e=setup();assert.equal((await eaOperation('galleryBuyOne',{accountKey:'2027:2:console',player,maxPrice:650,remaining:650})).ok,false);assert.equal((await eaOperation('galleryBuyOne',{player,maxPrice:650,remaining:100})).ok,false);assert.equal(e.events.some(e=>e[0]==='buy'),false);
});
test('Gallery uncertain purchases are not moved, and read rejection identifies no purchase',async()=>{
 let e=setup();e.result({success:false,status:503});const result=await eaOperation('galleryBuyOne',{player,maxPrice:650,remaining:650});assert.equal(result.phase,'uncertain');assert.equal(e.events.some(e=>e[0]==='move'),false);
 e=setup();services.Club.search=()=>observed({success:false,status:400});const failure=await eaOperation('galleryBuyOne',{player,maxPrice:650,remaining:650});assert.equal(failure.purchaseAttempted,false);assert.equal(failure.stage,'gallery-club');assert.equal(e.events.some(e=>e[0]==='buy'),false);
});
