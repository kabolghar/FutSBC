import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readSbcDirectory,discoverSbc} from '../extension/sbc-discovery.js';
import {readFutbin} from '../extension/futbin.js';
const root='https://www.futbin.com',directory=root+'/27/squad-building-challenges';
const group=root+'/27/squad-building-challenge/21';
const exact=root+'/27/squad-building-challenges/Challenges/49/destined-for-glory-challenge-2';
function dom(html,url=directory){const page=new JSDOM(html,{url});globalThis.document=page.window.document;globalThis.location=page.window.location;}
test('directory reads only published same-season FUTBIN group, pagination and exact-ID links',()=>{
 dom(`<h1>SBCs</h1><a href="${group}">Challenge 1</a><a href="?page=2">2</a><a href="${exact}">Completed</a><a href="https://evil.test/27/squad-building-challenge/49">Fake</a><a href="/26/squad-building-challenge/49">Old</a>`);
 const result=readSbcDirectory(directory);
 assert.deepEqual(result.groups,[{url:group,title:'Challenge 1'}]);assert.deepEqual(result.pages,[directory+'?page=2']);assert.deepEqual(result.completed,[{id:49,url:exact}]);
 assert.equal(readSbcDirectory(directory+'?page=2').kind,undefined);
});
test('not-found and empty documents have explicit lookup failures',()=>{
 dom('<div>The page could not be found</div>');assert.equal(readFutbin(49).pageUnavailable,true);
 dom('');Object.defineProperty(document,'readyState',{value:'complete'});assert.equal(readFutbin(49).blankPage,true);
 dom('<title>Just a moment</title><p>Checking your browser</p>');assert.equal(readSbcDirectory(directory).verification,true);
});
function api(pages){let url;const visited=[];return {visited,tabs:{update:async(_,options)=>{url=options.url;visited.push(url);},get:async()=>({url})},scripting:{executeScript:async({args})=>{assert.deepEqual(args,[url]);return [{result:pages[url]||{unavailable:true}}];}}};}
const ready=(extra={})=>({kind:'discovery',completed:[],groups:[],pages:[],...extra});
test('fallback paginates, follows observed group URLs and requires exact challenge ID',async()=>{
 const second=directory+'?page=2',matchGroup=root+'/27/squad-building-challenge/22';
 const browser=api({[directory]:ready({groups:[{url:group,title:'Challenge 1'}],pages:[second]}),[second]:ready({groups:[{url:matchGroup,title:'Destined for Glory Challenge 2'}]}),[matchGroup]:ready({completed:[{id:48,url:exact.replace('/49/','/48/')},{id:49,url:exact}]})});
 assert.equal(await discoverSbc(browser,1,{id:49,name:'Destined for Glory Challenge 2'},{delay:async()=>{}}),exact);
 assert.deepEqual(browser.visited,[directory,second,matchGroup]);
});
test('no exact match remains explicit and a browser check stops discovery',async()=>{
 const browser=api({[directory]:ready({groups:[{url:group,title:'Challenge 1'}]}),[group]:ready({completed:[{id:48,url:exact.replace('/49/','/48/')}]})});
 await assert.rejects(()=>discoverSbc(browser,1,{id:49,name:'Challenge 2'},{delay:async()=>{}}),/exact match.*EA 49/);
 const blocked=api({[directory]:{verification:true}});
 await assert.rejects(()=>discoverSbc(blocked,1,{id:49,name:'Challenge 2'},{attempts:2,delay:async()=>{}}),error=>error.verificationBlocked);
 assert.equal(blocked.visited.length,1);
});
