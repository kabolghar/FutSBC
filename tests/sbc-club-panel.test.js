import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('club result is labeled as owned, hides buying and leaves submission in EA',async()=>{
 const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
 const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import \{renderPortfolio\}.*\n/,'const renderPortfolio=()=>{};\n').replace(/^import .*\n/gm,'');
 const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'});
 try{
  dom.window.eval(script+`\nstate={challenge:{id:49,name:'Challenge 2',slots:[{index:0,position:'CM'}]},plan:{source:'club',name:'Challenge 2',total:0,checks:45,checkedAt:Date.now(),players:[{name:'Owned card',baseId:100,definitionId:100,ownedId:123,owned:true,price:0,rating:61,position:'CM'}]},inserted:true,approved:true};render();window.showLoading=()=>{state.sbcBuildRunning=true;state.progress='Checking EA listings · search 5/24';busy=true;render();};window.showHybrid=()=>{state.plan.source='hybrid';state.plan.players[0].owned=false;state.plan.players[0].price=200;state.plan.total=200;render();};`);
  const doc=dom.window.document;
  assert.match(doc.getElementById('price-label').textContent,/CLUB BUILD/);
  assert.match(doc.getElementById('coverage').textContent,/45 combinations checked/);
  assert.match(doc.getElementById('build-status').textContent,/review and submit in EA/);
  assert.match(doc.getElementById('players').textContent,/IN CLUB/);
  assert.equal(doc.getElementById('buy-section').hidden,true);
  assert.equal(doc.getElementById('complete').hidden,true);
  assert.equal(doc.getElementById('club-build').disabled,false);
  dom.window.showHybrid();
  assert.match(doc.getElementById('price-label').textContent,/CLUB \+ MARKET/);
  assert.equal(doc.getElementById('buy-section').hidden,false);
  assert.equal(doc.getElementById('hybrid-build').disabled,false);
  dom.window.showLoading();assert.equal(doc.getElementById('sbc-build-stop').hidden,false);assert.equal(doc.getElementById('sbc-build-stop').disabled,false);
 }finally{dom.window.close();}
});

test('finish settings and an owned-card swap send rating limits and exclusions',async()=>{
 const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
 const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import \{renderPortfolio\}.*\n/,'const renderPortfolio=()=>{};\n').replace(/^import .*\n/gm,'');
 const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'});
 try{
  dom.window.eval(script+`\nstate={challenge:{id:49,name:'Test SBC',slots:[{index:0,position:'CM',name:'Keep me',definitionId:101,rating:81},{index:1,position:'ST',name:'Leave me out',definitionId:102,rating:84}]},plan:{source:'hybrid',repair:true,kept:1,changes:1,name:'Test SBC',total:0,checks:5,checkedAt:Date.now(),players:[{name:'Keep me',baseId:101,definitionId:101,ownedId:1,owned:true,price:0,rating:81,position:'CM'}]},inserted:true,approved:true};run=async(type,extra)=>{window.sent={type,extra};};render();`);
  const doc=dom.window.document;
  assert.match(doc.getElementById('build-status').textContent,/1 kept · 1 replaced/);
  assert.equal(doc.getElementById('buy-section').hidden,true,'fully owned completion does not offer buying');
  doc.getElementById('repair-rating').value='78';doc.getElementById('repair-rating').dispatchEvent(new dom.window.Event('change'));
  const excluded=doc.querySelectorAll('#repair-exclusions input')[1];excluded.checked=true;excluded.dispatchEvent(new dom.window.Event('change'));
  doc.getElementById('repair-build').click();
  assert.equal(dom.window.sent.type,'repairBuild');assert.equal(dom.window.sent.extra.maxRating,78);
  assert.deepEqual([...dom.window.sent.extra.excludedDefinitionIds],[102]);
  const swap=doc.querySelector('#players .player-actions button');
  assert.equal(swap.querySelector('svg')!==null,true);swap.click();
  assert.equal(dom.window.sent.type,'repairBuild');assert.deepEqual([...dom.window.sent.extra.excludedDefinitionIds],[102,101]);
 }finally{dom.window.close();}
});
