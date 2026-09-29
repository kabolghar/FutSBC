import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeComparison} from '../extension/sbc-checkpoint.js';
const url='https://www.futbin.com/27/squad/123/sbc';
const now=1000000;
const entry=()=>({url,consolePrice:650,plan:{year:27,market:'console',challengeId:50,url,checkedAt:now,total:650,players:[{baseId:123,rating:75,rarity:0,name:'Card',price:650,futbinSlot:1}]}});
const run=(e,options={})=>resumeComparison({challengeId:50,entries:[e]},options.challengeId??50,[{url,consolePrice:options.price??650}],options.slots??[{index:1}],options.now??now);
test('resumes fresh complete checks without refreshing their price timestamp',()=>{
  const e=entry(),result=run(e,{now:now+1000});
  assert.equal(result.plans.length,1);
  assert.equal(result.plans[0].checkedAt,now);
});
test('rechecks expired, repriced, mismatched and malformed checkpoint entries',()=>{
  assert.equal(run(entry(),{now:now+300001}).plans.length,0);
  assert.equal(run(entry(),{price:700}).plans.length,0);
  assert.equal(run(entry(),{challengeId:51}).plans.length,0);
  assert.equal(run(entry(),{slots:[{},{}]}).plans.length,0);
  const e=entry();e.plan.total=1;
  assert.equal(run(e).plans.length,0);
});
