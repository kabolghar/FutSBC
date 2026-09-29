import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('Team swap picker shows whole-team totals, replaces only after a successful check, and preserves suggestions on error',async()=>{
  const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
  const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');
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
  const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');
  const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'});
  const {window}=dom,calls=[],waiting=[];
  const players=Array.from({length:3},(_,index)=>({index,position:['GK','RB','CB'][index],name:`Current ${index}`,definitionId:index+1,rating:80}));
  const choices=players.map(player=>({...player,slotIndex:player.index,definitionId:player.index+10,assetId:player.index+10,price:1000,source:'FUT.GG',metaRank:1,slotChemistry:3,url:'https://www.fut.gg/players/'}));
  const team={name:'XI',formation:'4-4-2',balance:10000,players},result={planId:'prefetch-plan',team,checkedAt:Date.now(),plan:{choices,cost:3000,chemistry:30,remaining:7000}};
  window.chrome={runtime:{id:'test',sendMessage:async message=>{
    calls.push(message);
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
    finish();await tick();
    assert.equal(calls.filter(call=>call.type==='teamApply').length,1);
    assert.equal(waiting.length,0,'adding cancels the rest of the background queue');
    window.eval('void findTeam();');await tick();
    waiting.shift().resolve({ok:false,error:'EA could not authenticate this request (401).'});await tick();
    assert.equal(waiting.length,0,'authentication rejection stops the prefetch queue');
  }finally{dom.window.close();}
});
