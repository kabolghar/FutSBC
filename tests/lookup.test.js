import test from 'node:test';import assert from 'node:assert/strict';
import {challengeLookupURL} from '../extension/core.js';
import {readFutbin} from '../extension/futbin.js';
function lookup(links,path,id=59){globalThis.document={querySelectorAll:()=>links.map(href=>({href}))};globalThis.location={pathname:path};return readFutbin(id);}
const root='https://www.futbin.com';
test('lookup uses exact EA ID and safely encodes the name',()=>{assert.equal(challengeLookupURL({id:59,name:'TOTW Upgrade'}),root+'/27/squad-building-challenge/ea/59/TOTW%20Upgrade');assert.throws(()=>challengeLookupURL(null));assert.throws(()=>challengeLookupURL({id:-1,name:'SBC'}));});
test('builder lookup follows the observed SBC group link',()=>{assert.deepEqual(lookup([root+'/27/squad-building-challenge/29'],'/27/squad-building-challenge/ea/59/TOTW%20Upgrade'),{kind:'lookup',groupURL:root+'/27/squad-building-challenge/29'});});
test('group lookup matches challenge ID, ignoring other SBCs and foreign hosts',()=>{const exact=root+'/27/squad-building-challenges/Upgrades/59/totw-upgrade';assert.deepEqual(lookup(['https://evil.test/27/squad-building-challenges/Upgrades/59/totw-upgrade',root+'/27/squad-building-challenges/Upgrades/60/totw-upgrade',exact],'/27/squad-building-challenge/29'),{kind:'lookup',url:exact});});

test('a lookup redirected straight to completed challenges needs no self-link',()=>{const path='/27/squad-building-challenges/Upgrades/59/totw-upgrade';assert.deepEqual(lookup([],path),{kind:'lookup',url:root+path});});
