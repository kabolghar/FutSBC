import test from 'node:test';
import assert from 'node:assert/strict';
import {eaOperation} from '../extension/ea.js';
function setup(){
 const slots=Array.from({length:11},(_,index)=>({index,generalPositionName:index===0?'CAM':'CM',item:{id:0,definitionId:0,isValid:()=>false}}));
 const squad={getPlayers:()=>slots,getFormation:()=>({displayName:'4-5-1'}),getChemistry:()=>0};
 const cards=[{definitionId:158023,assetId:158023,name:'Messi',rating:85,concept:true,basePossiblePositions:[18]}, {definitionId:16935239,assetId:158023,name:'Messi',rating:90,concept:true,basePossiblePositions:[18],rareflag:3}, {definitionId:20,assetId:20,name:'Julián Álvarez',rating:84,concept:true,basePossiblePositions:[14]}, {definitionId:21,assetId:21,name:'Messi Other',rating:80,concept:true,basePossiblePositions:[25]}];
 const queries=[];
 globalThis.window={fut_year:'2027'};globalThis.GameCurrency={COINS:1};globalThis.SearchType={PLAYER:1};globalThis.UTSearchCriteriaDTO=class{};
 globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>({_squad:squad})})})})});
 globalThis.repositories={Item:{getStaticData:()=>[{id:158023,commonName:'Messi',firstName:'Lionel',lastName:'Messi'},{id:20,firstName:'Julián',lastName:'Álvarez'},{id:21,name:'Messi Other'}]}};
 globalThis.services={User:{getUser:()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})}),getCurrency:()=>({amount:10000})})},Item:{searchConceptItems:criteria=>{queries.push(criteria);return {observe(owner,fn){queueMicrotask(()=>fn(this,{success:true,response:{items:cards,endOfList:true}}));},unobserve(){}};}}};
 return {slots,queries};
}
test('menu search uses EA names and returns distinct eligible versions without editing the squad',async()=>{
 const {slots,queries}=setup(),before=slots.map(slot=>slot.item),snapshot=await eaOperation('teamSnapshot');
 const found=await eaOperation('teamPlayerSearch',{slotIndex:0,query:'Lionel Messi',fingerprint:snapshot.fingerprint});
 assert.equal(found.ok,true,found.error);assert.deepEqual(found.cards.map(card=>card.definitionId),[16935239,158023]);
 assert.deepEqual(queries[0].defId,[158023]);assert.deepEqual(slots.map(slot=>slot.item),before);
 const accent=await eaOperation('teamPlayerSearch',{slotIndex:1,query:'Julian Alvarez',fingerprint:snapshot.fingerprint});assert.equal(accent.cards[0].assetId,20);
 const none=await eaOperation('teamPlayerSearch',{slotIndex:0,query:'Julian',fingerprint:snapshot.fingerprint});assert.deepEqual(none.cards,[]);
 const changed=await eaOperation('teamPlayerSearch',{slotIndex:0,query:'Messi',fingerprint:'old'});assert.equal(changed.ok,false);assert.match(changed.error,/squad changed/);
});
