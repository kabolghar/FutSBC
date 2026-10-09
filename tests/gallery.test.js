import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {readGalleryLoader,galleryURL,galleryPlan,galleryCaps,galleryDirectory} from '../extension/gallery-data.js';
import {createGalleryCollector,GALLERY_KEY,GALLERY_ALARM} from '../extension/gallery-workflow.js';
const sample=JSON.parse(readFileSync(new URL('./fixtures/gallery-rayo.json',import.meta.url))),url='https://www.fut.gg/fut-gallery/laliga/rayo-vallecano/';
const data=()=>({...structuredClone(sample),solution:{...structuredClone(sample.solution),computedAt:new Date().toISOString()}});
const html=object=>`<title>FC 27 Gallery</title><script>l:$R[1]=${JSON.stringify(object)}</script>`;

test('Gallery literal reader decodes references, numeric keys and null without executing scripts',()=>{
 const decoded=readGalleryLoader('<title>FC 27</title>l:$R[1]={set:$R[2]={id:91,clubEaId:null},same:$R[2],flags:[!0,!1],counts:{91:15}};alert(1)');
 assert.equal(decoded.set.clubEaId,null);assert.equal(decoded.set,decoded.same);assert.deepEqual(decoded.flags,[true,false]);assert.equal(decoded.counts[91],15);
 globalThis.galleryInjected=false;assert.throws(()=>readGalleryLoader('<title>FC 27</title>l:$R[1]={set:(globalThis.galleryInjected=true)}'),/unsupported/);assert.equal(globalThis.galleryInjected,false);
 assert.throws(()=>readGalleryLoader('<title>FC 27</title>l:$R[1]={__proto__:{polluted:true}}'),/unsafe/);
 assert.throws(()=>readGalleryLoader('<title>FC 26</title>l:$R[1]={}'),/FC 27/);
});
test('Gallery uses the actual complete grade lineup, card pictures and console estimates',()=>{
 const plan=galleryPlan(readGalleryLoader(html(data())),url,'D');assert.equal(plan.players.length,15);assert.equal(plan.estimatedTotal,8450);assert.equal(plan.players[0].name,'Álvaro García');assert.match(plan.players[0].picture,/2027\/futgg-player-item-card/);assert.equal(plan.grade,'D');
 const broken=data();broken.solution.costTiers[0].items.pop();assert.throws(()=>galleryPlan(broken,url,'D'),/complete/);
 const wrong=data();wrong.solution.costTiers[0].items[0].clubEaId=999;assert.throws(()=>galleryPlan(wrong,url),/club/);
 const noPrice=data();noPrice.solution.costTiers[0].items[0].price=null;assert.throws(()=>galleryPlan(noPrice,url),/prices/);
 const stale=data();stale.solution.computedAt='2026-01-01';assert.throws(()=>galleryPlan(stale,url),/stale/);
 const loan=data();loan.lineupCards[0].loanDuration=7;assert.throws(()=>galleryPlan(loan,url,'S'),/ineligible/);
 const lower=data(),details=lower.lineupCards;lower.lineupCards=[];assert.throws(()=>galleryPlan(lower,url),/incomplete/);assert.equal(galleryPlan(lower,url,'D',Date.now(),details).players.length,15);
 const conflict=structuredClone(details);conflict.find(c=>c.eaId===lower.solution.costTiers[0].items[0].eaId).playerEaId=999;assert.throws(()=>galleryPlan(lower,url,'D',Date.now(),conflict),/disagree/);
 assert.throws(()=>galleryURL('https://evil.test/fut-gallery/laliga/rayo-vallecano/'));assert.throws(()=>galleryURL(url+'?token=x'));
 const sets=galleryDirectory({listing:{categories:[{name:'LALIGA',slug:'laliga',sets:[sample.set]}]}});assert.equal(sets[0].url,url);
});
test('Gallery price caps never treat missing prices as free or exceed the approved budget',()=>{
 const plan=galleryPlan(data(),url);plan.players[0].phase='owned';
 const missing=galleryCaps(plan,8000);assert.equal(missing.length,14);assert.throws(()=>galleryCaps(plan,100),/exceed/);assert.throws(()=>galleryCaps(plan,8000,{[plan.players[1].definitionId]:0}),/valid maximum/);
});
function environment(){
 const store={},scheduled=[],calls=[];let owned=[],blocked=false,buyResult={phase:'in-club',price:650,balance:19350},connectHook,snapshot,provider=data();
 const collector=createGalleryCollector({storage:{get:async key=>({[key]:store[key]}),set:async next=>Object.assign(store,structuredClone(next))},alarms:{create:async(name,args)=>scheduled.push({name,args}),clear:async()=>{}},available:async()=>{if(blocked)throw Error('Trading is running.');},connect:async()=>{await connectHook?.();return {accountKey:'2027:1:console',tabId:1,balance:20000};},fetcher:async request=>({ok:true,text:async()=>html(request==='https://www.fut.gg/fut-gallery/'?{listing:{categories:[{name:'LALIGA',slug:'laliga',sets:[sample.set]}]}}:provider)}),ea:async(tab,action,payload)=>{calls.push({action,payload});if(action==='galleryPaletools')return snapshot;if(action==='galleryOwnership')return {owned,balance:20000};return typeof buyResult==='function'?buyResult(payload):buyResult;}});
 return {collector,store,scheduled,calls,setOwned:ids=>owned=ids,block:()=>blocked=true,buy:value=>buyResult=value,onConnect:hook=>connectHook=hook,paletools:value=>snapshot=value,provider:value=>provider=value};
}
test('Paletools supplies omitted lower-grade card details without market searches or invented prices',async()=>{
 const e=environment(),provider=data();e.paletools({accountKey:'2027:1:console',setId:sample.set.id,requiredCards:sample.set.requiredCards,name:sample.set.name,grades:sample.set.grades,collected:[],cards:provider.lineupCards});provider.lineupCards=[];e.provider(provider);
 const plan=await e.collector.fromPaletools('D');assert.equal(plan.estimatedTotal,8450);assert.equal(plan.players.length,15);const requests=e.calls.filter(c=>c.action==='galleryPaletools');assert.equal(requests.length,2);assert.equal(requests[1].payload.setId,sample.set.id);assert.equal(requests[1].payload.definitionIds.length,15);assert.equal(e.calls.some(c=>/market|Buy/.test(c.action)),false);
});
test('Paletools imports the exact open set and account-scoped collection before preparing missing cards',async()=>{
 const e=environment(),first=sample.solution.costTiers[0].items[0].eaId,second=sample.solution.costTiers[0].items[1].eaId;
 e.paletools({accountKey:'2027:1:console',setId:sample.set.id,requiredCards:sample.set.requiredCards,name:sample.set.name,grades:sample.set.grades,collected:[first]});e.setOwned([second]);
 const plan=await e.collector.fromPaletools('D');assert.equal(plan.setId,sample.set.id);assert.equal(plan.collectionSource,'Paletools');assert.equal(plan.players[0].phase,'collected');assert.equal(plan.players[1].phase,'owned');assert.equal(e.store['futsbc-gallery-collected:2027:1:console'][first].source,'paletools');assert.equal(e.calls.some(c=>c.action==='galleryBuyOne'),false);
});
test('Paletools rejects account, set and grade mismatches without saving or buying',async()=>{
 const e=environment(),valid={accountKey:'2027:1:console',setId:sample.set.id,requiredCards:sample.set.requiredCards,name:sample.set.name,grades:sample.set.grades,collected:[10]};
 e.paletools({...valid,accountKey:'2027:2:console'});await assert.rejects(()=>e.collector.fromPaletools('D'),/EA club/);
 e.paletools({...valid,setId:999});await assert.rejects(()=>e.collector.fromPaletools('D'),/No priced Gallery plan/);
 e.paletools({...valid,grades:[{name:'D',threshold:999}]});await assert.rejects(()=>e.collector.fromPaletools('D'),/disagree/);
 assert.deepEqual(e.store,{});assert.equal(e.calls.some(c=>c.action==='galleryBuyOne'),false);
});
test('Gallery prepares without buying, skips owned and remembered cards, and scopes history to the account',async()=>{
 const e=environment();const first=sample.solution.costTiers[0].items[0].eaId;e.setOwned([first]);let plan=await e.collector.prepare(url,'D');assert.equal(plan.players[0].phase,'owned');assert.equal(e.calls.some(c=>c.action==='galleryBuyOne'),false);
 const second=plan.players[1].definitionId;await e.collector.mark(second,true);e.setOwned([]);plan=await e.collector.prepare(url,'D');assert.equal(plan.players[0].phase,'collected');assert.equal(plan.players[1].phase,'collected');assert.ok(e.store['futsbc-gallery-collected:2027:1:console']);assert.equal(e.store['futsbc-gallery-collected:2027:2:console'],undefined);
});
test('Gallery queue checks spending limits, stops between cards and preserves collection',async()=>{
 const e=environment();const plan=await e.collector.prepare(url,'D');await assert.rejects(()=>e.collector.start(100,{},plan.id),/exceed/);await e.collector.start(8450,{},plan.id);assert.equal(e.scheduled[0].name,GALLERY_ALARM);
 await e.collector.run();let state=await e.collector.state();assert.equal(state.spent,650);assert.equal(state.queue.length,14);assert.equal(state.players[0].phase,'in-club');assert.equal(e.calls.at(-1).payload.remaining,8450);
 await e.collector.stop();await e.collector.run();assert.equal(e.calls.filter(c=>c.action==='galleryBuyOne').length,1);assert.ok(e.store['futsbc-gallery-collected:2027:1:console'][plan.players[0].definitionId]);
});
test('Gallery never retries an uncertain purchase and requires positive club evidence to recover',async()=>{
 const e=environment();const plan=await e.collector.prepare(url,'D');e.buy({phase:'uncertain',warning:'Check New Items'});await e.collector.start(8450,{},plan.id);await e.collector.run();await e.collector.run();assert.equal(e.calls.filter(c=>c.action==='galleryBuyOne').length,1);assert.ok((await e.collector.state()).pending);
 await assert.rejects(()=>e.collector.start(8450,{},plan.id),/pending/);await assert.rejects(()=>e.collector.recover(),/not confirmed/);e.setOwned([plan.players[0].definitionId]);await e.collector.recover();assert.equal((await e.collector.state()).pending,null);assert.equal((await e.collector.state()).players[0].phase,'owned');
});
test('Gallery restores pending intent without rebuying; pre-purchase read failures stay retryable',async()=>{
 const e=environment();const plan=await e.collector.prepare(url,'D');await e.collector.start(8450,{},plan.id);e.buy(()=>{const error=Error('Club read failed');error.purchaseAttempted=false;throw error;});await e.collector.run();assert.equal((await e.collector.state()).pending,null);
 e.store[GALLERY_KEY]={...e.store[GALLERY_KEY],enabled:true,pending:plan.players[0]};await e.collector.restore();assert.equal((await e.collector.state()).enabled,false);assert.ok((await e.collector.state()).pending);assert.match((await e.collector.state()).status,/interrupted/);
});
test('Gallery refuses a new collection while trading is running',async()=>{
 const e=environment();const plan=await e.collector.prepare(url,'D');e.block();await assert.rejects(()=>e.collector.start(8450,{},plan.id),/Trading/);assert.equal(e.calls.some(c=>c.action==='galleryBuyOne'),false);
});
test('Gallery stop during connection prevents a buy; stop during a buy finishes only that card',async()=>{
 const e=environment();const plan=await e.collector.prepare(url,'D');await e.collector.start(8450,{},plan.id);
 e.onConnect(()=>e.collector.stop());await e.collector.run();assert.equal(e.calls.some(c=>c.action==='galleryBuyOne'),false);assert.equal((await e.collector.state()).pending,null);
 e.onConnect(null);await e.collector.start(8450,{},plan.id);
 e.buy(async()=>{await e.collector.stop();return {phase:'in-club',price:650,balance:19350};});await e.collector.run();
 const stopped=await e.collector.state();assert.equal(stopped.enabled,false);assert.equal(stopped.pending,null);assert.equal(stopped.players[0].phase,'in-club');assert.equal(stopped.queue.length,14);
 await e.collector.run();assert.equal(e.calls.filter(c=>c.action==='galleryBuyOne').length,1);
});
test('Gallery finishes a queue with newly owned cards without charging estimates',async()=>{
 const e=environment();const plan=await e.collector.prepare(url,'D');await e.collector.start(8450,{},plan.id);e.buy({phase:'owned',balance:20000});
 for(let i=0;i<plan.players.length;i++)await e.collector.run();const state=await e.collector.state();assert.equal(state.enabled,false);assert.equal(state.pending,null);assert.equal(state.spent,0);assert.equal(state.queue.length,0);assert.match(state.status,/grade.*in-game/);
 await assert.rejects(()=>e.collector.start(0,{},plan.id),/already collected/);
});
test('Gallery preserves pending intent if a purchase response violates its approved cap',async()=>{
 const e=environment();const plan=await e.collector.prepare(url,'D');await e.collector.start(8450,{},plan.id);e.buy({phase:'in-club',price:150000,balance:0});await e.collector.run();
 const state=await e.collector.state();assert.equal(state.enabled,false);assert.ok(state.pending);assert.equal(state.spent,0);assert.match(state.status,/price needs review/);
});
