import test from 'node:test';
import assert from 'node:assert/strict';
import {eaOperation} from '../extension/ea.js';
const observed=result=>({observe(owner,callback){queueMicrotask(()=>callback(this,{success:true,...result}));},unobserve(){}});
function setup({concept=false,chemistry=3,fail=false,confirmed=true}={}){
 const item={id:100,assetId:10,definitionId:10,rating:88,name:'Forward',playStyle:250,concept,isValid:()=>true,isGK:()=>false,getAttributes:()=>[85,92,75,88,35,70]};
 const keeper={...item,id:101,assetId:11,definitionId:11,name:'Keeper',isGK:()=>true};
 const slots=[{index:0,item,generalPositionName:'ST',chemistry},{index:1,item:keeper,generalPositionName:'GK',chemistry}];
 const team={getPlayers:()=>slots,getFieldPlayers:()=>slots,getFormation:()=>({displayName:'4-4-2'}),isSBC:()=>false};
 // Active-team reader expects an eleven-slot squad; preserve real slot indices.
 for(let i=2;i<11;i++)slots.push({index:i,item:{isValid:()=>false},generalPositionName:'CM'});
 const styles=[{styleId:250,bars:[1,1,1,1,1,1],gk:[0,0,0,0,0,0]},{styleId:266,bars:[3,3,0,0,0,0],gk:[0,0,0,0,0,0]},{styleId:268,bars:[3,0,0,0,3,0],gk:[0,0,0,0,0,0]},{styleId:260,bars:[1,0,2,2,0,0],gk:[0,0,0,0,0,0]},{styleId:272,bars:[0,0,0,0,0,0],gk:[3,3,0,0,0,3]}];
 let calls=0;const inventory=[{id:500,subtype:266,stackCount:2,isStyleModifier:()=>true,canApplyTo:player=>!player.isGK()&&!player.concept&&player.playStyle!==266}];
 globalThis.window={fut_year:'2027'};globalThis.getAppMain=()=>({getRootViewController:()=>({getPresentedViewController:()=>({getCurrentViewController:()=>({getCurrentController:()=>({_squad:team}),pushViewController(){}})})})});
 globalThis.repositories={PlayStyle:{getPlayStyles:()=>styles,getPlayStyleBonusById:(id,gk)=>{const style=styles.find(style=>style.styleId===id);return gk?style.gk:style.bars;}}};
 globalThis.UTLocalizationUtil={playStyleIdToName:id=>({250:'Basic',266:'Hunter',268:'Shadow',260:'Engine',272:'Glove'}[id]||'Unknown')};globalThis.UTSearchCriteriaDTO=class{};globalThis.SearchType={CONSUMABLES_DEVELOPMENT:1};globalThis.SearchCategory={ANY:0};
 globalThis.services={Localization:{},User:{getUser:()=>({getSelectedPersona:()=>({getCurrentClub:()=>({isXbox:true})})})},Club:{search:criteria=>{assert.equal(criteria.type,1);return observed({response:{items:inventory}});}},Item:{applyTo:(card,target)=>{calls++;if(fail)return observed({success:false,status:429});card.stackCount--;if(confirmed)target.playStyle=card.subtype;return observed({});}}};
 return {item,slots,inventory,get calls(){return calls;}};
}
function fingerprint(slots){return slots.map(slot=>`${slot.index}:${slot.item?.definitionId||0}:${slot.item?.id||0}:${!!slot.item?.concept}:${slot.generalPositionName||''}`).join('|');}
async function recommend(env,indices=[0]){return eaOperation('teamStyles',{slots:indices,fingerprint:fingerprint(env.slots)});}
test('style ranking uses EA attribute categories, position and owned inventory; GK styles stay separate',async()=>{
 const env=setup();const result=await recommend(env,[0,1]);assert.equal(result.ok,true,result.error);
 assert.equal(result.players[0].options[0].name,'Hunter');assert.equal(result.players[0].options.find(row=>row.name==='Hunter').owned,2);assert.equal(result.players[0].currentName,'Basic');assert.equal(result.players[1].options[0].name,'Glove');assert.equal(env.calls,0);
});
test('an explicit apply consumes one owned style on the exact card and is idempotent',async()=>{
 const env=setup();const payload={slots:[0],slotIndex:0,itemId:'100',styleId:266,currentStyle:250,fingerprint:fingerprint(env.slots)};
 const result=await eaOperation('teamStyleApply',payload);assert.equal(result.ok,true,result.error);assert.equal(env.calls,1);assert.equal(env.inventory[0].stackCount,1);assert.equal(env.item.playStyle,266);
 const repeated=await eaOperation('teamStyleApply',{...payload,currentStyle:266});assert.equal(repeated.ok,true,repeated.error);assert.equal(repeated.applied,false);assert.equal(env.calls,1);
});
test('concepts, changed cards, incompatible styles and absent stock never apply',async()=>{
 for(const variant of ['concept','changed','incompatible','empty']){
  const env=setup({concept:variant==='concept'});if(variant==='empty')env.inventory[0].stackCount=0;
  const result=await eaOperation('teamStyleApply',{slots:[0],slotIndex:0,itemId:variant==='changed'?'999':'100',styleId:variant==='incompatible'?272:266,currentStyle:250,fingerprint:fingerprint(env.slots)});
  assert.equal(result.ok,false,variant);assert.equal(env.calls,0,variant);
 }
});
test('EA rejection or uncertain response is never retried automatically',async()=>{
 for(const args of [{fail:true},{confirmed:false}]){
  const env=setup(args);const result=await eaOperation('teamStyleApply',{slots:[0],slotIndex:0,itemId:'100',styleId:266,currentStyle:250,fingerprint:fingerprint(env.slots)});
  assert.equal(result.ok,false);assert.match(result.error,/Check|check/);assert.equal(env.calls,1);
  const retry=await eaOperation('teamStyleApply',{slots:[0],slotIndex:0,itemId:'100',styleId:266,currentStyle:250,fingerprint:fingerprint(env.slots)});assert.equal(retry.ok,false);assert.match(retry.error,/previous style application/);assert.equal(env.calls,1);
 }
});
test('zero chemistry and concepts can receive recommendations without consuming inventory',async()=>{
 const env=setup({chemistry:0,concept:true});const result=await recommend(env);assert.equal(result.ok,true,result.error);assert.equal(result.players[0].chemistry,0);assert.equal(result.players[0].concept,true);assert.equal(env.calls,0);
});
