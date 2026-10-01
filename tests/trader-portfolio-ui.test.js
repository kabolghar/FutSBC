import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderPortfolio} from '../extension/trader-portfolio-ui.js';
test('trade history shows losses, unverified states and treats player names as plain text',()=>{
 const dom=new JSDOM('<div id="portfolio"></div>');globalThis.document=dom.window.document;
 const root=document.getElementById('portfolio');
 renderPortfolio(root,{sales:1,realized:-83,maxDrawdown:83,inventoryCost:700,pending:1,unverified:1,averageSellMinutes:3,activity:[{name:'<img src=x onerror=alert(1)>',buy:700,sale:650,profit:-83,soldAt:1},{name:'Unknown',buy:700,sell:800,state:'unverified'}]});
 assert.match(root.textContent,/-83/);assert.match(root.textContent,/Unverified/);assert.equal(root.querySelector('img'),null);assert.equal(root.querySelectorAll('li').length,2);
 const summary=root.querySelector('summary');summary.parentElement.open=true;
 renderPortfolio(root,{sales:2,activity:[]});assert.equal(root.querySelector('details').open,true);
 dom.window.close();delete globalThis.document;
});
