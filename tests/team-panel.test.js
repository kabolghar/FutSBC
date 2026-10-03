import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('Team swap picker shows whole-team totals, replaces only after a successful check, and preserves suggestions on error',async()=>{
  const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
  const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import \{renderPortfolio\}.*\n/,'const renderPortfolio=()=>{};\n').replace(/^import .*\n/gm,'');
  const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'});
  const {window}=dom;const calls=[];let fail=false;
  const team={name:'Test XI',chemistry:30,balance:10000,players:[{index:0,position:'GK',name:'Current GK',definitionId:1,rating:82}],formation:'4-4-2'};
  const first={slotIndex:0,definitionId:2,assetId:2,name:'First suggestion',rating:84,price:2000,source:'FUT.GG',metaRank:2,slotChemistry:3,url:'https://www.fut.gg/players/2-first/27-2/'};
  const second={...first,definitionId:3,assetId:3,name:'Alternative keeper',price:1000};
  const result={team,results:[],source:'FUT.GG',checkedAt:Date.now(),cardsPriced:0,priceMode:'estimate',combinationsChecked:10,plan:{choices:[first],chemistry:33,cost:2000,remaining:8000}};
  window.chrome={runtime:{id:'test',sendMessage:async message=>{
    calls.push(message);
    if(message.type==='cardArt')return {ok:true,data:{imageURL:'https://game-assets.fut.gg/test-card.webp',pageURL:'https://www.fut.gg/players/2/27-2/'}};
    if(message.type==='teamAlternatives')return {ok:true,data:{slotIndex:0,alternatives:[{card:second,chemistry:29,cost:1000,remaining:9000}]}};
    if(message.type==='teamApply')return {ok:true,data:{...result,applied:true}};
    if(message.type==='teamSwap')return fail?{ok:false,error:'Your squad changed.'}:{ok:true,data:{...result,plan:{...result.plan,choices:[second],cost:1000,remaining:9000}}};
    return {ok:true,data:{}};
  }},storage:{onChanged:{addListener(){}}}};
  try{
  window.eval(script+`\nteam=${JSON.stringify(team)};teamSelected=new Set([0]);teamResult=${JSON.stringify(result)};renderTeam();`);
  await new Promise(resolve=>setImmediate(resolve));
  const document=window.document;
  assert(document.querySelector('.team-lineup-art').classList.contains('has-art'));
  assert.match(document.querySelector('.team-lineup-art').style.backgroundImage,/test-card.webp/);
  assert(document.querySelector('.team-swap-button svg'));
  assert(document.querySelector('.team-lineup').classList.contains('is-pitch'));
  document.querySelector('.lineup-toolbar .layout-switch button:last-child').click();
  assert.equal(document.querySelector('.team-lineup').classList.contains('is-pitch'),false);
  assert.match(document.querySelector('.team-lineup-card').textContent,/First suggestion/,'changing view preserves the plan');
  document.querySelector('.lineup-toolbar .layout-switch button:first-child').click();
  assert.equal(document.querySelectorAll('.team-lineup .chemistry-marks .filled').length,3);
  assert.equal(calls.filter(call=>call.type==='teamRecommend'||call.type==='teamApply').length,0,'view switches never rebuild or apply');
  assert.equal(document.querySelector('.team-swap-button').textContent,'');
  assert.match(document.querySelector('.team-swap-button').getAttribute('aria-label'),/Find alternatives/);
  document.querySelector('.team-swap-button').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(document.querySelector('.team-swap-options').textContent,/Alternative keeper/);
  assert(document.querySelector('.team-swap-choice .team-lineup-art.has-art'));
  assert.match(document.querySelector('.team-swap-options').textContent,/−1,000 coins vs current pick/);
  assert.match(document.querySelector('.team-swap-options').textContent,/Squad chemistry 29\/33 \(−4\)/);
  fail=true;document.querySelector('.team-swap-options button').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(document.querySelector('.team-lineup-card').textContent,/First suggestion/);
  assert.match(document.getElementById('team-error').textContent,/squad changed/);
  fail=false;document.querySelector('.team-swap-options button').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(document.querySelector('.team-lineup-card').textContent,/Alternative keeper/);
  assert.equal(document.querySelector('.team-swap-options'),null);
  assert.deepEqual(Object.keys(calls.find(call=>call.type==='teamSwap')).sort(),['definitionId','planId','slotIndex','type']);
  assert(document.querySelector('.team-lineup-actions .team-swap-button'));
  document.getElementById('team-apply').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(document.getElementById('team-apply').disabled,true);
  assert.match(document.getElementById('team-apply').textContent,/added/);
  assert.equal(calls.filter(call=>call.type==='teamApply').length,1);
  }finally{dom.window.close();}
});

test('building a team prefetches swaps once, prioritizes an opened slot, and reuses ready results',async()=>{
  const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
  const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import \{renderPortfolio\}.*\n/,'const renderPortfolio=()=>{};\n').replace(/^import .*\n/gm,'');
  const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'});
  const {window}=dom,calls=[],waiting=[];
  const players=Array.from({length:3},(_,index)=>({index,position:['GK','RB','CB'][index],name:`Current ${index}`,definitionId:index+1,rating:80}));
  const choices=players.map(player=>({...player,slotIndex:player.index,definitionId:player.index+10,assetId:player.index+10,price:1000,source:'FUT.GG',metaRank:1,slotChemistry:3,url:'https://www.fut.gg/players/'}));
  const team={name:'XI',formation:'4-4-2',balance:10000,players},result={planId:'prefetch-plan',team,checkedAt:Date.now(),plan:{choices,cost:3000,chemistry:30,remaining:7000}};
  window.chrome={runtime:{id:'test',sendMessage:async message=>{
    calls.push(message);
    if(message.type==='teamSnapshot')return {ok:true,data:team};
    if(message.type==='teamRecommend')return {ok:true,data:result};
    if(message.type==='teamApply')return {ok:true,data:{...result,applied:true}};
    if(message.type==='teamAlternatives')return await new Promise(resolve=>waiting.push({message,resolve}));
    if(message.type==='cardArt')return {ok:false,error:'Unavailable'};
    return {ok:true,data:{}};
  }},storage:{onChanged:{addListener(){}}}};
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const finish=()=>{const task=waiting.shift();task.resolve({ok:true,data:{slotIndex:task.message.slotIndex,alternatives:[{card:{...choices[task.message.slotIndex],name:'Cached alternative'},cost:2500,chemistry:29}]}});};
  try{
    window.eval(script+`\nteam=${JSON.stringify(team)};teamSelected=new Set([0,1,2]);void findTeam();`);
    await tick();
    assert.equal(window.document.getElementById('team-editor').open,false,'successful build folds setup away');
    const firstInput=window.document.querySelector('#team-players input');
    assert.equal(window.document.querySelector('.team-player-copy').htmlFor,firstInput.id,'player label toggles its own position');
    const buttons=()=>window.document.querySelectorAll('.team-swap-button');
    assert.equal(waiting.length,1);assert.equal(waiting[0].message.slotIndex,0,'starts after building without opening Swap');
    buttons()[0].click();await tick();
    assert.match(window.document.querySelector('.team-swap-options').textContent,/Checking fresh alternatives/);
    assert.equal(calls.filter(call=>call.type==='teamAlternatives').length,1,'opening an in-flight slot must not duplicate the request');
    buttons()[2].click();await tick();finish();await tick();
    assert.equal(waiting[0].message.slotIndex,2,'the visible slot takes priority over the remaining queue');
    finish();await tick();assert.equal(waiting[0].message.slotIndex,1);
    assert.match(window.document.querySelector('.team-swap-options').textContent,/Cached alternative/);
    finish();await tick();
    const count=calls.filter(call=>call.type==='teamAlternatives').length;
    buttons()[0].click();await tick();
    assert.match(window.document.querySelector('.team-swap-options').textContent,/Cached alternative/);
    assert.equal(calls.filter(call=>call.type==='teamAlternatives').length,count,'ready results open without fetching again');
    window.eval('startTeamPrefetch();');await tick();
    window.document.getElementById('team-budget').dispatchEvent(new window.Event('change'));finish();await tick();
    assert.equal(waiting.length,0,'changing the team discards the old queue and stale response');
    assert.equal(window.document.querySelector('.team-swap-options'),null);
    window.eval('void findTeam();');await tick();
    window.document.getElementById('team-apply').click();await tick();
    assert.equal(calls.filter(call=>call.type==='teamApply').length,0,'adding waits for the active read to finish');
    assert(calls.some(call=>call.type==='teamCancel'),'adding actively cancels the running recommendation search');
    finish();await tick();
    assert.equal(calls.filter(call=>call.type==='teamApply').length,1);
    assert.equal(waiting.length,0,'adding cancels the rest of the background queue');
    window.eval('void findTeam();');await tick();
    waiting.shift().resolve({ok:false,error:'EA could not authenticate this request (401).'});await tick();
    assert.equal(waiting.length,0,'authentication rejection stops the prefetch queue');
  }finally{dom.window.close();}
});

test('EA-added concepts are detected and removed from replacement selection',async()=>{
  const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
  const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import \{renderPortfolio\}.*\n/,'const renderPortfolio=()=>{};\n').replace(/^import .*\n/gm,'');
  const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'});
  const original={fingerprint:'empty',players:[{index:0,position:'CAM',definitionId:0,name:'Open position'}],balance:10000};
  let current={...original,fingerprint:'messi',players:[{index:0,position:'CAM',definitionId:158023,assetId:158023,rating:85,name:'Messi',concept:true}]};
  dom.window.chrome={runtime:{id:'test',sendMessage:async message=>({ok:true,data:message.type==='teamSnapshot'?current:{}})},storage:{onChanged:{addListener(){}}}};
  try{
    dom.window.eval(script+`\nteam=${JSON.stringify(original)};teamSelected=new Set([0]);activeView='team';renderTeam();`);
    await dom.window.syncTeam();
    assert.match(dom.window.document.querySelector('#team-players').textContent,/Messi · CONCEPT/);
    assert.equal(dom.window.document.querySelector('#team-players input').checked,false);
    const checkbox=dom.window.document.querySelector('#team-players input');checkbox.click();
    await dom.window.syncTeam();
    assert.equal(dom.window.document.querySelector('#team-players input').checked,true,'an explicit choice to replace a known concept is retained');
  }finally{dom.window.close();}
});

test('menu picker selects an exact version and sends a locked pick without editing EA',async()=>{
 const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
 const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import \{renderPortfolio\}.*\n/,'const renderPortfolio=()=>{};\n').replace(/^import .*\n/gm,'');
 const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'}),calls=[];
 const team={fingerprint:'unchanged',balance:10000,players:[{index:0,position:'CAM',definitionId:0,name:'Open position'}]};
 const card={definitionId:158023,assetId:158023,name:'Messi',rating:85,position:'CAM',rarity:1};
 dom.window.chrome={runtime:{id:'test',sendMessage:async message=>{calls.push(message);return {ok:true,data:message.type==='teamSnapshot'?team:message.type==='teamPlayerSearch'?{cards:[card]}:message.type==='teamRecommend'?{team,checkedAt:Date.now(),results:[],plan:null}:{}};}},storage:{onChanged:{addListener(){}}}};
 try{
  dom.window.eval(script+`\nteam=${JSON.stringify(team)};teamSelected=new Set([0]);renderTeam();`);
  dom.window.document.querySelector('.team-choose-player').click();
  dom.window.document.querySelector('#team-picker-query').value='Messi';await dom.window.searchTeamPicker();
  assert.match(dom.window.document.querySelector('#team-picker-results').textContent,/Messi/);
  dom.window.document.querySelector('.team-picker-card').click();
  assert.match(dom.window.document.querySelector('#team-players').textContent,/Messi · CHOSEN/);
  assert.equal(dom.window.document.querySelector('#team-players input').checked,false);
  assert.equal(dom.window.document.querySelector('#team-find').disabled,false,'chosen-only teams may be built');
  await dom.window.findTeam();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call=>call.type==='teamRecommend').picks)),[{slotIndex:0,definitionId:158023}]);
  assert.equal(calls.some(call=>call.type==='teamApply'),false);
 }finally{dom.window.close();}
});

 test('future budget exceeds balance and shows the actual lineup shortfall',async()=>{
 const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
 const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import \{renderPortfolio\}.*\n/,'const renderPortfolio=()=>{};\n').replace(/^import .*\n/gm,'');
 const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'});
 dom.window.chrome={runtime:{id:'test',sendMessage:async()=>({ok:true,data:{}})},storage:{onChanged:{addListener(){}}}};
 try{
 dom.window.eval(script+`\nteam={balance:10000,players:[]};teamSelected=new Set([0]);window.showFutureResult=()=>{teamResult={checkedAt:Date.now(),plan:{choices:[],cost:80000,remaining:20000,chemistry:28,chemistryTradeoff:true,baselineChemistry:33,targetChemistry:33}};renderTeam();};`);
 const doc=dom.window.document;doc.getElementById('team-budget').value='custom';doc.getElementById('team-budget').dispatchEvent(new dom.window.Event('change'));
 assert.equal(doc.getElementById('team-custom-budget').hidden,false);
 doc.getElementById('team-custom-budget').value='100000';dom.window.renderTeam();
 assert.equal(dom.window.teamBudget(),100000);assert.match(doc.getElementById('team-allowance').textContent,/100,000 coins/);
 dom.window.showFutureResult();
 assert.match(doc.getElementById('team-results').textContent,/Coins needed: 70,000 more/);
 assert.match(doc.querySelector('.team-plan-summary').textContent,/20,000/);
 assert.match(doc.getElementById('team-results').textContent,/Chemistry trade-off: 33 → 28\/33/);
 await new Promise(resolve=>setImmediate(resolve));
 }finally{dom.window.close();}
 });

test('squad review labels unknown evidence, selects measured declines and discloses supporting changes',async()=>{
  const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
  const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import \{renderPortfolio\}.*\n/,'const renderPortfolio=()=>{};\n').replace(/^import .*\n/gm,'');
  const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'}),{window}=dom,calls=[];
  const players=[{index:0,position:'ST',name:'Current striker',definitionId:1,rating:85},{index:1,position:'CM',name:'Current midfielder',definitionId:2,rating:84}];
  const team={name:'XI',fingerprint:'review',chemistry:30,balance:10000,players};
  const choices=players.map(p=>({...p,slotIndex:p.index,name:'New '+p.position,price:1000,slotChemistry:3,source:'FUT.GG',metaRank:3}));
  const result={team,checkedAt:Date.now(),supportChanges:[{slotIndex:1,before:players[1],after:choices[1]}],plan:{baselineChemistry:30,chemistry:33,cost:2000,remaining:8000,choices}};
  const review={fingerprint:'review',checkedAt:Date.now(),suggestedSlots:[0],rows:players.map((p,i)=>({...p,price:i?null:8000,priceSource:'fodder.gg',rank:null,netSaleEstimate:null,signals:i?[]:[{kind:'price',label:'Price down 20%',since:Date.now()-86400000}]}))};
  window.chrome={runtime:{id:'review-test',sendMessage:async m=>{calls.push(m);return {ok:true,data:m.type==='teamSnapshot'?team:m.type==='teamReview'?review:m.type==='teamRecommend'?result:{}};}},storage:{onChanged:{addListener(){}}}};
  try{
    window.eval(script+`\nteam=${JSON.stringify(team)};renderTeam();`);
    window.document.getElementById('team-review').click();await new Promise(r=>setImmediate(r));
    assert.match(window.document.getElementById('team-review-list').textContent,/Price down 20%/);
    assert.match(window.document.getElementById('team-review-list').textContent,/Price unavailable/);
    assert.equal(window.document.getElementById('team-review-upgrade').hidden,false);
    window.document.getElementById('team-review-upgrade').click();await new Promise(r=>setImmediate(r));
    const request=calls.find(m=>m.type==='teamRecommend');assert.deepEqual(Array.from(request.slots),[0]);assert.equal(request.allowSupport,true);
    assert.match(window.document.querySelector('.team-support-note').textContent,/Current midfielder → New CM/);
    assert.match(window.document.querySelector('.team-support-note').textContent,/30 → 33/);
    assert.equal(window.document.querySelector('.team-plan-failure'),null,'a supporting slot cannot distort requested coverage');
    assert(calls.every(m=>m.type!=='teamApply'),'review never automatically applies or sells cards');
  }finally{dom.window.close();}
});
