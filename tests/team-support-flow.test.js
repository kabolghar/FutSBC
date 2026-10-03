import test from 'node:test';
import assert from 'node:assert/strict';
test('failed position search expands supporting links, reuses target candidates and protects menu/concept anchors',async()=>{
  const session={},local={},calls=[],players=Array.from({length:11},(_,index)=>({index,position:index===0?'ST':'CM',name:'Current '+index,definitionId:1000+index,assetId:1000+index,rating:82,chemistry:2,leagueId:1,nationId:1,clubId:1}));
  players[10].concept=true;let listener,tabURL='',strictFailure=false;
  globalThis.fetch=async url=>url.endsWith('/players')?{ok:true,text:async()=>'<title>EA FC 27 Players</title>'}:{ok:true,json:async()=>{const ids=new URL(url).searchParams.get('ids').split(',');return {prices:Object.fromEntries(ids.map(id=>[id,1000])),updated:Object.fromEntries(ids.map(id=>[id,Math.floor(Date.now()/1000)]))};}};
  globalThis.chrome={runtime:{id:'support',getURL:p=>'chrome-extension://support/'+p,onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener(){}},onStartup:{addListener(){}}},action:{onClicked:{addListener(){}}},sidePanel:{setPanelBehavior:async()=>{}},storage:{session:{get:async()=>session,set:async v=>Object.assign(session,v)},local:{get:async()=>local,set:async v=>Object.assign(local,v)}},alarms:{create(){},clear:async()=>{},onAlarm:{addListener(){}}},tabs:{onUpdated:{addListener(){}},query:async()=>[{id:1,url:'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/'}],create:async v=>{tabURL=v.url;return {id:2};},get:async id=>({url:id===1?'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/':tabURL,status:'complete'}),update:async(_,v)=>tabURL=v.url,remove:async()=>{}},scripting:{executeScript:async({func,args=[],target})=>{
    if(func.name==='openOverlay')return [];
    if(func.name==='readFutbinTeamPlayers')return [{result:{blocked:true,error:'Unavailable'}}];
    if(func.name==='readFutggBest')return [{result:{kind:'futgg-best',url:tabURL,checkedAt:Date.now(),complete:true,cards:Array.from({length:8},(_,i)=>({definitionId:200+i,assetId:200+i,name:'Ranked '+i,rating:85,metaRank:i+1,source:'FUT.GG'}))}}];
    const [action,payload]=args;calls.push({action,payload});
    if(action==='teamSnapshot')return [{result:{ok:true,fingerprint:'f',players,balance:20000,chemistry:30}}];
    if(action==='teamEvaluate')return [{result:{ok:true,checked:payload.cards.length,options:payload.cards.map(c=>({...c,slotIndex:payload.slotIndex,owned:false,price:null,priceVerified:false,leagueId:1,nationId:1,clubId:1}))}}];
    if(action==='teamPlan'){
      if(strictFailure){
        if(!payload.requiredUpgradeSlots||!payload.allowChemistryFallback)return [{result:{ok:true,plan:null,reason:'33 chemistry unavailable',combinationsChecked:8}}];
        assert.equal(payload.maxSupportChanges,2);
        const group=payload.groups.find(g=>g.slotIndex===0);
        return [{result:{ok:true,plan:{choices:[{...group.options[0],slotIndex:0,slotChemistry:2}],chemistry:29,baselineChemistry:33,targetChemistry:33,chemistryTradeoff:true,cost:1000,remaining:19000},combinationsChecked:12}}];
      }
      if(!payload.supportSlots)return [{result:{ok:true,plan:null,combinationsChecked:8,reason:'Fixed XI prevents fit'}}];
      assert.deepEqual(payload.requiredUpgradeSlots,[0]);assert(!payload.supportSlots.includes(10));
      assert.equal(payload.groups.find(g=>g.slotIndex===10).allowRetained,false);
      const choices=payload.groups.map((g,i)=>({...g.options[i%g.options.length],slotIndex:g.slotIndex}));
      return [{result:{ok:true,plan:{choices,chemistry:33,baselineChemistry:30,cost:3000,remaining:17000},combinationsChecked:30}}];
    }
    throw Error('Unexpected '+action+' in '+target.tabId);
  }}};
  await import('../extension/background.js?support-flow');
  const result=await new Promise(resolve=>listener({type:'teamRecommend',slots:[0],budget:20000,allowSupport:true},{id:'support',url:'chrome-extension://support/panel.html'},resolve));
  assert.equal(result.ok,true,result.error);assert.equal(result.data.supportChanges.length,1);assert.deepEqual(result.data.requestedSlots,[0]);
  assert.equal(calls.filter(c=>c.action==='teamEvaluate'&&c.payload.slotIndex===0).length,1,'reuse already screened requested candidates');
  assert.equal(calls.filter(c=>c.action==='teamApply').length,0,'supporting changes require explicit application');
  assert.equal(session['futsbc-team-plan'].planId,result.data.planId);
  strictFailure=true;players[10].concept=false;
  const tradeoff=await new Promise(resolve=>listener({type:'teamRecommend',slots:[0],budget:20000,allowSupport:true},{id:'support',url:'chrome-extension://support/panel.html'},resolve));
  assert.equal(tradeoff.ok,true,tradeoff.error);assert.equal(tradeoff.data.plan.chemistry,29);
  assert.equal(tradeoff.data.allowChemistryTradeoff,true);assert.equal(tradeoff.data.plan.targetChemistry,33);
  assert.deepEqual(tradeoff.data.requestedSlots,[0]);assert.equal(tradeoff.data.supportChanges.length,0);
  assert.equal(tradeoff.data.supportReason,null);
});
