import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('buying recovery is visible without a saved SBC, and clearing refreshes the screen',async()=>{
 const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
 const script=(await readFile(new URL('../extension/panel.js',import.meta.url),'utf8')).replace(/^import \{renderPortfolio\}.*\n/,'const renderPortfolio=()=>{};\n').replace(/^import .*\n/gm,'');
 const dom=new JSDOM(html,{url:'https://extension.test/panel.html',runScripts:'outside-only'});
 let buy={enabled:false,review:true,pending:{name:'Player'},status:'Purchase needs review.'};const calls=[];
 dom.window.chrome={runtime:{id:'test',sendMessage:async message=>{calls.push(message.type);if(message.type==='sbcBuyReset'){buy={enabled:false};return {ok:true,data:buy};}return {ok:true,data:message.type==='sbcBuyState'?buy:{}};}},storage:{onChanged:{addListener(){}}}};
 try{
  dom.window.eval(script);await new Promise(resolve=>setImmediate(resolve));
  const doc=dom.window.document;assert.equal(doc.getElementById('result').hidden,true);
  assert.equal(doc.getElementById('buy-recovery').hidden,false);
  assert.equal(doc.getElementById('buy-recovery-clear').hidden,false);
  doc.getElementById('buy-recovery-clear').click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(doc.getElementById('buy-recovery').hidden,true);assert(calls.includes('sbcBuyReset'));
 }finally{dom.window.close();}
});
