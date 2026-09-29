import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGeminiKey,geminiRequestError} from '../extension/gemini-market.js';

test('Gemini keys are opaque: punctuation is accepted but URLs and whitespace are rejected',()=>{
  assert.equal(normalizeGeminiKey('  AIza.sample+key=  '),'AIza.sample+key=');
  assert.equal(normalizeGeminiKey(''),'');
  assert.throws(()=>normalizeGeminiKey('https://example.com/key'),/only the Google AI Studio API key/);
  assert.throws(()=>normalizeGeminiKey('key with spaces'),/without a URL or spaces/);
  assert.throws(()=>normalizeGeminiKey('key\nheader'),/without a URL or spaces/);
});

test('Gemini errors identify key, quota, model and temporary failures',()=>{
  assert.match(geminiRequestError(403),/rejected this API key/);
  assert.match(geminiRequestError(429),/quota/);
  assert.match(geminiRequestError(404),/model is unavailable/);
  assert.match(geminiRequestError(503),/temporarily unavailable/);
});

test('saving a key checks an existing brief, replaces stale notes and reports provider errors',async()=>{
  const oldModel={model:'gemini-3.7-flash',at:Date.now()-1000,ideas:[{assetId:7,stance:'watch',reason:'Old note'}]};
  const brief={at:Date.now(),day:new Date().toISOString().slice(0,10),market:'FC 27 console',sampleSize:1,trendMedian:0,historyDays:0,headlines:[],candidates:[{assetId:7,name:'Example',price:1000,eaAverage:1050,trend:0,dayChange:null,baseline:null,historyDays:0,stance:'watch',buyCeiling:800}],model:oldModel};
  const stored={'futsbc-market-model-v1':{key:'old.key'},'futsbc-market-insights-v1':{brief,status:'Checked 1 card.'}};
  let listener,requestCount=0,seenKey,seenURL;
  globalThis.chrome={
    runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:{addListener:fn=>{listener=fn;}}},
    storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,value)}},
    tabs:{},
    alarms:{onAlarm:{addListener:()=>{}},clear:async()=>{},create:()=>{}},
  };
  globalThis.fetch=async(url,options)=>{
    requestCount++;seenKey=options.headers['x-goog-api-key'];seenURL=url;
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({ideas:[{assetId:7,stance:'watch',reason:'Checked price is stable but only one day is available.'}]})}]}}]})};
  };
  await import('../extension/background.js');
  const send=async(type,key)=>{
    const response=await new Promise(resolve=>listener({type,key},{id:'test-extension',url:'chrome-extension://test-extension/panel.html'},resolve));
    await new Promise(resolve=>setImmediate(resolve));
    return response;
  };
  const changed=await send('marketInsightsSetKey',' new.key+value= ');
  assert.equal(changed.ok,true,changed.error);
  assert.equal(changed.data.modelConfigured,true);
  assert.equal(changed.data.brief.model.ideas[0].reason,'Checked price is stable but only one day is available.');
  assert.equal(changed.data.modelError,null);
  assert.equal(stored['futsbc-market-model-v1'].key,'new.key+value=');
  assert.equal(seenKey,'new.key+value=');
  assert.match(seenURL,/gemini-3\.5-flash-lite/);
  assert.equal(requestCount,1);
  const same=await send('marketInsightsSetKey','new.key+value=');
  assert.equal(same.ok,true);
  assert.equal(requestCount,1);
  globalThis.fetch=async()=>({ok:false,status:403});
  const rejected=await send('marketInsightsSetKey','other.key+value=');
  assert.equal(rejected.ok,true);
  assert.equal(rejected.data.modelConfigured,true);
  assert.equal(rejected.data.brief.model,null);
  assert.match(rejected.data.modelError,/rejected this API key/);
  assert.equal(stored['futsbc-market-model-v1'].key,'other.key+value=');
  const fallbackURLs=[];
  globalThis.fetch=async url=>{
    fallbackURLs.push(url);
    return fallbackURLs.length===1?{ok:false,status:503}:{ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({ideas:[{assetId:7,stance:'watch',reason:'Fallback note based on checked price.'}]})}]}}]})};
  };
  const recovered=await send('marketInsightsSetKey','fallback.key+value=');
  assert.equal(recovered.ok,true,recovered.error);
  assert.equal(recovered.data.modelError,null);
  assert.equal(recovered.data.brief.model.model,'gemini-3.7-flash');
  assert.equal(fallbackURLs.length,2);
  assert.match(fallbackURLs[0],/gemini-3\.5-flash-lite/);
  assert.match(fallbackURLs[1],/gemini-3\.7-flash/);
  let missingModelCalls=0;
  globalThis.fetch=async()=>++missingModelCalls===1?{ok:false,status:404}:{ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({ideas:[{assetId:7,stance:'watch',reason:'Available fallback model.'}]})}]}}]})};
  const unavailable=await send('marketInsightsSetKey','missing-model.key');
  assert.equal(unavailable.data.modelError,null);
  assert.equal(missingModelCalls,2,'unavailable primary model must try configured fallback');
  const removed=await send('marketInsightsSetKey','');
  assert.equal(removed.ok,true);
  assert.equal(removed.data.modelConfigured,false);
  assert.equal(removed.data.modelError,null);
  assert.equal(stored['futsbc-market-model-v1'].key,undefined);
});
