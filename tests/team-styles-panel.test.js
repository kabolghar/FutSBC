import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM} from 'jsdom';
test('selected-player styles show owned alternatives and only apply on an explicit click',async()=>{
 const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');const script='const renderPortfolio=()=>{};\n'+(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'');
 const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'});const calls=[];let applied=false;
 const player={slotIndex:0,itemId:'100',definitionId:10,assetId:10,name:'Selected forward',rating:88,position:'ST',chemistry:3,currentStyle:250,currentName:'Basic',options:[{styleId:266,name:'Hunter',owned:2,focus:['PAC','SHO']},{styleId:250,name:'Basic',owned:0,current:true,focus:['PAC']}]};
 dom.window.chrome={runtime:{id:'test',sendMessage:async message=>{calls.push(message);if(message.type==='teamStyles')return {ok:true,data:{fingerprint:'f',players:[applied?{...player,currentStyle:266,currentName:'Hunter',options:[{...player.options[0],current:true,owned:1}]}:player]}};if(message.type==='teamStyleApply'){applied=true;return {ok:true,data:{applied:true}};}return {ok:true,data:{}};}},storage:{onChanged:{addListener(){}}}};
 try{dom.window.eval(script+`\nteam={name:'Squad',fingerprint:'f',balance:10000,players:[{index:0,definitionId:10,rating:88,name:'Selected forward',position:'ST'}]};teamSelected=new Set([0]);renderTeam();`);const doc=dom.window.document;doc.getElementById('team-styles').click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(doc.getElementById('team-style-panel').hidden,false);assert.match(doc.getElementById('team-style-list').textContent,/Hunter.*2 owned/s);assert.equal(calls.filter(call=>call.type==='teamStyleApply').length,0);
 doc.querySelector('.style-player button').click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.filter(call=>call.type==='teamStyleApply').length,1);assert.equal(calls.find(call=>call.type==='teamStyleApply').itemId,'100');assert.match(doc.getElementById('team-style-status').textContent,/Hunter applied/);assert.equal(doc.querySelector('.style-player button').disabled,true);
 }finally{dom.window.close();}
});
