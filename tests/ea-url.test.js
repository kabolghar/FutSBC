import test from 'node:test';
import assert from 'node:assert/strict';
import {isEaWebAppURL,findEaTabs} from '../extension/ea-url.js';

test('recognizes canonical, regional and slashless EA app URLs',()=>{
 for(const host of ['www.ea.com','ea.com']) for(const locale of ['','en/','en-us/','es-es/','ar/']) for(const suffix of ['', '/', '/?foo=1#home']) {
  const url=`https://${host}/${locale}ea-sports-fc/ultimate-team/web-app${suffix}`;
  assert.equal(isEaWebAppURL(url),true,url);
 }
});
test('rejects unrelated pages and lookalike hosts',()=>{
 for(const url of [undefined,'invalid','https://www.ea.com/','https://www.ea.com/ea-sports-fc/ultimate-team/web-app-fake/', 'https://www.ea.com.evil.test/ea-sports-fc/ultimate-team/web-app/', 'http://www.ea.com/ea-sports-fc/ultimate-team/web-app/', 'https://evil@www.ea.com/ea-sports-fc/ultimate-team/web-app/']) assert.equal(isEaWebAppURL(url),false,String(url));
});
test('tab discovery excludes other EA pages before injection',async()=>{
 const result=await findEaTabs({query:async()=>[{id:1,url:'https://www.ea.com/'},{id:2,url:'https://www.ea.com/en-gb/ea-sports-fc/ultimate-team/web-app'},{id:3}]});
 assert.deepEqual(result.map(tab=>tab.id),[2]);
});
