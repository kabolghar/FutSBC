import {discoverSbc} from './sbc-discovery.js';
import {teamLinkPages,teamCandidatePool,linkedTeamOptions} from './team-links.js';
import {quickFlipCards,reconcileSales,portfolioSummary,selectHuntCard} from './trader-performance.js';
const SALES_KEY='futsbc-trader-sales-v1';
const salesLedger=async()=> (await chrome.storage.local.get(SALES_KEY))[SALES_KEY]||[];
import {getConsoleEstimates} from './team-prices.js';
import {isEaWebAppURL,findEaTabs} from './ea-url.js';
import {resumeComparison} from './sbc-checkpoint.js';
import {readFutbinTab} from './tab-reader.js';
import {eaOperation} from './ea.js';
import {futbinURL,rankSolutions,comparisonCandidates,challengeLookupURL,validatePlan,validateSavedPlan,validateMapping,suggestMapping} from './core.js';
import {FUTBIN_MARKET_URL,marketBands,readFutbinMarket,selectMarketCards} from './futbin-market.js';
import {FUTBIN_NEWS_URL,readFutbinHeadlines,FUTGG_NEWS_URL,readFutggHeadlines} from './futbin-news.js';
import {readFutbinSquadBatch} from './futbin-batch.js';
import {recordMarketSnapshot,buildMarketBrief,validateModelBrief} from './market-insights.js';
import {normalizeGeminiKey,geminiRequestError} from './gemini-market.js';
import {readFutbinPlayerSignal} from './futbin-player.js';
import {cardArtPage,readCardArt} from './card-art.js';
import {teamPlayerPages,readFutbinTeamPlayers,selectTeamPlayers} from './futbin-team.js';
import {futggBestURL,readFutggBest,selectFutggTeamPlayers} from './futgg-team.js';
import {openOverlay} from './panel-overlay.js';
function showLauncher(tabId,replace=false){
  return chrome.scripting.executeScript({target:{tabId},func:openOverlay,args:[{initiallyOpen:false,replace}]}).catch(()=>{});
}
chrome.tabs.onUpdated?.addListener((tabId,change,tab)=>{
  if(change.status==='complete'&&isEaWebAppURL(change.url||tab.url))void showLauncher(tabId);
});
async function showLauncherInOpenTabs(){
  const tabs=await findEaTabs(chrome.tabs);
  await Promise.allSettled(tabs.map(tab=>showLauncher(tab.id,true)));
}
chrome.runtime.onInstalled?.addListener(()=>{void showLauncherInOpenTabs();});
chrome.runtime.onStartup?.addListener(()=>{void showLauncherInOpenTabs();});
let busy=false;
let tradingBusy=false;
const TRADE_KEY='futsbc-auto-trade-v1';
const TRADE_ALARM='futsbc-auto-trade';
const STOP_ALARM='futsbc-stop-watchdog';
const TRADE_REQUEST_TIMEOUT=60000;
const RATE_LIMIT_PAUSE_MS=30*60_000;
const INSIGHTS_KEY='futsbc-market-insights-v1';
const INSIGHTS_CONFIG_KEY='futsbc-market-model-v1';
const INSIGHTS_ALARM='futsbc-market-daily';
const GEMINI_MODEL='gemini-3.5-flash-lite';
const GEMINI_FALLBACK_MODEL='gemini-3.7-flash';
const insightsState=async()=> (await chrome.storage.local.get(INSIGHTS_KEY))[INSIGHTS_KEY]||{};
const insightsConfig=async()=> (await chrome.storage.local.get(INSIGHTS_CONFIG_KEY))[INSIGHTS_CONFIG_KEY]||{};
const saveInsights=async value=>chrome.storage.local.set({[INSIGHTS_KEY]:value});
const SBC_BUY_KEY='futsbc-sbc-buy-v1';
const SBC_BUY_ALARM='futsbc-sbc-buy';
const SBC_BUY_DELAY_MS=3000;
const rawSbcBuy=async()=> (await chrome.storage.local.get(SBC_BUY_KEY))[SBC_BUY_KEY]||{enabled:false};
const saveSbcBuy=async value=>chrome.storage.local.set({[SBC_BUY_KEY]:value});
const armSbcBuy=when=>chrome.alarms.create(SBC_BUY_ALARM,{when});
let sbcBuying=false;
const rawTradeState=async()=> (await chrome.storage.local.get(TRADE_KEY))[TRADE_KEY]||{enabled:false};
const saveTrade=async value=>chrome.storage.local.set({[TRADE_KEY]:value});
const armTrade=when=>chrome.alarms.create(TRADE_ALARM,{when});
async function tradeState(){
  const current=await rawTradeState();
  if(!current.enabled&&!current.rateLimitAt&&/(?:^|\D)429(?:\D|$)/.test(current.status||'')){
    const now=Date.now();
    const next={...current,rateLimitAt:now,cooldownUntil:now+RATE_LIMIT_PAUSE_MS,status:'EA limited market requests (429). FutSBC stopped. Wait for the pause, then test one normal market search in EA.'};
    await saveTrade(next);return next;
  }
  if(!current.enabled&&current.cooldownUntil&&current.cooldownUntil<=Date.now()){
    const next={...current,cooldownUntil:null,status:'The rate-limit pause ended. Test one normal market search in EA before restarting.'};
    await saveTrade(next);return next;
  }
  if(current.enabled||!current.inFlight)return current;
  const stoppedAt=current.stopRequestedAt||current.inFlightAt;
  if(tradingBusy&&(!stoppedAt||Date.now()-stoppedAt<TRADE_REQUEST_TIMEOUT))return current;
  const uncertain=!!current.candidate;
  const next={...current,inFlight:false,inFlightAt:null,stopRequestedAt:null,recoveryRequired:uncertain,nextAt:null,
    status:uncertain?`Stopped during ${current.candidate.name}. The bid outcome is unknown; check Transfer Targets and New Items before restarting.`:'Stopped. The pending market search did not finish.'};
  await saveTrade(next);
  await chrome.alarms.clear(STOP_ALARM);
  return next;
}
const state=async()=> (await chrome.storage.session.get('state')).state || {};
const save=async value=>chrome.storage.session.set({state:value});
let activeTeamRead=null;
let activeSbcBuild=null;
function checkTeamReadCancelled(){if(activeTeamRead?.cancelled)throw Error('Background recommendations stopped.');}
async function cancelTeamRead(){
  const current=activeTeamRead;if(!current)return;
  current.cancelled=true;
  await Promise.all([...current.tabs].map(tabId=>chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:function markTeamReadCancelled(token){window.__futsbcCancelledTeamRead=token;},args:[current.id]}).catch(()=>{})));
}
async function ea(tabId,action,payload,timeoutMs=0) {
  checkTeamReadCancelled();
  if(activeTeamRead&&['teamSnapshot','teamEvaluate','teamQuote','teamPlan'].includes(action)){
    activeTeamRead.tabs.add(tabId);payload={...payload,readToken:activeTeamRead.id};
  }
  const tab=await chrome.tabs.get(tabId);
  if(!isEaWebAppURL(tab.url)) throw Error('The connected tab is no longer the FC Web App.');
  const request=chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:eaOperation,args:[action,payload||{}]});
  let timer;
  const results=timeoutMs?await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`EA ${action} did not respond within ${Math.round(timeoutMs/1000)} seconds.`)),timeoutMs);})]).finally(()=>clearTimeout(timer)):await request;
  checkTeamReadCancelled();
  const result=results[0]?.result;
  if(!result?.ok){const error=Error(result?.error||'EA integration unavailable.');error.purchaseAttempted=result?.purchaseAttempted;error.status=result?.status;error.stage=result?.stage;error.page=result?.page;error.unmatchedPlayer=result?.unmatchedPlayer;throw error;}
  return result;
}
const readTab=(tabId,url,lookupId=null)=>readFutbinTab(chrome,tabId,url,lookupId);
const SBC_REQUEST_TIMEOUT=120000;
const TEAM_PRICE_PAUSE_KEY='futsbc-team-price-pause';
const sameCard=(a,b)=>a?.baseId===b?.baseId&&a?.rating===b?.rating&&a?.rarity===b?.rarity;
const slotFor=(session,index)=>Array.isArray(session.mapping)?session.mapping[index]:suggestMapping(session.resolved,session.challenge.slots)[index];
async function swapCandidates(session,index){
  const current=session.resolved?.[index];
  if(!session.approved||!current||current.owned)throw Error('Select a missing player in a saved SBC squad.');
  validateSavedPlan(session.plan);
  await save({...session,swapOptions:null,progress:`Finding cheaper swaps for ${current.name}…`});
  const currentQuote=await ea(session.tabId,'sbcQuote',{challengeId:session.plan.challengeId,player:current},SBC_REQUEST_TIMEOUT);
  if(currentQuote.phase==='owned')throw Error(`${current.name} is already in your club. There is no cheaper card to buy.`);
  const currentPrice=currentQuote.phase==='quoted'?currentQuote.price:current.price;
  const seen=new Set([...(session.alternatives||[]).map(plan=>plan.url),...(session.incompleteSolutions||[])]);
  const plans=[...(session.alternatives||[])];
  const needed=()=>new Set(plans.flatMap(plan=>plan.players.filter(player=>player.futbinSlot===current.futbinSlot&&player.price<=currentPrice&&!sameCard(player,current)).map(player=>player.baseId))).size;
  const unvisited=(session.listedSolutions||[]).filter(solution=>!seen.has(solution.url)).slice(0,30);
  if(needed()<10&&unvisited.length){
    const tab=await chrome.tabs.create({url:unvisited[0].url,active:false});
    try{
      for(const [number,solution] of unvisited.entries()){
        if(needed()>=10)break;
        await save({...await state(),progress:`Finding cheaper swaps ${number+1}/${unvisited.length}…`});
        try{
          await chrome.tabs.update(tab.id,{url:solution.url});
          const plan=await readTab(tab.id,solution.url);
          validatePlan(plan);
          if(plan.challengeId!==session.plan.challengeId)continue;
          plans.push(plan);seen.add(plan.url);
        }catch(error){if(error.verificationBlocked)throw error;}
      }
    }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
  }
  const source=new Map();
  for(const plan of plans){
    const candidate=plan.players.find(player=>player.futbinSlot===current.futbinSlot);
    if(!candidate||candidate.price>currentPrice||sameCard(candidate,current)||session.resolved.some((player,otherIndex)=>otherIndex!==index&&player.baseId===candidate.baseId)||source.has(candidate.baseId))continue;
    source.set(candidate.baseId,{player:candidate,url:plan.url});
  }
  const candidates=[...source.values()].sort((a,b)=>a.player.price-b.player.price).slice(0,12);
  const options=[];
  for(const [number,candidate] of candidates.entries()){
    await save({...await state(),alternatives:plans,progress:`Checking chemistry and prices ${number+1}/${candidates.length}…`});
    try{
      const check=await ea(session.tabId,'sbcSwapCheck',{challengeId:session.plan.challengeId,fingerprint:session.challenge.fingerprint,slotIndex:slotFor(session,index),player:candidate.player},SBC_REQUEST_TIMEOUT);
      if(!check.valid)continue;
      const quote=await ea(session.tabId,'sbcQuote',{challengeId:session.plan.challengeId,player:check.player},SBC_REQUEST_TIMEOUT);
      const price=quote.phase==='owned'?0:quote.phase==='quoted'?quote.price:null;
      if(price===null||price>=currentPrice)continue;
      options.push({player:{...check.player,price:candidate.player.price,owned:quote.phase==='owned'},price,sourceURL:candidate.url});
      if(options.length>=5)break;
    }catch(error){if(!error.unmatchedPlayer){error.message=`Could not verify swap ${candidate.player.name}: ${error.message}`;throw error;}}
  }
  options.sort((a,b)=>a.price-b.price||a.player.price-b.player.price);
  const latest=await state();
  const next={...latest,alternatives:plans,swapOptions:{index,baseId:current.baseId,fingerprint:session.challenge.fingerprint,currentPrice,checkedAt:Date.now(),options},progress:null};
  await save(next);return next;
}
async function runSbcBuy(){
  if(sbcBuying||busy||tradingBusy){
    if((await rawSbcBuy()).enabled)armSbcBuy(Date.now()+SBC_BUY_DELAY_MS);
    return;
  }
  sbcBuying=true;
  try{
    let run=await rawSbcBuy();
    if(!run.enabled)return;
    if(run.pending)throw Error(`The previous purchase of ${run.pending.name} was interrupted. Check New Items and your club before continuing.`);
    const session=await state();
    if(!session.approved||!session.resolved||session.plan?.url!==run.planURL||session.challenge?.fingerprint!==run.fingerprint)throw Error('The SBC changed during buying. Check the squad and your club before restarting.');
    const quote=run.quotes[run.index];
    if(!quote){
      await saveSbcBuy({...run,pending:{name:'SBC squad check',index:run.index,operation:'fill'},status:'Filling the final SBC squad…'});
      const mapping=Array.isArray(session.mapping)?session.mapping:suggestMapping(session.resolved,session.challenge.slots);
      const result=await ea(session.tabId,'concepts',{challengeId:session.plan.challengeId,players:session.resolved,mapping,fingerprint:session.challenge.fingerprint},SBC_REQUEST_TIMEOUT);
      await save({...session,resolved:result.players,challenge:result.challenge,mapping,checkout:null,inserted:true,approved:true});
      await saveSbcBuy({...run,enabled:false,done:true,pending:null,status:'All cards are in the SBC. Review and submit it in EA.'});
      return;
    }
    const player=session.resolved[quote.index];
    if(!player||player.definitionId!==quote.definitionId)throw Error('The approved player list changed. Check the SBC before buying again.');
    await saveSbcBuy({...run,pending:{name:player.name,index:quote.index,definitionId:player.definitionId},status:`Checking ${player.name} (${run.index+1}/${run.quotes.length})…`});
    const result=await ea(session.tabId,'sbcBuyOne',{challengeId:session.plan.challengeId,player,maxPrice:quote.price,remaining:run.maxTotal-run.spent},SBC_REQUEST_TIMEOUT);
    run=await rawSbcBuy();
    if(result.phase==='uncertain'||result.phase==='purchased-unverified'){
      await saveSbcBuy({...run,enabled:false,review:true,pending:{...run.pending,...result},status:result.warning});
      return;
    }
    if(!['owned','in-club'].includes(result.phase)){
      await saveSbcBuy({...run,enabled:false,review:false,pending:null,status:`${player.name} is no longer available within the approved price. Check prices again or choose a swap.`});
      await save({...session,checkout:null});
      return;
    }
    const spent=run.spent+(result.phase==='in-club'?result.price:0);
    if(spent>run.maxTotal)throw Error('The approved coin ceiling would be exceeded. Buying stopped.');
    const resolved=session.resolved.map((entry,index)=>index===quote.index?{...entry,owned:true}:entry);
    await save({...session,resolved});
    const next={...run,spent,index:run.index+1,pending:null,last:{name:player.name,price:result.phase==='in-club'?result.price:0},status:result.phase==='in-club'?`Bought ${player.name} for ${result.price.toLocaleString()} and sent it to your club.`:`${player.name} is already in your club.`};
    await saveSbcBuy(next);
    if(next.enabled)armSbcBuy(Date.now()+SBC_BUY_DELAY_MS);
  }catch(error){
    const run=await rawSbcBuy();
    const uncertain=!!run.pending&&run.pending.operation!=='fill'&&error.purchaseAttempted!==false;
    await saveSbcBuy({...run,enabled:false,review:uncertain,pending:uncertain?run.pending:null,status:`Buying stopped: ${error.message}`});
  }finally{sbcBuying=false;}
}
async function marketTab(session){
  if(Number.isInteger(session.futbinTabId)){
    try{const tab=await chrome.tabs.get(session.futbinTabId);if(tab.id)return tab.id;}catch{}
  }
  const tab=await chrome.tabs.create({url:marketBands(session.lastBalance||session.startingBalance)[0],active:false});
  await saveTrade({...session,futbinTabId:tab.id});
  return tab.id;
}
async function collectFutbinMarket(tabId,balance,urls=marketBands(balance)){
  const pages=[];
  for(const url of urls){
    if((await chrome.tabs.get(tabId)).url!==url)await chrome.tabs.update(tabId,{url});
    let reason='FUTBIN market prices did not load.';
    for(let attempt=0;attempt<30;attempt++){
      try{
        const result=(await chrome.scripting.executeScript({target:{tabId},func:readFutbinMarket,args:[url]}))[0]?.result;
        if(result?.kind==='market'){pages.push(result);break;}
        if(result?.error)reason=result.error;
      }catch(error){reason=error.message;}
      if(attempt<29)await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(pages.length!==urls.indexOf(url)+1)throw Error(`Could not verify FUTBIN prices: ${reason}`);
  }
  return {pages,cards:selectMarketCards(pages,balance)};
}
async function collectNewsSource(url,reader){
  const tab=await chrome.tabs.create({url,active:false});
  try{
    let lastError='FUTBIN news did not load.';
    for(let attempt=0;attempt<20;attempt++){
      try{
        const result=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:reader}))[0]?.result;
        if(result?.kind==='news')return result;
        if(result?.error)lastError=result.error;
        if(result?.blocked)break;
      }catch(error){lastError=error.message;}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    return {error:lastError,headlines:[]};
  }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function collectFutbinNews(){
  const key='futsbc-trading-news-v1',cached=(await chrome.storage.local.get(key))[key];
  if(cached&&Date.now()-cached.checkedAt<30*60_000)return cached;
  const results=await Promise.allSettled([collectNewsSource(FUTBIN_NEWS_URL,readFutbinHeadlines),collectNewsSource(FUTGG_NEWS_URL,readFutggHeadlines)]);
  const values=results.map((result,index)=>({...result.value,error:result.status==='rejected'?result.reason.message:result.value?.error,source:index?'FUT.GG':'FUTBIN'}));
  const news={checkedAt:Date.now(),headlines:values.flatMap(value=>value.headlines||[]),error:values.filter(value=>value.error).map(value=>`${value.source}: ${value.error}`).join(' · ')||null};
  await chrome.storage.local.set({[key]:news});return news;
}
async function generateMarketNotes(brief,key){
  const evidence={day:brief.day,market:brief.market,sampleSize:brief.sampleSize,medianTrend:brief.trendMedian,historyDays:brief.historyDays,candidates:brief.candidates.map(({assetId,name,price,eaAverage,trend,dayChange,baseline,historyDays,stance,buyCeiling,hold,risk,evidence})=>({assetId,name,price,eaAverage,trend,dayChange,baseline,historyDays,stance,buyCeiling,hold,risk,evidence})),headlines:brief.headlines};
  const prompt=`You are an FC 27 Ultimate Team market research assistant. Interpret ONLY this supplied FC 27 CONSOLE evidence. FUTBIN prices are estimates; the sampled cards are not the whole market. A headline marked rumour is unverified and cannot establish that an SBC will release or a card will rise. Do not invent a player, price, requirement, fixture, leak, date, filter, profit, or holding period. Rank up to six supplied assetIds as watch, consider, or avoid. Use consider only if evidence.eligible is true; otherwise watch/avoid. News headlines are context, not proof that a specific card is needed. Explain evidence reasons and exitRule. Never infer liquidity from asking prices. Explain the supplied hold window using price history, verified player-linked content, and community votes or usage where available; never present it as guaranteed. Keep the reason under 35 words and explain one concrete evidence point plus the main uncertainty. Only copy a catalystURL from supplied headlines if directly relevant to that card; otherwise omit it. Return JSON: {"ideas":[{"assetId":123,"stance":"watch","reason":"...","catalystURL":null}]}\n\nEvidence: ${JSON.stringify(evidence)}`;
  const request=async model=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
    try{
      const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.2,responseMimeType:'application/json',maxOutputTokens:900}}),signal:controller.signal});
      if(!response.ok){const error=Error(geminiRequestError(response.status));error.status=response.status;throw error;}
      const result=await response.json();
      const content=result.candidates?.[0]?.content?.parts?.map(part=>part.text||'').join('')||'';
      const parsed=JSON.parse(content);
      const ideas=validateModelBrief(parsed,brief);
      if(!ideas.length)throw Error('Gemini returned no usable notes for the checked cards. Try again later.');
      return {model,at:Date.now(),ideas};
    }finally{clearTimeout(timer);}
  };
  try{return await request(GEMINI_MODEL);}
  catch(error){
    if(error.name!=='AbortError'&&![404,500,502,503,504].includes(error.status))throw error;
    await new Promise(resolve=>setTimeout(resolve,1000));
    try{return await request(GEMINI_FALLBACK_MODEL);}
    catch(fallbackError){
      if([500,502,503,504].includes(fallbackError.status))throw Error('Both configured Gemini models are temporarily unavailable. Try again later.');
      throw fallbackError;
    }
  }
}
async function tradingSignals(options){
  const key='futsbc-trading-signals-v1',stored=(await chrome.storage.local.get(key))[key]||{},now=Date.now();
  const cache=Object.fromEntries(Object.entries(stored).filter(([,value])=>now-value.at<30*60_000&&value.at<=now));
  const missing=options.filter(card=>!cache[card.url]);
  const fresh=missing.length?await teamSignals(missing):{};
  for(const card of missing)cache[card.url]={at:now,signal:fresh[card.assetId]||null};
  await chrome.storage.local.set({[key]:cache});
  return Object.fromEntries(options.filter(card=>cache[card.url]?.signal).map(card=>[card.assetId,cache[card.url].signal]));
}
async function refreshMarketInsights(){
  const trade=await tradeState();
  if(tradingBusy||trade.enabled||sbcBuying||(await rawSbcBuy()).enabled)throw Error('Stop active trading or SBC buying before refreshing market research.');
  const previous=await insightsState();
  await saveInsights({...previous,status:'Reading current FC 27 console prices…'});
  try{
    const tabs=await findEaTabs(chrome.tabs);
    let balance,reason='Open your signed-in FC 27 console Web App to refresh the market brief.';
    for(const tab of tabs.sort((a,b)=>Number(b.active)-Number(a.active))){
      try{balance=(await ea(tab.id,'tradeStatus',null,TRADE_REQUEST_TIMEOUT)).balance;break;}catch(error){reason=error.message;}
    }
    if(!Number.isSafeInteger(balance)||balance<500)throw Error(reason);
    let futbinTabId=previous.futbinTabId;
    try{await chrome.tabs.get(futbinTabId);}catch{futbinTabId=(await chrome.tabs.create({url:marketBands(balance)[0],active:false})).id;}
    const lowBand=`${FUTBIN_MARKET_URL}?ps_price=0-5000&sort=ps_updated&order=desc`;
    const market=await collectFutbinMarket(futbinTabId,balance,[...new Set([lowBand,...marketBands(balance)])]);
    const {snapshot,history}=recordMarketSnapshot(previous.history,market.pages);
    await saveInsights({...previous,futbinTabId,history,status:'Reading FC 27 news headlines…'});
    const news=await collectFutbinNews();
    const firstPass=buildMarketBrief(snapshot,history,balance,news.headlines);
    let signals={};
    try{signals=await tradingSignals(firstPass.candidates.slice(0,8));}catch{}
    const brief=buildMarketBrief(snapshot,history,balance,news.headlines,Date.now(),signals);
    const config=await insightsConfig();
    let modelError=null;
    if(config.key){
      try{brief.model=await generateMarketNotes(brief,config.key);}catch(error){modelError=error.name==='AbortError'?'Gemini took too long to respond. Try again later.':error.message;}
    }
    const next={futbinTabId,history,brief,checkedAt:Date.now(),balance,status:`Checked ${brief.sampleSize} FC 27 console cards. ${brief.historyDays?`${brief.historyDays} earlier day(s) available.`:'First snapshot saved; daily changes need another day.'}`,newsError:news.error||null,modelError};
    await saveInsights(next);
    chrome.alarms.create(INSIGHTS_ALARM,{when:Date.now()+24*60*60_000,periodInMinutes:1440});
    return {...next,modelConfigured:!!config.key};
  }catch(error){await saveInsights({...await insightsState(),status:`Market refresh failed: ${error.message}`});throw error;}
}
async function connectedTeam(){
  const tabs=await findEaTabs(chrome.tabs);
  let reason='Open your signed-in FC 27 Web App and active squad.';
  for(const tab of tabs.sort((a,b)=>Number(b.active)-Number(a.active))){
    try{return {tabId:tab.id,team:await ea(tab.id,'teamSnapshot',null,SBC_REQUEST_TIMEOUT)};}catch(error){reason=error.message;}
  }
  throw Error(reason);
}
let teamPlayerCache=null;
let teamPlayerBlockedUntil=0;
const futggTeamCache=new Map();
const cardArtCache=new Map(),cardArtPending=new Map();
async function cardArt(assetId,definitionId){
  const url=cardArtPage(assetId,definitionId),key=`${assetId}:${definitionId}`;
  const cached=cardArtCache.get(key);
  if(cached&&Date.now()-cached.checkedAt<24*60*60_000)return cached.data;
  if(cardArtPending.has(key))return cardArtPending.get(key);
  const pending=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(url,{signal:controller.signal,credentials:'omit'});
      if(!response.ok)throw Error(`Card artwork unavailable (${response.status}).`);
      const html=await response.text();
      const data=readCardArt(html,assetId,definitionId,response.url);
      cardArtCache.set(key,{checkedAt:Date.now(),data});
      return data;
    }finally{clearTimeout(timer);}
  })();
  cardArtPending.set(key,pending);
  try{return await pending;}finally{cardArtPending.delete(key);}
}
const teamLinkCache=new Map();
async function currentTeamPlayers(budget,requestedURLs=null){
  if(Date.now()<teamPlayerBlockedUntil)throw Error('FUTBIN player ratings are unavailable right now. No unverified Team recommendations were made. Retry later.');
  const urls=requestedURLs||teamPlayerPages(budget);
  const cacheKey=JSON.stringify(urls),linkCached=requestedURLs&&teamLinkCache.get(cacheKey);
  if(linkCached&&Date.now()-linkCached.at<10*60_000)return linkCached.pages;
  if(teamPlayerCache&&Date.now()-teamPlayerCache.at<10*60_000&&urls.every(url=>teamPlayerCache.urls.includes(url)))return teamPlayerCache.pages;
  if(tradingBusy||(await rawTradeState()).enabled)throw Error('Stop trading before checking FUTBIN team suggestions.');
  const tab=await chrome.tabs.create({url:urls[0],active:false});
  const pages=[];
  try{
    for(const url of urls){
      if((await chrome.tabs.get(tab.id)).url!==url)await chrome.tabs.update(tab.id,{url});
      let reason='The FC 27 player table did not load.';
      for(let attempt=0;attempt<24;attempt++){
        teamProgress('Reading FUTBIN player rankings…');
        const result=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:readFutbinTeamPlayers,args:[url]}).catch(error=>[{result:{error:error.message}}]))[0]?.result;
        if(result?.kind==='team-players'){pages.push(result);break;}
        if(result?.error)reason=result.error;
        if(result?.blocked)break;
        if(attempt<23)await new Promise(resolve=>setTimeout(resolve,400));
      }
      if(!pages.some(page=>page.url===url)&&!(pages.length===urls.indexOf(url)+1&&!requestedURLs)){
        if(requestedURLs){if(/verification/i.test(reason))break;continue;}
        teamPlayerBlockedUntil=Date.now()+10*60_000;
        throw Error(`FUTBIN player ratings are unavailable: ${reason} No unverified Team recommendations were made. Retry later.`);
      }
    }
    if(requestedURLs){if(!pages.length)throw Error('Linked FUTBIN player searches were unavailable.');teamLinkCache.set(cacheKey,{at:Date.now(),pages});if(teamLinkCache.size>6)teamLinkCache.delete(teamLinkCache.keys().next().value);}
    else teamPlayerCache={at:Date.now(),urls:urls.slice(0,pages.length),pages};
    return pages;
  }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function currentFutggBest(positions,limit=30){
  const urls=[...new Set(positions.map(futggBestURL))],pages=new Map();
  const missing=urls.filter(url=>{
    const cached=futggTeamCache.get(url);
    if(cached&&Date.now()-cached.checkedAt<10*60_000&&(cached.cards.length>=limit||cached.complete!==false&&(cached.requestedLimit||30)>=limit)){pages.set(url,cached);return false;}
    return true;
  });
  if(!missing.length)return pages;
  const tab=await chrome.tabs.create({url:missing[0],active:false});
  try{
    for(const url of missing){
      if((await chrome.tabs.get(tab.id)).url!==url)await chrome.tabs.update(tab.id,{url});
      let loaded=null;
      for(let attempt=0;attempt<20;attempt++){
        teamProgress(`Reading FUT.GG rankings · ${pages.size+1}/${urls.length}`);
        const result=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:readFutggBest,args:[url,limit]}).catch(()=>[]))[0]?.result;
        if(result?.kind==='futgg-best'){loaded=result;if(result.complete!==false)break;}
        if(attempt<19)await new Promise(resolve=>setTimeout(resolve,250));
      }
      if(!loaded)continue; // One unavailable position must not discard other rankings.
      futggTeamCache.set(url,loaded);pages.set(url,loaded);
    }
    return pages;
  }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function teamSignals(options){
  const signals={};
  const checks=[...new Map(options.filter(option=>/^https:\/\/www\.futbin\.com\/27\/player\/\d+\//.test(option.url)).map(option=>[option.assetId,option])).values()].slice(0,8);
  if(!checks.length)return signals;
  const tab=await chrome.tabs.create({url:checks[0].url,active:false});
  try{
    for(const option of checks){
      if((await chrome.tabs.get(tab.id)).url!==option.url)await chrome.tabs.update(tab.id,{url:option.url});
      for(let attempt=0;attempt<10;attempt++){
        const result=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:readFutbinPlayerSignal,args:[option.url]}).catch(()=>[]))[0]?.result;
        if(result?.kind==='player-signal'){signals[option.assetId]=result;break;}
        if(result?.blocked)break;
        await new Promise(resolve=>setTimeout(resolve,350));
      }
    }
  }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
  return signals;
}
let teamRun={running:false};
const teamQuoteCache=new Map();
function teamProgress(status){
  if(teamRun.cancelled)throw Error('Team check stopped. Completed price checks can be reused briefly when you retry.');
  if(Date.now()-teamRun.startedAt>8*60_000)throw Error('Team check reached its time limit. Retry to reuse recent completed price checks.');
  teamRun={...teamRun,status,updatedAt:Date.now()};
}
async function runTeamRecommendation(slots,budget,picks=[]){
  teamRun={running:true,cancelled:false,startedAt:Date.now(),status:'Reading your squad…'};
  try{const result={...await recommendTeam(slots,budget,false,picks),planId:crypto.randomUUID()};await chrome.storage.session.set({'futsbc-team-plan':result});return result;}
  finally{teamRun={...teamRun,running:false};}
}
async function recommendTeam(slots,budget,broaden=false,picks=[]){
  if(tradingBusy||sbcBuying||(await rawTradeState()).enabled||(await rawSbcBuy()).enabled)throw Error('Stop trading and SBC buying before building a team.');
  const {tabId,team}=await connectedTeam();
  if(!Array.isArray(picks)||picks.length>11||new Set(picks.map(pick=>pick.slotIndex)).size!==picks.length)throw Error('Choose one player per position.');
  const catalog=(await chrome.storage.session.get('futsbc-team-picker'))['futsbc-team-picker'];
  const manual=picks.map(pick=>{
    const row=catalog?.cards?.find(row=>row.slotIndex===pick.slotIndex&&row.definitionId===pick.definitionId);
    if(catalog?.fingerprint!==team.fingerprint||!row||!team.players.some(player=>player.index===pick.slotIndex))throw Error('A chosen player expired or the squad changed. Search for that player again.');
    return {...row,index:pick.slotIndex,source:'Menu'};
  });
  const selected=[...new Set(slots||[])].filter(index=>Number.isInteger(index)&&!manual.some(pick=>pick.index===index)&&team.players.some(player=>player.index===index)).slice(0,11);
  if(!selected.length&&!manual.length)throw Error('Choose a player or a position to build.');
  const hasAnchors=manual.length>0||team.players.some(player=>player.concept&&!selected.includes(player.index));
  const total=Number(budget);
  if(!Number.isSafeInteger(total)||total<0)throw Error('Enter a valid planning budget.');
  teamProgress('Reading player rankings…');
  let pages,source='FUTBIN';
  try{pages=selected.length?await currentTeamPlayers(Math.max(total,500)):[];}
  catch{teamProgress('Reading fallback player rankings…');source='FUT.GG';pages=await currentFutggBest(selected.map(index=>team.players.find(player=>player.index===index).position),hasAnchors||broaden?120:30);}
  const fallbackPositions=source==='FUTBIN'?selected.map(index=>team.players.find(player=>player.index===index).position):[];
  const supplemental=fallbackPositions.length?await currentFutggBest(fallbackPositions,hasAnchors||broaden?120:30):new Map();
  const anchors=[...manual,...team.players.filter(player=>player.concept&&!selected.includes(player.index)&&!manual.some(pick=>pick.index===player.index))];
  const linkURLs=teamLinkPages(total,anchors);let linkedPages=[],linkSearchError=null;
  if(linkURLs.length&&selected.length){
    teamProgress('Finding strong league, nation and club links for your chosen players…');
    try{linkedPages=await currentTeamPlayers(Math.max(total,500),linkURLs);if(linkedPages.length<linkURLs.length)linkSearchError='Some link searches were unavailable.';}catch(error){linkSearchError=error.message;}
  }
  const existing=team.players.map(player=>Number(player.definitionId)%0x1000000).filter(Boolean);
  const results=[];
  for(const slotIndex of selected){
    const player=team.players.find(row=>row.index===slotIndex);
    teamProgress(`Checking ${player.position} cards · position ${results.length+1}/${selected.length}`);
    const pool=source==='FUTBIN'?selectTeamPlayers(pages,player.position,Math.max(total,500),existing,broaden?48:24).map(card=>({...card,source}))
      :selectFutggTeamPlayers(pages.get(futggBestURL(player.position)),existing,hasAnchors||broaden?120:30);
    const extras=selectFutggTeamPlayers(supplemental.get(futggBestURL(player.position)),existing,hasAnchors||broaden?120:30);
    const linked=selectTeamPlayers(linkedPages,player.position,Math.max(total,500),existing,48).map(card=>({...card,source:'FUTBIN'}));
    const cards=teamCandidatePool([...pool,...extras],linked,hasAnchors||broaden?144:48);
    const sourcePrices=new Map([...pool,...linked].filter(card=>Number.isSafeInteger(card.price)).map(card=>[card.assetId,card]));
    if(!cards.length){results.push({slotIndex,player,options:[],checked:0});continue;}
    let checked;
    try{
      checked={options:[],checked:0};
      for(let offset=0;offset<cards.length;offset+=48){
        const batch=await ea(tabId,'teamEvaluate',{slotIndex,fingerprint:team.fingerprint,budget:total,allowChemistryDrop:true,cards:cards.slice(offset,offset+48)},SBC_REQUEST_TIMEOUT);
        checked.options.push(...batch.options);checked.checked+=batch.checked||0;checked.screening=batch.screening;
      }
      checked.options=linkedTeamOptions(checked.options,anchors);
    }
    catch(error){const step=error.stage==='team-club-search'?'club ownership':error.stage==='team-concept-search'?'concept cards':'cards';error.message=`EA could not check ${player.position} ${step}: ${error.message}`;throw error;}
    if(source==='FUTBIN'&&checked.options.length<8){
      teamProgress(`Broadening ${player.position} candidates…`);
      const extraPages=await currentFutggBest([player.position]);
      const more=selectFutggTeamPlayers(extraPages.get(futggBestURL(player.position)),existing,30).filter(card=>!checked.options.some(option=>option.definitionId===card.definitionId));
      if(more.length){
        const extra=await ea(tabId,'teamEvaluate',{slotIndex,fingerprint:team.fingerprint,budget:total,allowChemistryDrop:true,cards:more},SBC_REQUEST_TIMEOUT);
        checked={...checked,options:[...checked.options,...extra.options].slice(0,48),checked:checked.checked+extra.checked};
      }
    }
    checked.options=checked.options.map(option=>{
      const estimate=sourcePrices.get(option.assetId);
      return !option.owned&&estimate&&option.definitionId===option.assetId&&estimate.rating===option.rating?{...option,estimatedPrice:estimate.price,price:estimate.price,priceSource:'FUTBIN',priceUpdatedAt:Date.now()}:option;
    });
    results.push({slotIndex,player,options:checked.options,checked:checked.checked,screening:checked.screening});
  }
  // Unselected concepts are explicit user choices, not free owned cards.
  for(const player of [...manual,...team.players.filter(player=>player.concept&&!selected.includes(player.index)&&!manual.some(pick=>pick.index===player.index))]){
    teamProgress(`Building around ${player.name}…`);
    const checked=await ea(tabId,'teamEvaluate',{slotIndex:player.index,fingerprint:team.fingerprint,budget:total,allowChemistryDrop:true,cards:[{...player,source:player.source==='Menu'?'Menu':'User',price:null}]},SBC_REQUEST_TIMEOUT);
    const option=checked.options?.find(option=>option.definitionId===player.definitionId);
    if(!option)throw Error(`Could not keep ${player.name} at ${player.position}. Check that this exact card can play there in EA.`);
    results.push({slotIndex:player.index,player,locked:true,options:[{...option,locked:true}],checked:1});
  }
  const missingPrices=[...new Set(results.flatMap(group=>group.options.filter(option=>!option.owned&&!Number.isSafeInteger(option.estimatedPrice??option.price)).map(option=>option.definitionId)))];
  if(missingPrices.length){
    teamProgress(`Reading alternative console estimates · ${missingPrices.length} cards`);
    const key='futsbc-console-estimates-v1';
    const saved=(await chrome.storage.local.get(key))[key]||{};
    const estimates=await getConsoleEstimates(missingPrices,saved);
    await chrome.storage.local.set({[key]:estimates.cache});
    const prices=new Map(estimates.quotes.map(quote=>[quote.definitionId,quote]));
    for(const group of results)group.options=group.options.map(option=>{
      const quote=prices.get(option.definitionId);
      return !option.owned&&quote?{...option,price:quote.price,estimatedPrice:quote.price,priceSource:quote.source,priceUpdatedAt:quote.updatedAt}:option;
    });
  }
  // Estimates are sufficient for recommendations. Unknown fallback prices are
  // optimistic only inside planning; never expose an unpriced lineup as affordable.
  const maxPriceChecks=Math.min(120,Math.max(24,selected.length*12));
  const quotes=new Map();let priceCheckedAt=null,cardsPriced=0,planned,pricingIncomplete=false;
  const cachePrefix=JSON.stringify([tabId]);
  for(const result of results)result.options=result.options.map(option=>({...option,
    price:option.owned?0:option.estimatedPrice??option.price,
    priceEstimated:!option.owned&&Number.isSafeInteger(option.estimatedPrice??option.price)}));
  for(let round=0;round<=maxPriceChecks;round++){
    teamProgress('Checking complete teams and chemistry…');
    const groups=results.map(({slotIndex,options,locked})=>({slotIndex,allowRetained:!locked,options:options.flatMap(option=>{
      if(option.owned||option.priceEstimated)return [{...option,priceVerified:true}];
      const key=`${cachePrefix}:${option.definitionId}`,cached=teamQuoteCache.get(key);
      if(cached&&Date.now()-cached.checkedAt<5*60_000&&cached.quote.price!=null&&cached.quote.price<=total)quotes.set(option.definitionId,cached.quote);
      const quote=quotes.get(option.definitionId);
      if(quote)return Number.isSafeInteger(quote.price)?[{...option,price:quote.price,priceVerified:true}]:[];
      return [{...option,price:150,priceVerified:true,pricePending:true}];
    })}));
    // Compare the full pool before accepting the priced subset. Otherwise free
    // club cards can end the search before stronger candidates are priced.
    const knownGroups=groups.map(group=>({...group,options:group.options.filter(option=>!option.pricePending)}));
    const canPlanKnown=knownGroups.every(group=>group.options.length||team.players.find(player=>player.index===group.slotIndex)?.definitionId);
    let known=null;
    if(canPlanKnown){
      known=await ea(tabId,'teamPlan',{fingerprint:team.fingerprint,budget:total,groups:knownGroups,allowChemistryFallback:results.some(group=>group.locked)},SBC_REQUEST_TIMEOUT);
      if(!groups.some(group=>group.options.some(card=>card.pricePending))){planned=known;break;}
    }
    if(round===maxPriceChecks||cardsPriced>=maxPriceChecks){
      planned=known||{plan:null,progressPlan:null};pricingIncomplete=true;
      planned={...planned,reason:'Price coverage is incomplete; this does not mean your budget is too low. Run the team search again to continue with recent prices saved.'};
      break;
    }
    planned=await ea(tabId,'teamPlan',{fingerprint:team.fingerprint,budget:total,groups,allowChemistryFallback:results.some(group=>group.locked)},SBC_REQUEST_TIMEOUT);
    const pending=[...new Set(((planned.plan||planned.progressPlan)?.choices||[]).filter(option=>option.pricePending).map(option=>option.definitionId))];
    if(!pending.length){if(!planned.plan&&known?.plan)planned=known;break;}
    const paused=Number((await chrome.storage.session.get(TEAM_PRICE_PAUSE_KEY))[TEAM_PRICE_PAUSE_KEY])||0;
    if(paused>Date.now())throw Error('EA paused live prices. FUTBIN estimates remain available; retry fallback prices later.');
    for(const id of pending.slice(0,maxPriceChecks-cardsPriced)){
      if(cardsPriced)await new Promise(resolve=>setTimeout(resolve,1000));
      teamProgress(`Pricing proposed lineup · ${cardsPriced+1} cards checked`);
      let batch;
      try{batch=await ea(tabId,'teamQuote',{fingerprint:team.fingerprint,definitionIds:[id],maxPrice:total},30000);}
      catch(error){
        if(error.status===429)await chrome.storage.session.set({[TEAM_PRICE_PAUSE_KEY]:Date.now()+5*60_000});
        throw Error(`Could not price the proposed lineup: ${error.message}`);
      }
      priceCheckedAt=batch.checkedAt;cardsPriced++;
      const quote=batch.quotes.find(quote=>quote.definitionId===id);
      if(!quote)throw Error('EA returned no price result for a proposed card.');
      quotes.set(id,quote);teamQuoteCache.set(`${cachePrefix}:${id}`,{quote,checkedAt:batch.checkedAt});
    }
  }
  for(const result of results)result.options=result.options.map(option=>{
    if(option.owned||option.priceEstimated)return {...option,priceVerified:true};
    const quote=quotes.get(option.definitionId);
    return {...option,price:quote?.price??null,priceVerified:Number.isSafeInteger(quote?.price),priceChecked:!!quote};
  });
  if(!broaden&&source==='FUTBIN'&&(planned?.plan?.choices.length!==results.length||planned?.plan?.chemistryTradeoff)){
    teamProgress('Expanding rankings for positions still to fill…');
    return recommendTeam(slots,budget,true,picks);
  }
  teamProgress('Team check complete.');
  return {team,results,linkSearchError,allowChemistryTradeoff:planned.plan?.chemistryTradeoff===true,plan:planned.plan,progressPlan:planned.progressPlan,planReason:planned.reason,pricingIncomplete,combinationsChecked:planned.combinationsChecked,totalBudget:total,checkedAt:Date.now(),priceCheckedAt,source:supplemental.size?'FUTBIN + FUT.GG':source,cardsPriced,priceMode:((planned.plan||planned.progressPlan)?.choices||results.flatMap(group=>group.options)).some(option=>option.priceEstimated)?'estimate':'live'};
}
async function applyTeamSuggestion(message){
  if(tradingBusy||sbcBuying||(await rawTradeState()).enabled||(await rawSbcBuy()).enabled)throw Error('Stop trading and SBC buying before adding concepts.');
  const saved=(await chrome.storage.session.get('futsbc-team-plan'))['futsbc-team-plan'];
  if(!saved?.plan||saved.planId!==message.planId||saved.applied||saved.applyUncertain)throw Error('Refresh Team and build a current recommendation before adding concepts.');
  const {tabId,team}=await connectedTeam();
  if(team.fingerprint!==saved.team.fingerprint)throw Error('Your squad changed. Refresh Team before adding concepts.');
  const groups=saved.plan.choices.map(choice=>({slotIndex:choice.slotIndex,allowRetained:false,options:[choice]}));
  let applied;
  try{
    applied=await ea(tabId,'teamApply',{fingerprint:team.fingerprint,budget:saved.totalBudget,minimumChemistry:saved.plan.chemistry,allowChemistryTradeoff:saved.allowChemistryTradeoff===true,groups},SBC_REQUEST_TIMEOUT);
  }catch(error){
    if(error.stage==='team-apply-save')await chrome.storage.session.set({'futsbc-team-plan':{...saved,applyUncertain:true}});
    throw error;
  }
  const result={...saved,plan:applied.plan||saved.plan,applied:true,planId:crypto.randomUUID()};
  await chrome.storage.session.set({'futsbc-team-plan':result});return result;
}
async function refreshSwapCandidates(saved,group,team,tabId,budget){
  const position=group.player.position;
  const pages=await currentFutggBest([position],120);
  const fixedAssets=new Set(saved.plan.choices.filter(choice=>choice.slotIndex!==group.slotIndex).map(choice=>choice.assetId));
  let ranked=selectFutggTeamPlayers(pages.get(futggBestURL(position)),[],120).filter(card=>!fixedAssets.has(card.assetId));
  let rankingError=ranked.length?null:'The position ranking could not be loaded.';
  {
    try{
      const slotBudget=Math.max(0,budget-saved.plan.choices.filter(card=>card.slotIndex!==group.slotIndex).reduce((sum,card)=>sum+(card.owned?0:card.price),0));
      const fallback=await currentTeamPlayers(Math.max(slotBudget,500));
      const extra=selectTeamPlayers(fallback,position,slotBudget,[...fixedAssets],48).map(card=>({...card,source:'FUTBIN'}));
      ranked=[...new Map([...extra,...ranked].map(card=>[card.definitionId||card.assetId,card])).values()];
      if(ranked.length)rankingError=null;
    }catch(error){rankingError=`Broader FUTBIN search unavailable: ${error.message}`;}
  }
  const merged=new Map(group.options.map(card=>[card.definitionId,card]));
  for(let offset=0;offset<ranked.length;offset+=48){
    const checked=await ea(tabId,'teamEvaluate',{slotIndex:group.slotIndex,fingerprint:team.fingerprint,budget,allowChemistryDrop:true,cards:ranked.slice(offset,offset+48)},SBC_REQUEST_TIMEOUT);
    for(const card of checked.options){
      const old=merged.get(card.definitionId);
      merged.set(card.definitionId,{...old,...card,...(!card.owned&&old?.priceVerified?{price:old.price,estimatedPrice:old.estimatedPrice,priceEstimated:old.priceEstimated,priceVerified:true,priceSource:old.priceSource,priceUpdatedAt:old.priceUpdatedAt}:{})});
    }
  }
  const candidates=[...merged.values()].filter(card=>!fixedAssets.has(card.assetId));
  const unknown=candidates.filter(card=>!card.owned&&!Number.isSafeInteger(card.price));
  if(unknown.length){
    const key='futsbc-console-estimates-v1',cache=(await chrome.storage.local.get(key))[key]||{};
    const estimates=await getConsoleEstimates(unknown.map(card=>card.definitionId),cache,(...args)=>{checkTeamReadCancelled();return fetch(...args);});
    checkTeamReadCancelled();
    await chrome.storage.local.set({[key]:estimates.cache});
    for(const quote of estimates.quotes){const card=merged.get(quote.definitionId);Object.assign(card,{price:quote.price,estimatedPrice:quote.price,priceVerified:true,priceEstimated:true,priceSource:quote.source,priceUpdatedAt:quote.updatedAt});}
  }
  const missing=[...merged.values()].filter(card=>!card.owned&&!Number.isSafeInteger(card.price)).sort((a,b)=>(a.metaRank||99)-(b.metaRank||99)).slice(0,8);
  let priceError=null;
  const pause=Number((await chrome.storage.session.get(TEAM_PRICE_PAUSE_KEY))[TEAM_PRICE_PAUSE_KEY])||0;
  for(const [index,card] of missing.entries()){
    if(index)await new Promise(resolve=>setTimeout(resolve,1000));
    if(pause>Date.now()){priceError='EA live price checks are temporarily paused.';break;}
    try{
      const batch=await ea(tabId,'teamQuote',{fingerprint:team.fingerprint,definitionIds:[card.definitionId],maxPrice:budget},30000);
      const quote=batch.quotes.find(quote=>quote.definitionId===card.definitionId);
      if(Number.isSafeInteger(quote?.price))Object.assign(card,{price:quote.price,priceVerified:true,priceEstimated:false,priceUpdatedAt:batch.checkedAt});
    }catch(error){
      if(error.status===429)await chrome.storage.session.set({[TEAM_PRICE_PAUSE_KEY]:Date.now()+5*60_000});
      priceError=error.message;break;
    }
  }
  checkTeamReadCancelled();
  group.options=[...merged.values()];
  await chrome.storage.session.set({'futsbc-team-plan':saved});
  return priceError||rankingError;
}
// Reuse trusted, worker-saved candidates; never accept prices or lineups from the UI.
async function swapTeamSuggestion(message){
  if(tradingBusy||sbcBuying||(await rawTradeState()).enabled||(await rawSbcBuy()).enabled)throw Error('Stop trading and SBC buying before changing recommendations.');
  const saved=(await chrome.storage.session.get('futsbc-team-plan'))['futsbc-team-plan'];
  if(!saved||message.planId!==saved.planId)throw Error('These suggestions changed in another panel. Build the team again before swapping.');
  if(!saved?.plan||Date.now()-saved.checkedAt>10*60_000)throw Error('Refresh team recommendations before swapping; these prices have expired.');
  const {tabId,team}=await connectedTeam();
  if(team.fingerprint!==saved.team.fingerprint)throw Error('Your squad changed. Refresh Team before swapping.');
  const slot=Number(message.slotIndex),group=saved.results.find(row=>row.slotIndex===slot);
  if(!group)throw Error('Choose a selected position to swap.');
  if(group.locked)throw Error('This is a build-around player. Select its position for replacement and build a new team to change it.');
  const budget=saved.totalBudget;
  const priceError=message.type==='teamAlternatives'?await refreshSwapCandidates(saved,group,team,tabId,budget):null;
  const choices=saved.plan.choices;
  const options=group.options.filter(option=>option.priceVerified&&!option.pricePending&&(option.owned||Number.isSafeInteger(option.price))&&Number(option.definitionId)!==Number(choices.find(choice=>choice.slotIndex===slot)?.definitionId));
  const requested=message.type==='teamSwap'?options.filter(option=>option.definitionId===Number(message.definitionId)):options;
  if(!requested.length)throw Error(priceError?`Alternative price checks failed: ${priceError}`:'No other exact, priced meta cards were found for this position.');
  const groups=choices.filter(choice=>choice.slotIndex!==slot).map(choice=>({slotIndex:choice.slotIndex,allowRetained:false,options:[choice]}));
  groups.push({slotIndex:slot,allowRetained:false,options:requested});
  const checked=await ea(tabId,'teamPlan',{fingerprint:team.fingerprint,budget,groups,alternativesForSlot:slot,allowChemistryTradeoff:true},SBC_REQUEST_TIMEOUT);
  const alternatives=(checked.alternatives||[]).filter(plan=>plan.choices.length===groups.length);
  if(message.type==='teamAlternatives'){
    const labels={invalidCards:'could not be matched to an eligible exact card',overBudget:'over budget',duplicatePlayer:'duplicate player',chemistryUnavailable:'chemistry could not be calculated',totalChemistry:'would lower total chemistry',newCardChemistry:'new cards below two chemistry',retainedChemistry:'would lower retained-player chemistry',belowTarget:'below the squad chemistry target'};
    const details=Object.entries(checked.rejections||{}).filter(([,count])=>count>0).map(([key,count])=>`${count} ${labels[key]||key}`).join('; ');
    const available=Math.max(0,budget-choices.filter(card=>card.slotIndex!==slot).reduce((sum,card)=>sum+(card.owned?0:card.price),0));
    const reason=`No verified swap in this candidate pool (${options.length} priced cards; ${available.toLocaleString()} coins available). ${details||checked.reason||'No complete alternative passed EA checks.'}${priceError?` ${priceError}`:''} This is not an exhaustive search of every card.`;
    return {slotIndex:slot,reason,rejections:checked.rejections,alternatives:alternatives.map(plan=>({card:plan.choices.find(choice=>choice.slotIndex===slot),chemistry:plan.chemistry,chemistryChange:plan.chemistry-saved.plan.chemistry,cost:plan.cost,priceChange:plan.cost-saved.plan.cost,remaining:plan.remaining}))};
  }
  const plan=alternatives.find(plan=>plan.choices.some(choice=>choice.slotIndex===slot&&choice.definitionId===Number(message.definitionId)));
  if(!plan)throw Error('This swap could not be verified within your budget. Your previous suggestions are unchanged.');
  const result={...saved,allowChemistryTradeoff:true,planId:crypto.randomUUID(),team,plan,totalBudget:budget,combinationsChecked:checked.combinationsChecked};
  await chrome.storage.session.set({'futsbc-team-plan':result});return result;
}
async function quickFlipTraderCards(pages,balance){
  const eligible=selectMarketCards(pages,balance,Date.now(),350);
  if(!eligible.length)return [];
  return quickFlipCards(eligible,await salesLedger());
}
const HUNT_INTERVAL_MS=20_000;
const WATCH_INTERVAL_MS=8_000;
const ACTIVE_PERIOD_MS=35*60_000;
const ROUTINE_BREAK_MS=5*60_000;
async function runAutoTrade(){
  if(tradingBusy||busy){
    if((await tradeState()).enabled)armTrade(Date.now()+HUNT_INTERVAL_MS);
    return;
  }
  tradingBusy=true;
  try{
    let session=await tradeState();
    if(!session.enabled)return;
    if(session.mode!=='auction')throw Error('The saved trader mode changed. Restart the auction trader.');
    if(session.inFlight)throw Error('A previous auction request was interrupted. Check Transfer Targets and New Items.');
    const tab=await chrome.tabs.get(session.tabId);
    if(!isEaWebAppURL(tab.url))throw Error('The FC Web App tab closed or navigated away.');
    const current=await ea(session.tabId,'tradeStatus',null,TRADE_REQUEST_TIMEOUT);
    if(!(await tradeState()).enabled)return;
    let activeBids=Array.isArray(session.activeBids)?session.activeBids:(session.activeBid?[session.activeBid]:[]);
    session={...session,activeBids,activeBid:null,lastBalance:current.balance};
    await saveTrade(session);
    if(!session.lastInventoryAt||Date.now()-session.lastInventoryAt>=60_000){
      const ledger=await salesLedger(),pending=ledger.filter(record=>!record.soldAt);
      if(pending.length){
        const inventory=await ea(session.tabId,'tradeInventory',{records:pending},TRADE_REQUEST_TIMEOUT);
        const nextLedger=reconcileSales(ledger,inventory.updates||[]);
        await chrome.storage.local.set({[SALES_KEY]:nextLedger});
        session={...session,realizedProfit:nextLedger.filter(record=>record.soldAt).reduce((sum,record)=>sum+record.profit,0),unsoldCards:nextLedger.filter(record=>!record.soldAt).length};
      }
      session={...session,lastInventoryAt:Date.now()};await saveTrade(session);
    }
    if(activeBids.length){
      await saveTrade({...session,inFlight:true,inFlightAt:Date.now(),candidate:{name:`${activeBids.length} watched auction(s)`},status:`Checking ${activeBids.length} Transfer Target(s)…`});
      const watched=await ea(session.tabId,'tradeWatchBatch',{orders:activeBids},TRADE_REQUEST_TIMEOUT);
      session=await tradeState();
      const updates=new Map(watched.updates.map(update=>[String(update.tradeId),update]));
      const remaining=[],finished=[];
      let review=null,wonCount=0,spent=0;
      for(const order of activeBids){
        const update=updates.get(String(order.tradeId));
        if(!update){remaining.push(order);continue;}
        if(['pending','highest','bid'].includes(update.phase)){
          remaining.push({...order,...update,lastBid:update.bid??order.lastBid});
        }else if(update.phase==='listed'){
          if(!order.winAccounted){wonCount++;spent+=update.paid;}
          finished.push({name:order.name,definitionId:order.definitionId,itemId:update.itemId,tradeId:order.tradeId,buy:update.paid,sell:update.sell,purchased:true,listed:true,at:Date.now()});
        }else if(['missing-watch','won-unlisted','error'].includes(update.phase)){
          const winAccounted=order.winAccounted||update.phase==='won-unlisted'&&Number.isSafeInteger(update.paid);
          remaining.push({...order,...update,winAccounted});
          if(winAccounted&&!order.winAccounted){wonCount++;spent+=update.paid;}
          review=review||update.warning||`Could not verify ${order.name} in Transfer Targets. Check EA before restarting.`;
        }
      }
      if(finished.length){
        const ledger=await salesLedger();
        for(const record of finished){
          if(record.itemId&&!ledger.some(saved=>saved.tradeId===record.tradeId))ledger.push({...record,listedAt:record.at,state:'selling'});
        }
        await chrome.storage.local.set({[SALES_KEY]:ledger.slice(-500)});
      }
      activeBids=remaining;
      session={...session,activeBids,inFlight:false,inFlightAt:null,candidate:null,watchFailures:0,lastBalance:watched.balance,spent:(session.spent||0)+spent,completedTrades:(session.completedTrades||0)+wonCount,history:[...finished,...(session.history||[])].slice(0,25),lastTrade:finished[0]||session.lastTrade};
      if(review){
        await saveTrade({...session,enabled:false,recoveryRequired:true,nextAt:null,status:review});
        await chrome.alarms.clear(TRADE_ALARM);
        return;
      }
      if(!session.enabled){await saveTrade({...session,recoveryRequired:activeBids.length>0,nextAt:null,status:'Stopped. Check Transfer Targets before restarting.'});return;}
      await saveTrade(session);
    }
    if(session.watchOnly){
      if(!activeBids.length){
        await saveTrade({...session,enabled:false,watchOnly:false,pendingBid:null,recoveryRequired:false,nextAt:null,status:'The saved auction is no longer active. Check Transfer Targets and New Items before starting a new hunt.'});
        await chrome.alarms.clear(TRADE_ALARM);
        return;
      }
      const nextAt=Date.now()+WATCH_INTERVAL_MS;
      await saveTrade({...session,nextAt,status:`Monitoring ${activeBids.length} saved auction(s). No new auction searches.`});
      armTrade(nextAt);
      return;
    }
    const now=Date.now();
    if(session.cooldownUntil&&session.cooldownUntil<=now)session={...session,cooldownUntil:null};
    if(!session.cooldownUntil&&now>=(session.nextBreakAt||now+ACTIVE_PERIOD_MS)){
      session={...session,cooldownUntil:now+ROUTINE_BREAK_MS,nextBreakAt:now+ROUTINE_BREAK_MS+ACTIVE_PERIOD_MS};
    }
    if(session.cooldownUntil>now){
      const nextAt=activeBids.length?now+WATCH_INTERVAL_MS:session.cooldownUntil;
      await saveTrade({...session,nextAt,status:`Cooling down from new bids; watching ${activeBids.length} active auction(s).`});
      armTrade(nextAt);return;
    }
    if(session.lastHuntAt&&now-session.lastHuntAt<HUNT_INTERVAL_MS){
      const nextAt=activeBids.length?now+WATCH_INTERVAL_MS:session.lastHuntAt+HUNT_INTERVAL_MS;
      await saveTrade({...session,nextAt,status:activeBids.length?`Watching ${activeBids.length} active auction(s).`:'Waiting for the next auction page scan.'});
      armTrade(nextAt);return;
    }
    let evidence=session.marketEvidence;
    if(!Array.isArray(evidence?.cards)||!evidence.cards.length||evidence.researchVersion!==4||now-evidence.checkedAt>60_000){
      await saveTrade({...session,inFlight:true,inFlightAt:now,candidate:null,status:'Refreshing FUTBIN console prices…'});
      const futbinTabId=await marketTab(session);
      const market=await collectFutbinMarket(futbinTabId,current.balance);
      const cards=await quickFlipTraderCards(market.pages,current.balance);
      evidence={checkedAt:Date.now(),sourceURL:market.pages.at(-1)?.url,rows:market.pages.reduce((sum,page)=>sum+page.rowCount,0),researchVersion:4,shortlisted:cards.length,bands:market.pages.length,assetId:cards[0]?.assetId??null,cards};
      session={...await tradeState(),futbinTabId,marketEvidence:evidence,inFlight:false,inFlightAt:null};
      await saveTrade(session);
      if(!session.enabled)return;
    }
    if(!evidence.cards.length){
      const nextAt=Date.now()+HUNT_INTERVAL_MS;
      await saveTrade({...session,lastHuntAt:Date.now(),nextAt,status:`Checked ${evidence.rows} FUTBIN rows; no basic card had sufficiently fresh, stable price estimates for a quick-flip check.`});
      armTrade(nextAt);return;
    }
    const card=selectHuntCard(evidence.cards,activeBids,await salesLedger(),session.huntIndex||0);
    await saveTrade({...session,inFlight:true,inFlightAt:Date.now(),candidate:{name:card.name},status:`Scanning expiring ${card.name} auctions…`});
    const hunt=await ea(session.tabId,'tradeAuctionHunt',{cards:[card],startPage:session.huntPages?.[card.assetId]||1,existingTradeIds:activeBids.map(order=>order.tradeId)},TRADE_REQUEST_TIMEOUT);
    session=await tradeState();
    activeBids=[...activeBids,...hunt.bids];
    const selected=hunt.bids[0];
    evidence={...evidence,selected:selected?{name:selected.name,tradeId:selected.tradeId,futbinPrice:selected.futbinPrice,eaReference:selected.reference,bid:selected.lastBid,sell:selected.sell,estimatedProfit:Math.floor(selected.sell*.95)-selected.lastBid,url:selected.futbinURL}:evidence.selected};
    session={...session,activeBids,activeBid:null,marketEvidence:evidence,lastBalance:hunt.balance,lastHuntAt:Date.now(),lastScan:{at:Date.now(),name:card.name,auctions:hunt.auctions,pages:hunt.pages,candidates:hunt.candidates,rejections:hunt.rejections||{}},huntIndex:(session.huntIndex||0)+1,huntPages:{...session.huntPages,[card.assetId]:hunt.nextPage||1},inFlight:false,inFlightAt:null,candidate:null};
    if(hunt.halt){
      const rateLimited=hunt.halt.status===429;
      await saveTrade({...session,enabled:false,recoveryRequired:activeBids.length>0,nextAt:null,rateLimitAt:rateLimited?Date.now():session.rateLimitAt,cooldownUntil:rateLimited?Date.now()+RATE_LIMIT_PAUSE_MS:session.cooldownUntil,status:`EA stopped auction targeting (${hunt.halt.status}). ${activeBids.length} saved bid(s) remain tracked. Check Transfer Targets before restarting.`});
      await chrome.alarms.clear(TRADE_ALARM);return;
    }
    if(hunt.uncertain){
      const delta=Number(hunt.uncertain.balanceBeforeBid)-Number(hunt.uncertain.balanceAfterBid);
      const balanceNote=Number.isSafeInteger(delta)&&delta>0?` Coin balance fell by ${delta.toLocaleString()} during the request; that does not prove whether the bid is active.`:'';
      const canMonitor=session.enabled&&![401,429].includes(Number(hunt.uncertain.status));
      if(canMonitor){
        const watched=[...activeBids];
        if(!watched.some(order=>String(order.tradeId)===String(hunt.uncertain.tradeId)))watched.push(hunt.uncertain);
        const nextAt=Date.now()+WATCH_INTERVAL_MS;
        await saveTrade({...session,enabled:true,watchOnly:true,recoveryRequired:false,pendingBid:hunt.uncertain,activeBids:watched,watchFailures:0,nextAt,status:`EA did not confirm the bid on ${hunt.uncertain.name} (${hunt.uncertain.tradeId}): ${hunt.uncertain.error}${balanceNote} Checking saved auctions in Transfer Targets; no new auction hunts.`});
        armTrade(nextAt);return;
      }
      await saveTrade({...session,enabled:false,recoveryRequired:true,pendingBid:hunt.uncertain,nextAt:null,status:`Bid on ${hunt.uncertain.name} (${hunt.uncertain.tradeId}) needs review: ${hunt.uncertain.error}${balanceNote} Check Transfer Targets and New Items before restarting.`});
      await chrome.alarms.clear(TRADE_ALARM);return;
    }
    if(!session.enabled){await saveTrade({...session,recoveryRequired:activeBids.length>0,nextAt:null,status:'Stopped. Check Transfer Targets before restarting.'});return;}
    const nextAt=Date.now()+(activeBids.length?WATCH_INTERVAL_MS:HUNT_INTERVAL_MS);
    const status=hunt.bids.length?`Placed ${hunt.bids.length} profitable bid(s) on ${card.name}; watching ${activeBids.length} Transfer Target(s).`:`Checked ${hunt.pages} ${card.name} page(s), ${hunt.auctions} auctions; no near-expiry bid met the live profit check.`;
    await saveTrade({...session,nextAt,status});armTrade(nextAt);
  }catch(error){
    const latest=await tradeState();
    if(latest.watchOnly&&error.stage==='targets-watch'&&![401,429].includes(Number(error.status))){
      const watchFailures=(latest.watchFailures||0)+1;
      if(watchFailures>=3){
        await saveTrade({...latest,enabled:false,inFlight:false,inFlightAt:null,candidate:null,recoveryRequired:true,watchFailures,nextAt:null,status:`EA could not verify the saved auction after ${watchFailures} Transfer Targets checks${error.status?` (last response ${error.status})`:''}. Check Transfer Targets and New Items in EA before restarting.`});
        await chrome.alarms.clear(TRADE_ALARM);
        return;
      }
      const nextAt=Date.now()+60_000;
      await saveTrade({...latest,enabled:true,inFlight:false,inFlightAt:null,candidate:null,watchFailures,nextAt,status:`EA could not read the saved auction${error.status?` (${error.status})`:''}. Retrying in 1 minute (${watchFailures}/3); no new searches or bids.`});
      armTrade(nextAt);
      return;
    }
    const uncertain=!!(latest.recoveryRequired||latest.activeBids?.length||latest.candidate&&error.stage!=='market-search'&&error.stage!=='targets-read');
    const rateLimited=error.status===429||/(?:^|\D)429(?:\D|$)/.test(error.message);
    const now=Date.now();
    const failedStep=error.stage==='targets-read'||error.stage==='targets-watch'?'Transfer Targets read':error.stage==='market-search'?`auction search${error.page?` page ${error.page}`:''}`:null;
    const status=rateLimited?`EA limited market requests (429). FutSBC stopped for at least 30 minutes. Check Transfer Targets and New Items before restarting.`:Number(error.status)===401&&!uncertain?'EA session expired (401). Sign in to the Web App, then check EA requests before restarting.':Number(error.status)===426&&failedStep?`EA rejected the ${failedStep} (426). Manual player searches may still work. ${uncertain?'Check existing Transfer Targets and New Items before restarting.':'No bid was placed in this scan.'}`:uncertain?`Stopped during ${latest.candidate?.name||'an auction'}: ${error.message} Check Transfer Targets and New Items before restarting.`:`Stopped: ${error.message}`;
    await saveTrade({...latest,enabled:false,inFlight:false,inFlightAt:null,stopRequestedAt:null,recoveryRequired:uncertain,nextAt:null,rateLimitAt:rateLimited?now:latest.rateLimitAt,cooldownUntil:rateLimited?now+RATE_LIMIT_PAUSE_MS:latest.cooldownUntil,status});
    await chrome.alarms.clear(TRADE_ALARM);
  }finally{tradingBusy=false;await chrome.alarms.clear(STOP_ALARM);}
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===TRADE_ALARM)void runAutoTrade();if(alarm.name===STOP_ALARM)void tradeState();if(alarm.name===SBC_BUY_ALARM)void runSbcBuy();if(alarm.name===INSIGHTS_ALARM){if(busy||tradingBusy||sbcBuying)chrome.alarms.create(INSIGHTS_ALARM,{when:Date.now()+60_000,periodInMinutes:1440});else{busy=true;void refreshMarketInsights().catch(()=>{}).finally(()=>{busy=false;});}}});
void (async()=>{
  const previous=await rawSbcBuy();
  if(!previous.enabled)return;
  if(previous.pending?.operation==='fill'){
    await saveSbcBuy({...previous,enabled:false,review:false,pending:null,status:'The final squad check was interrupted. Reopen the SBC and check its cards before continuing.'});
    return;
  }
  if(previous.pending){
    await saveSbcBuy({...previous,enabled:false,review:true,status:`Purchase of ${previous.pending.name} was interrupted. Check New Items and your club before restarting.`});
    return;
  }
  armSbcBuy(Math.max(Date.now()+1000,previous.nextAt||Date.now()+1000));
})();
void (async()=>{
  const previous=await tradeState();
  if(!previous.enabled)return;
  if(previous.mode!=='auction'){await saveTrade({...previous,enabled:false,inFlight:false,nextAt:null,status:'Auction bidding is ready. Start the trader to use it.'});await chrome.alarms.clear(TRADE_ALARM);return;}
  if(previous.inFlight){await saveTrade({...previous,enabled:false,inFlight:false,inFlightAt:null,recoveryRequired:!!(previous.candidate||previous.activeBid||previous.activeBids?.length),nextAt:null,status:previous.candidate||previous.activeBid||previous.activeBids?.length?'Stopped after an interrupted auction request. Check Transfer Targets and New Items before restarting.':'Stopped after an interrupted market search.'});return;}
  armTrade(Math.max(Date.now()+1000,previous.nextAt||Date.now()+1000));
})();
async function dispatch(message) {
  if(message.type==='cardArt')return cardArt(Number(message.assetId),Number(message.definitionId));
  if(message.type==='teamSnapshot')return (await connectedTeam()).team;
  if(message.type==='teamRunState')return teamRun;
  if(message.type==='teamCancel'){teamRun={...teamRun,cancelled:true,status:'Stopping after the current EA request…'};await cancelTeamRead();return teamRun;}
  if(message.type==='teamRecommend')return runTeamRecommendation(message.slots,message.budget,message.picks);
  if(message.type==='teamPlayerSearch'){
    const {tabId,team}=await connectedTeam();
    if(team.fingerprint!==message.fingerprint)throw Error('Your squad changed. Refresh Team before searching.');
    const found=await ea(tabId,'teamPlayerSearch',{slotIndex:message.slotIndex,query:message.query,fingerprint:team.fingerprint},SBC_REQUEST_TIMEOUT);
    const previous=(await chrome.storage.session.get('futsbc-team-picker'))['futsbc-team-picker'];
    const prior=previous?.fingerprint===team.fingerprint?previous.cards||[]:[];
    const cards=[...new Map([...prior,...found.cards.map(card=>({...card,slotIndex:message.slotIndex}))].map(card=>[`${card.slotIndex}:${card.definitionId}`,card])).values()].slice(-500);
    await chrome.storage.session.set({'futsbc-team-picker':{fingerprint:team.fingerprint,cards}});return found;
  }
  if(message.type==='teamApply')return applyTeamSuggestion(message);
  if(message.type==='teamAlternatives'||message.type==='teamSwap'){teamRun={running:true,startedAt:Date.now(),status:'Checking swap alternatives…'};if(message.type==='teamAlternatives')activeTeamRead={id:crypto.randomUUID(),cancelled:false,tabs:new Set()};try{return await swapTeamSuggestion(message);}finally{activeTeamRead=null;teamRun={...teamRun,running:false};}}
  if(message.type==='teamPriceCheck'){
    const {tabId,team}=await connectedTeam();
    return ea(tabId,'teamQuote',{fingerprint:team.fingerprint,definitionIds:message.definitionIds,maxPrice:Number(message.maxPrice)},SBC_REQUEST_TIMEOUT);
  }
  if(message.type==='teamMarket'){
    const {tabId}=await connectedTeam();
    return ea(tabId,'teamMarket',{definitionId:message.definitionId},SBC_REQUEST_TIMEOUT);
  }
  if(message.type==='marketInsightsState'){
    const current=await insightsState(),config=await insightsConfig();
    return {...current,modelConfigured:!!config.key,modelName:GEMINI_MODEL};
  }
  if(message.type==='marketInsightsRefresh')return refreshMarketInsights();
  if(message.type==='marketInsightsSetKey'){
    const key=normalizeGeminiKey(message.key);
    const previousConfig=await insightsConfig();
    await chrome.storage.local.set({[INSIGHTS_CONFIG_KEY]:key?{key}:{}});
    let current=await insightsState();
    const changed=previousConfig.key!==key;
    if(changed){
      current={...current,brief:current.brief?{...current.brief,model:null}:current.brief,modelError:null};
      await saveInsights(current);
    }
    const brief=current.brief;
    if(key&&brief?.candidates?.length&&Number.isSafeInteger(brief.at)&&Date.now()-brief.at<=36*60*60_000&&(!brief.model||current.modelError)){
      try{
        const model=await generateMarketNotes(brief,key);
        current={...current,brief:{...brief,model},modelError:null};
      }catch(error){
        current={...current,modelError:error.name==='AbortError'?'Gemini took too long to respond. Try again later.':error.message};
      }
      await saveInsights(current);
    }
    return {...current,modelConfigured:!!key,modelName:GEMINI_MODEL};
  }
  if(message.type==='tradeState') return {...await tradeState(),portfolio:portfolioSummary(await salesLedger())};
  if(message.type==='tradeCheckFutbin'){
    if(busy||tradingBusy)throw Error('Wait for the current operation to finish.');
    const previous=await tradeState();
    if(previous.enabled||previous.inFlight)throw Error('Stop the auto trader before checking FUTBIN separately.');
    tradingBusy=true;
    try{
      const tabs=await findEaTabs(chrome.tabs);
      let balance,lastError='Open the signed-in FC 27 console Web App first.';
      for(const tab of tabs.sort((a,b)=>Number(b.active)-Number(a.active))){
        try{balance=(await ea(tab.id,'tradeStatus',null,TRADE_REQUEST_TIMEOUT)).balance;break;}catch(error){lastError=error.message;}
      }
      if(!Number.isSafeInteger(balance)||balance<150)throw Error(lastError);
      const futbinTabId=await marketTab({...previous,lastBalance:balance});
      const market=await collectFutbinMarket(futbinTabId,balance);
      const selected=market.cards[0];
      const marketEvidence={checkedAt:Date.now(),sourceURL:market.pages.at(-1)?.url,rows:market.pages.reduce((sum,page)=>sum+page.rowCount,0),shortlisted:market.cards.length,bands:market.pages.length,assetId:selected?.assetId??null,selected:selected?{name:selected.name,futbinPrice:selected.consolePrice,trend:selected.trend,updatedSeconds:selected.updatedSeconds,url:selected.url}:null};
      const next={...await tradeState(),futbinTabId,lastBalance:balance,marketEvidence,status:`Read ${marketEvidence.rows} FC 27 console rows from FUTBIN; ${marketEvidence.shortlisted} passed the current-price checks. No EA bids were placed.`};
      await saveTrade(next);return next;
    }catch(error){
      const next={...await tradeState(),status:`FUTBIN check failed: ${error.message}`};
      await saveTrade(next);throw error;
    }finally{tradingBusy=false;}
  }
  if(message.type==='tradeDiagnose') {
    if(busy||tradingBusy) throw Error('Wait for the current operation to finish.');
    const previous=await tradeState();
    if(previous.enabled||previous.inFlight) throw Error('Stop the auto trader before checking market searches.');
    if(previous.cooldownUntil>Date.now())throw Error('EA has limited market searches. Wait for the pause shown in FutSBC before checking again.');
    tradingBusy=true;
    try {
      const tabs=await findEaTabs(chrome.tabs);
      let tabId,balance,lastError='Open the FC 27 Web App and sign in first.';
      for(const tab of tabs.sort((a,b)=>Number(b.active)-Number(a.active))){
        try{balance=(await ea(tab.id,'tradeStatus',null,TRADE_REQUEST_TIMEOUT)).balance;tabId=tab.id;break;}catch(error){lastError=error.message;}
      }
      if(!tabId) throw Error(lastError);
      const targetId=previous.marketEvidence?.assetId;
      const freshTarget=Number.isSafeInteger(targetId)&&targetId>0&&Date.now()-previous.marketEvidence.checkedAt<=10*60_000;
      const result=await ea(tabId,'tradeDiagnose',freshTarget?{assetId:targetId}:null,TRADE_REQUEST_TIMEOUT);
      const status=result.status===401?'EA session expired (401). Sign in to the Web App, then check EA requests again. No bids were placed.'
        :result.stage==='targets'?`EA rejected the Transfer Targets read (${result.status??'unknown'}). Manual market search does not test this request. No bids were placed.`
        :result.stage==='targets-data'?'EA returned an unreadable Transfer Targets response. No market search or bid was attempted.'
        :result.stage==='target'?`EA rejected the FUTBIN card search (${result.status??'unknown'}). No bids were placed.`
        :/^target-page\d+$/.test(result.stage||'')?`EA accepted earlier pages but rejected page ${result.stage.slice(11)} of the FUTBIN card search (${result.status??'unknown'}). No bids were placed.`
        :result.stage==='target-complete'?`EA accepted ${result.pages} FUTBIN card page(s): ${result.exactCount} listings, ${result.sameCount} matching cards. No bids were placed.`
        :result.stage==='broad'?`EA rejected the broad market search (${result.status??'unknown'}). No further searches were made.`
        :result.stage==='exact'?`Broad search returned ${result.broadCount} listings; EA rejected the exact-card search (${result.status??'unknown'}).`
        :result.stage==='empty'?'EA accepted the broad search but returned no affordable player listings.'
        :`EA accepted both searches: ${result.broadCount} broad listings, ${result.exactCount} exact-search results, ${result.sameCount} matching cards.`;
      const rateLimited=Number(result.status)===429;
      const now=Date.now();
      const next={...previous,lastBalance:balance,status:rateLimited?'EA limited market requests (429). FutSBC stopped for at least 30 minutes. Test a normal EA market search after the pause.':status,diagnostic:{...result,at:now},rateLimitAt:rateLimited?now:previous.rateLimitAt,cooldownUntil:rateLimited?now+RATE_LIMIT_PAUSE_MS:previous.cooldownUntil};
      await saveTrade(next);
      return next;
    } finally {tradingBusy=false;}
  }
  if(message.type==='tradeReview'){
    if(busy||tradingBusy)throw Error('Wait for the current operation to finish.');
    const previous=await tradeState();
    if(previous.enabled||previous.inFlight)throw Error('Stop the auto trader before reviewing a bid.');
    const order=previous.pendingBid;
    if(!order?.tradeId)throw Error('This older run did not save an auction ID. Check Transfer Targets and New Items directly in EA.');
    tradingBusy=true;
    try{
      const result=await ea(previous.tabId,'tradeReview',{tradeId:order.tradeId,lastBid:order.lastBid},TRADE_REQUEST_TIMEOUT);
      const next={...previous,lastBalance:result.balance,pendingBid:{...order,lastReview:result,reviewedAt:Date.now()},status:result.phase==='highest'||result.phase==='won'
        ?`${order.name} (${order.tradeId}) is ${result.phase==='won'?'won':'the highest bid'} in Transfer Targets. Review it in EA before restarting.`
        :result.phase==='outbid'?`${order.name} (${order.tradeId}) is outbid in Transfer Targets. Check New Items before restarting.`
        :result.phase==='lost'?`${order.name} (${order.tradeId}) has ended without a verified win. Check New Items in EA before starting another hunt.`
        :result.phase==='below-attempt'?`EA shows ${order.name} (${order.tradeId}) with a current bid of ${Number(result.bid||0).toLocaleString()}, below FutSBC’s attempted ${Number(order.lastBid).toLocaleString()}. The bid was not confirmed; retry monitoring this auction.`
        :result.phase==='not-found'?`${order.name} (${order.tradeId}) is not in Transfer Targets. It may have moved; check New Items before restarting.`
        :result.reason==='items-missing'?`EA answered the Transfer Targets check but did not include an item list for ${order.name} (${order.tradeId}). Retry monitoring the saved auction; no new auction hunt will start.`
        :result.reason==='request-rejected'?`EA rejected the Transfer Targets check for ${order.name} (${order.tradeId})${result.status?` (${result.status})`:''}. Retry monitoring the saved auction; no new auction hunt will start.`
        :result.phase==='unconfirmed'?`EA found ${order.name} (${order.tradeId}) but did not mark the attempted ${Number(order.lastBid).toLocaleString()} bid as highest, outbid, or won. Current bid: ${Number(result.bid||0).toLocaleString()}. Retry monitoring this auction; new hunts stay off.`
        :`EA could not provide a fresh status for ${order.name} (${order.tradeId})${result.status?` (${result.status})`:''}. You can continue monitoring this saved auction without starting new searches.`};
      await saveTrade(next);return next;
    }finally{tradingBusy=false;}
  }
  if(message.type==='tradeStart') {
    if(busy||tradingBusy||sbcBuying||(await rawSbcBuy()).enabled)throw Error('Finish or stop SBC buying before starting the trader.');
    const previous=await tradeState();
    if(previous.enabled) return previous;
    if(previous.inFlight) throw Error('The last EA request may still be running. Check New Items and Transfer List before restarting.');
    if(previous.recoveryRequired) throw Error('Check Transfer Targets and New Items, then mark the auction as reviewed before restarting.');
    if(previous.activeBid||previous.activeBids?.length) throw Error('Check active auctions in Transfer Targets before restarting.');
    if(previous.cooldownUntil>Date.now())throw Error('EA has limited market searches. Wait for the pause shown in FutSBC before restarting.');
    const tabs=await findEaTabs(chrome.tabs);
    let result,tabId,lastError='Open the FC 27 Web App and sign in first.';
    for(const tab of tabs.sort((a,b)=>Number(b.active)-Number(a.active))){
      try{result=await ea(tab.id,'tradeStatus',null,TRADE_REQUEST_TIMEOUT);tabId=tab.id;break;}catch(error){lastError=error.message;}
    }
    if(!result)throw Error(lastError);
    if(!Number.isSafeInteger(result.balance)||result.balance<150)throw Error('At least 150 coins are needed to search for a market listing.');
    const next={mode:'auction',enabled:true,tabId,futbinTabId:previous.futbinTabId,startingBalance:result.balance,lastBalance:result.balance,spent:0,completedTrades:0,inFlight:false,activeBid:null,activeBids:[],huntIndex:0,nextBreakAt:Date.now()+ACTIVE_PERIOD_MS,nextAt:Date.now()+1000,status:'Starting FUTBIN market check…',history:[]};
    await saveTrade(next);armTrade(next.nextAt);return next;
  }
  if(message.type==='tradeStop'){
    const previous=await tradeState();
    const activeAuction=!!(previous.activeBid||previous.activeBids?.length);
    const next={...previous,enabled:false,nextAt:null,recoveryRequired:activeAuction||previous.recoveryRequired,stopRequestedAt:previous.inFlight?Date.now():null,status:previous.inFlight?'Stopping after the current EA request. Check the outcome before restarting.':activeAuction?'Stopped with an active bid. Check Transfer Targets before restarting.':'Stopped.'};
    await saveTrade(next);await chrome.alarms.clear(TRADE_ALARM);
    if(previous.inFlight)chrome.alarms.create(STOP_ALARM,{when:Date.now()+TRADE_REQUEST_TIMEOUT+1000});
    return next;
  }
  if(message.type==='tradeReset'){
    if(busy||tradingBusy)throw Error('An EA request is still running. Stop the trader and reset after it finishes.');
    tradingBusy=true;
    try{
      const previous=await tradeState();
      if(previous.inFlight)throw Error('An EA request may still be running. Check its outcome before resetting.');
      const keepRateLimit=!!previous.rateLimitAt&&previous.cooldownUntil>Date.now();
      const next={mode:'auction',enabled:false,inFlight:false,recoveryRequired:false,activeBids:[],status:keepRateLimit
        ?'Trader session reset. EA’s market-request pause remains active. Check Transfer Targets and New Items for any existing auctions.'
        :'Trader session reset. Check Transfer Targets and New Items for any existing auctions before starting again.'};
      if(keepRateLimit){next.rateLimitAt=previous.rateLimitAt;next.cooldownUntil=previous.cooldownUntil;}
      await saveTrade(next);
      await Promise.all([chrome.alarms.clear(TRADE_ALARM),chrome.alarms.clear(STOP_ALARM)]);
      return next;
    }finally{tradingBusy=false;}
  }
  if(message.type==='tradeRecover'){
    const previous=await tradeState();
    if(previous.enabled||previous.inFlight||tradingBusy)throw Error('Wait for the current EA request to finish.');
    if(!previous.recoveryRequired)return previous;
    const order=previous.pendingBid;
    const resolvedReview=['not-found','lost'].includes(order?.lastReview?.phase);
    const monitor=!!previous.activeBids?.length||!!previous.activeBid||!!order&&!resolvedReview;
    if(monitor){
      const activeBids=Array.isArray(previous.activeBids)?[...previous.activeBids]:(previous.activeBid?[previous.activeBid]:[]);
      if(order&&!resolvedReview&&!activeBids.some(active=>String(active.tradeId)===String(order.tradeId)))activeBids.push(order);
      const nextAt=Date.now()+1000;
      const next={...previous,mode:'auction',enabled:true,watchOnly:true,recoveryRequired:false,activeBid:null,activeBids,inFlight:false,inFlightAt:null,candidate:null,watchFailures:0,nextAt,status:`Monitoring ${activeBids.length} saved auction(s). No new auction searches.`};
      await saveTrade(next);armTrade(nextAt);return next;
    }
    const next={...previous,recoveryRequired:false,watchOnly:false,candidate:null,pendingBid:null,activeBid:null,activeBids:[],status:'Transfer Targets and New Items reviewed. Ready to start.'};
    await saveTrade(next);return next;
  }
  if(message.type==='sbcBuildStop'){
    if(activeSbcBuild){
      const run=activeSbcBuild;
      await chrome.scripting.executeScript({target:{tabId:run.tabId},world:'MAIN',func:function stopSbcBuild(id){if(window.__futsbcSbcBuildProgress?.status==='Saving the verified squad…')return;window.__futsbcCancelledSbcBuild=id;},args:[run.id]});
    }
    return state();
  }
  if(message.type==='state') return state();
  if(message.type==='sbcBuyState')return rawSbcBuy();
  if(message.type==='sbcBuyStop'){
    const current=await rawSbcBuy();
    const next={...current,enabled:false,status:current.pending?'Stopping after the current EA purchase. Check its result before restarting.':'Stopped. Cards already bought remain in your club.'};
    await saveSbcBuy(next);await chrome.alarms.clear(SBC_BUY_ALARM);return next;
  }
  if(message.type==='sbcBuyReset'){
    const current=await rawSbcBuy();
    if(current.enabled||sbcBuying)throw Error('Stop buying and wait for the current EA request first.');
    const next={enabled:false,reviewedPurchase:current.pending||current.reviewedPurchase||null,status:'Buying session cleared. Cards already bought remain in EA.'};
    const session=await state();await save({...session,checkout:null});
    await saveSbcBuy(next);await chrome.alarms.clear(SBC_BUY_ALARM);return next;
  }
  const buySession=await rawSbcBuy();
  if(buySession.enabled||sbcBuying)throw Error('Stop SBC buying before changing the squad or starting another action.');
  if((buySession.review||buySession.pending)&&['swapOptions','swapApply','sbcPrepare','sbcBuyStart','compare','build','clubBuild','hybridBuild','complete','reset'].includes(message.type))throw Error('A previous purchase needs review. Check EA New Items and your club, then use Clear buying session on the SBC screen.');
  if(message.type==='swapOptions'){
    if((await tradeState()).enabled||tradingBusy)throw Error('Stop the trader before checking SBC swaps.');
    const session=await state();
    if(!Number.isInteger(message.index)||message.index<0||message.index>=session.resolved?.length)throw Error('Choose a player in the current SBC.');
    return swapCandidates(session,message.index);
  }
  if(message.type==='swapApply'){
    const session=await state(),swap=session.swapOptions;
    if(!session.approved||!swap||!Number.isInteger(message.option)||!swap.options?.[message.option]||Date.now()-swap.checkedAt>120000)throw Error('Refresh the cheaper swap options before choosing one.');
    if(swap.fingerprint!==session.challenge.fingerprint||session.resolved?.[swap.index]?.baseId!==swap.baseId)throw Error('The SBC changed. Refresh the swap options.');
    const choice=swap.options[message.option];
    const players=session.plan.players.map((player,index)=>index===swap.index?{...choice.player,owned:undefined}:player);
    const plan={...session.plan,players,total:players.reduce((sum,player)=>sum+player.price,0),customized:true};
    validateSavedPlan(plan);
    const result=await ea(session.tabId,'sbcSwapApply',{challengeId:session.plan.challengeId,fingerprint:session.challenge.fingerprint,slotIndex:slotFor(session,swap.index),player:choice.player},SBC_REQUEST_TIMEOUT);
    const resolved=session.resolved.map((player,index)=>index===swap.index?{...result.player,price:choice.player.price}:player);
    const next={...session,plan,resolved,challenge:result.challenge,swapOptions:null,checkout:null,approved:true,inserted:true,progress:null};
    await save(next);return next;
  }
  if(message.type==='sbcPrepare'){
    if((await tradeState()).enabled||tradingBusy)throw Error('Stop the trader before checking SBC prices.');
    const session=await state();
    if(!session.approved||!session.resolved)throw Error('Build and review the SBC squad first.');
    validateSavedPlan(session.plan);
    await save({...session,checkout:null,progress:'Checking which SBC cards you own…'});
    const ownership=await ea(session.tabId,'sbcOwnership',{challengeId:session.plan.challengeId,fingerprint:session.challenge.fingerprint,players:session.resolved},SBC_REQUEST_TIMEOUT);
    if(!Number.isSafeInteger(ownership.balance)||ownership.balance<0||!Array.isArray(ownership.owned)||ownership.owned.some(id=>!session.resolved.some(player=>player.definitionId===id)))throw Error('EA did not confirm the owned SBC cards.');
    const owned=new Set(ownership.owned);
    const resolved=session.resolved.map(player=>({...player,owned:owned.has(player.definitionId)}));
    await save({...await state(),resolved});
    const missing=resolved.map((player,index)=>({player,index})).filter(({player})=>!player.owned);
    const quotes=[];let total=0,balance=ownership.balance;
    for(const [number,{index,player}] of missing.entries()){
      await save({...await state(),progress:`Checking missing card ${number+1}/${missing.length}: ${player.name}…`});
      if(number)await new Promise(resolve=>setTimeout(resolve,1000));
      let quote;
      try{quote=await ea(session.tabId,'sbcQuote',{challengeId:session.plan.challengeId,player},SBC_REQUEST_TIMEOUT);}
      catch(error){error.message=`Could not price ${player.name} (${number+1}/${missing.length}): ${error.message}`;throw error;}
      balance=quote.balance;
      if(quote.phase==='unavailable')throw Error(`No available ${player.name} listing was found within your coin balance. Use its swap button or try again later.`);
      if(quote.phase==='quoted'){quotes.push({index,definitionId:player.definitionId,price:quote.price,tradeId:quote.tradeId});total+=quote.price;}
    }
    if(total>balance)throw Error(`Live prices total ${total.toLocaleString()} coins, above your ${balance.toLocaleString()} coin balance. Swap an expensive player first.`);
    const checkout={preparedAt:Date.now(),fingerprint:session.challenge.fingerprint,planURL:session.plan.url,quotes,total,balance};
    const next={...await state(),checkout,swapOptions:null,progress:null};await save(next);return next;
  }
  if(message.type==='sbcBuyStart'){
    if(tradingBusy||(await tradeState()).enabled)throw Error('Stop the trader before buying SBC cards.');
    const previous=await rawSbcBuy();
    if(previous.pending||previous.review)throw Error('Review the previous EA purchase and clear the buying session before restarting.');
    const session=await state(),checkout=session.checkout;
    if(!session.approved||!checkout||checkout.planURL!==session.plan?.url||checkout.fingerprint!==session.challenge?.fingerprint||Date.now()-checkout.preparedAt>120000)throw Error('Check live prices again before buying.');
    if(!Array.isArray(checkout.quotes)||!Number.isSafeInteger(checkout.total)||checkout.total<0||checkout.total>checkout.balance||checkout.quotes.reduce((sum,quote)=>sum+quote.price,0)!==checkout.total||new Set(checkout.quotes.map(quote=>quote.index)).size!==checkout.quotes.length||checkout.quotes.some(quote=>!Number.isSafeInteger(quote.price)||quote.price<150))throw Error('The checked coin total is invalid.');
    const current=await ea(session.tabId,'status',null,SBC_REQUEST_TIMEOUT);
    if(current.challenge.fingerprint!==checkout.fingerprint)throw Error('The SBC changed. Check prices again.');
    const run={enabled:true,done:false,review:false,tabId:session.tabId,planURL:session.plan.url,fingerprint:checkout.fingerprint,quotes:checkout.quotes,maxTotal:checkout.total,spent:0,index:0,pending:null,nextAt:Date.now()+1000,status:checkout.quotes.length?`Buying ${checkout.quotes.length} missing card(s), up to ${checkout.total.toLocaleString()} coins.`:'All cards are owned. Filling the SBC squad.'};
    await saveSbcBuy(run);armSbcBuy(run.nextAt);return run;
  }
  if(message.type==='swapDismiss'){
    const session=await state();const next={...session,swapOptions:null};await save(next);return next;
  }
  if(message.type==='clubBuild'||message.type==='hybridBuild'){
    const hybrid=message.type==='hybridBuild';
    if(tradingBusy||(await rawTradeState()).enabled)throw Error('Stop trading before building an SBC from your club.');
    await dispatch({type:'connect'});
    const current=await state();
    await save({...current,progress:hybrid?'Checking club cards and low-price EA listings…':'Building from your club · checking EA requirements…'});
    const run={id:crypto.randomUUID(),tabId:current.tabId};activeSbcBuild=run;
    await save({...await state(),sbcBuildRunning:true});
    let polling=false;
    const progressTimer=setInterval(async()=>{
      if(polling||activeSbcBuild!==run)return;polling=true;
      try{
        const result=await chrome.scripting.executeScript({target:{tabId:run.tabId},world:'MAIN',func:function sbcBuildProgress(id){return window.__futsbcSbcBuildProgress?.id===id?window.__futsbcSbcBuildProgress.status:null;},args:[run.id]});
        if(activeSbcBuild===run&&typeof result[0]?.result==='string'){const latest=await state();if(activeSbcBuild===run&&latest.progress!==result[0].result)await save({...latest,progress:result[0].result});}
      }catch{}finally{polling=false;}
    },1000);
    try{
      const result=await ea(current.tabId,hybrid?'sbcHybridBuild':'sbcClubBuild',{challengeId:current.challenge.id,fingerprint:current.challenge.fingerprint,sbcBuildToken:run.id});
      const plan={source:hybrid?'hybrid':'club',year:27,market:'console',challengeId:result.challenge.id,name:result.challenge.name,players:result.players,total:result.players.reduce((sum,p)=>sum+p.price,0),checkedAt:Date.now(),checks:result.checks,budget:result.budget};
      validateSavedPlan(plan);
      const next={...current,challenge:result.challenge,plan,resolved:result.players,mapping:result.players.map(player=>player.slotIndex),alternatives:[],listedSolutions:[],swapOptions:null,checkout:null,inserted:true,approved:true,progress:null};
      await save(next);return next;
    }catch(clubError){await save({...await state(),progress:null});throw clubError;}
    finally{activeSbcBuild=null;clearInterval(progressTimer);await save({...await state(),sbcBuildRunning:false});}
  }
  if(message.type==='build') {
    await dispatch({type:'connect'});
    try{await dispatch({type:'compare',url:message.url,mode:message.mode});}
    catch(error){
      if(!error.sbcUnavailable||String(message.url||'').trim())throw error;
      return dispatch({type:'clubBuild'});
    }
    return dispatch({type:'complete'});
  }
  if(message.type==='complete') {
    const current=await state();
    if(!current.resolved) await dispatch({type:'resolve'});
    const ready=await state();
    if(!ready.inserted) {
      const mapping=Array.isArray(message.mapping)?message.mapping:suggestMapping(ready.resolved,ready.challenge.slots);
      await dispatch({type:'insert',mapping});
    }
    return dispatch({type:'approve'});
  }
  if(message.type==='connect') {
    const tabs=await findEaTabs(chrome.tabs);
    let lastError='Open the FC 27 Web App and an SBC squad first.';
    for(const tab of tabs.sort((a,b)=>Number(b.active)-Number(a.active))) {
      try {const result=await ea(tab.id,'status');const s=await state();const unchanged=s.tabId===tab.id&&s.challenge?.id===result.challenge.id&&s.challenge?.fingerprint===result.challenge.fingerprint;const next=unchanged?{...s,challenge:result.challenge}:{...s,tabId:tab.id,challenge:result.challenge,plan:null,resolved:null,alternatives:[],listedSolutions:[],incompleteSolutions:[],swapOptions:null,checkout:null,inserted:false,approved:false};await save(next);return next;}catch(e){lastError=e.message;}
    }
    throw Error(lastError);
  }
  if(message.type==='compare') {
    let previous=await state();
    if(previous.tabId){
      const challenge=(await ea(previous.tabId,'status')).challenge;
      const changed=previous.challenge?.id!==challenge.id||previous.challenge?.fingerprint!==challenge.fingerprint;
      previous=changed?{...previous,challenge,plan:null,resolved:null,alternatives:[],listedSolutions:[],incompleteSolutions:[],swapOptions:null,checkout:null,approved:false,inserted:false}:{...previous,challenge};
    }
    const manualURL=String(message.url||'').trim();
    const initialURL=manualURL?futbinURL(manualURL):challengeLookupURL(previous.challenge);
    await save({...previous,plan:null,resolved:null,alternatives:[],listedSolutions:[],incompleteSolutions:[],swapOptions:null,checkout:null,approved:false,inserted:false,progress:manualURL?'Reading FUTBIN console solutions…':`Finding ${previous.challenge.name} on FUTBIN…`});
    const workerTabs=[];
    try {
      const tab=await chrome.tabs.create({url:initialURL,active:false});
      workerTabs.push(tab.id);
      let comparisonURL=manualURL;
      if(!manualURL) {
        try{
          let lookup=await readTab(tab.id,initialURL,previous.challenge.id);
          if(!lookup.url && lookup.groupURL) {
            await chrome.tabs.update(tab.id,{url:lookup.groupURL});
            lookup=await readTab(tab.id,lookup.groupURL,previous.challenge.id);
          }
          if(!lookup.url)throw Error('The FUTBIN lookup did not return this challenge.');
          comparisonURL=lookup.url;
        }catch(error){
          if(error.verificationBlocked)throw error;
          comparisonURL=await discoverSbc(chrome,tab.id,previous.challenge,{progress:async progress=>save({...await state(),progress})});
        }
      }
      const url=new URL(futbinURL(comparisonURL));url.searchParams.set('sort','ps_price');url.searchParams.set('order','asc');
      await chrome.tabs.update(tab.id,{url:url.href});
      const comparison=await readTab(tab.id,url.href);
      if(comparison.kind!=='comparison') throw Error('Paste the Completed Challenges page, not an individual squad.');
      if(previous.challenge&&previous.challenge.id!==comparison.challengeId) throw Error('This FUTBIN challenge does not match the open EA SBC.');
      if(comparison.unpricedCount)throw Error(`${comparison.unpricedCount} listed FUTBIN squad(s) have no console price. No squad was added because the cheapest cannot be verified.`);
      const ranked=rankSolutions(comparison.solutions);
      if(!ranked.length) throw Error('No console-priced completed squads found.');
      const selected=comparisonCandidates(ranked,'full');
      const resumed=resumeComparison(previous.comparisonCheckpoint,comparison.challengeId,selected,previous.challenge?.slots);
      const candidates=[...resumed.plans],fallback=[],incompleteSolutions=[];
      const pending=selected.filter(solution=>!resumed.urls.has(solution.url));
      const checkpoint={challengeId:comparison.challengeId,entries:[...resumed.entries]};
      const remember=(plan,solution)=>{checkpoint.entries=checkpoint.entries.filter(entry=>entry.url!==solution.url);checkpoint.entries.push({url:solution.url,consolePrice:solution.consolePrice,plan});};
      const persistProgress=async progress=>save({...await state(),comparisonCheckpoint:checkpoint,progress});
      let nextIndex=0,checked=candidates.length,incomplete=0,blockingError=null;
      let directFetchAvailable=true;
      const verifyPlan=(plan,solution)=>{
        validatePlan(plan);
        if(new URL(plan.url).pathname!==new URL(solution.url).pathname||plan.challengeId!==comparison.challengeId)throw Error('FUTBIN squad identity does not match its listing.');
        const slots=previous.challenge?.slots;
        if(slots?.length&&(plan.players.length!==slots.length||new Set(plan.players.map(player=>player.futbinSlot)).size!==slots.length))return false;
        candidates.push(plan);
        remember(plan,solution);
        return true;
      };
      for(let offset=0;offset<pending.length;offset+=5){
        const batch=pending.slice(offset,offset+5);
        if(!directFetchAvailable){fallback.push(...batch);continue;}
        let results;
        try{
          const response=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:readFutbinSquadBatch,args:[batch.map(solution=>solution.url),comparison.challengeId]}))[0]?.result;
          if(response?.kind==='batch'&&response.results?.length===batch.length)results=response.results;
        }catch{}
        if(!results){directFetchAvailable=false;fallback.push(...batch);continue;}
        if(results.every(result=>result?.fallback)||results.some(result=>result?.verification))directFetchAvailable=false;
        for(const [index,result] of results.entries()){
          const solution=batch[index];
          if(result?.kind==='squad'){
            try{if(!verifyPlan(result,solution)){incomplete++;incompleteSolutions.push(solution.url);}}catch(error){blockingError=error;}
            checked++;
          }else if(result?.incompleteSquad){incomplete++;incompleteSolutions.push(solution.url);checked++;}
          else if(result?.fallback)fallback.push(solution);
          else blockingError=Error(result?.error||'FUTBIN returned an unreadable squad.');
          if(blockingError)break;
        }
        await persistProgress(`Checked ${checked}/${selected.length} listed squads · ${candidates.length} complete${fallback.length?` · ${fallback.length} page checks queued`:''}`);
        if(blockingError)break;
      }
      if(blockingError)throw Error(`FUTBIN could not verify every listed squad: ${blockingError.message} No squad was added.`);
      const readWorker=async tabId=>{
        while(nextIndex<fallback.length&&!blockingError){
          const solution=fallback[nextIndex++];
          try {
            futbinURL(solution.url,'solution');
            await chrome.tabs.update(tabId,{url:solution.url});
            const plan=await readTab(tabId,solution.url);
            if(!verifyPlan(plan,solution)){incomplete++;incompleteSolutions.push(solution.url);}
          }catch(error){
            if(error.incompleteSquad){incomplete++;incompleteSolutions.push(solution.url);}
            else blockingError=error;
          }finally{
            checked++;
            await persistProgress(`Checked ${checked}/${selected.length} listed squads · ${candidates.length} complete${incomplete?` · ${incomplete} incomplete`:''}`);
          }
        }
      };
      if(fallback.length){
        const workerCount=1;
        for(let index=1;index<workerCount;index++)workerTabs.push((await chrome.tabs.create({url:fallback[index].url,active:false})).id);
        await Promise.all(workerTabs.map(readWorker));
      }
      if(blockingError)throw Error(`FUTBIN could not verify every listed squad: ${blockingError.message} No squad was added.`);
      if(!candidates.length)throw Error(`All ${selected.length} listed squads were incomplete. No squad was added.`);
      candidates.sort((a,b)=>a.total-b.total);
      const best=candidates[0];
      validatePlan(best);
      const next={...await state(),comparisonCheckpoint:null,plan:{...best,comparisonURL:url.href,mode:'full',attemptedCount:selected.length,listedCount:selected.length,recheckedCount:candidates.length,incompleteCount:incomplete,failedCount:0},alternatives:candidates,listedSolutions:ranked,incompleteSolutions,swapOptions:null,checkout:null,resolved:null,approved:false,inserted:false,progress:null};
      await save(next);return next;
    }catch(error){
      const interrupted=await state();
      await save({...previous,comparisonCheckpoint:interrupted.comparisonCheckpoint,progress:null});
      throw error;
    }finally{
      await Promise.allSettled(workerTabs.map(tabId=>chrome.tabs.remove(tabId)));
    }
  }
  const s=await state();
  if(message.type==='resolve') {
    validatePlan(s.plan);
    if(!s.tabId) throw Error('Connect to the open SBC first.');
    const alternatives=[s.plan,...(s.alternatives||[]).filter(plan=>plan.url!==s.plan.url)].sort((a,b)=>a.total-b.total);
    const cardKey=player=>JSON.stringify([player.baseId,player.rating,player.rarity,player.clubId,player.leagueId,player.nationId,player.attributes]);
    const unavailable=new Set();
    let skipped=0,firstFailure=null;
    for(const [index,plan] of alternatives.entries()){
      if(plan.players.some(player=>unavailable.has(cardKey(player)))){skipped++;continue;}
      await save({...await state(),progress:`Matching EA cards ${index+1}/${alternatives.length}…`});
      try{
        const r=await ea(s.tabId,'resolve',{challengeId:plan.challengeId,players:plan.players});
        const selected={...plan,comparisonURL:s.plan.comparisonURL,mode:s.plan.mode,attemptedCount:s.plan.attemptedCount,listedCount:s.plan.listedCount,recheckedCount:s.plan.recheckedCount,incompleteCount:s.plan.incompleteCount,eaSkippedCount:skipped};
        const next={...await state(),plan:selected,resolved:r.players,challenge:r.challenge,swapOptions:null,checkout:null,approved:false,inserted:false,progress:null};await save(next);return next;
      }catch(error){
        if(!error.unmatchedPlayer)throw error;
        unavailable.add(cardKey(error.unmatchedPlayer));
        firstFailure??=error;
        skipped++;
      }
    }
    throw Error(`None of the ${alternatives.length} checked FUTBIN squads could be matched to exact EA cards. ${firstFailure?.message||'No squad changes were made.'}`);
  }
  if(message.type==='insert') {
    validatePlan(s.plan);
    if(!s.resolved) throw Error('Match the concept cards first.');
    validateMapping(s.resolved,s.challenge.slots,message.mapping);
    await save({...s,progress:'Checking your club and filling the SBC…'});
    const r=await ea(s.tabId,'concepts',{challengeId:s.plan.challengeId,players:s.resolved,mapping:message.mapping,fingerprint:s.challenge.fingerprint});
    const next={...s,challenge:r.challenge,resolved:r.players,mapping:message.mapping,swapOptions:null,checkout:null,inserted:true,approved:false,progress:null};await save(next);return next;
  }
  if(message.type==='approve') {
    validatePlan(s.plan);
    if(!s.inserted||!s.resolved) throw Error('Add and review the concept squad first.');
    const current=await ea(s.tabId,'status');
    if(current.challenge.id!==s.plan.challengeId || current.challenge.fingerprint!==s.challenge.fingerprint) throw Error('The squad changed. Reconnect and review it again.');
    const next={...s,approved:true};await save(next);return next;
  }
  if(message.type==='market') {
    if(!s.approved || !Number.isInteger(message.index) || !s.resolved?.[message.index]) throw Error('Add the squad before shopping.');
    if(s.resolved[message.index].owned) throw Error('This card is already in your club.');
    await ea(s.tabId,'market',{player:s.resolved[message.index]});
    await chrome.tabs.update(s.tabId,{active:true});return s;
  }
  if(message.type==='reset'){if((await rawSbcBuy()).enabled)throw Error('Stop SBC buying before clearing this session.');await save({});return {};}
  throw Error('Unknown action.');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  // Websites/content scripts cannot trigger mutations. Only our extension pages can.
  const fromPanel=sender.url===chrome.runtime.getURL('panel.html');
  const fromTrade=sender.url===chrome.runtime.getURL('trade.html');
  if(sender.id!==chrome.runtime.id || !(fromPanel||fromTrade)) return false;
  const tradeMessage=['tradeState','tradeStart','tradeStop','tradeReset','tradeDiagnose','tradeCheckFutbin','tradeReview','tradeRecover'].includes(message.type);
  if(fromTrade&&!tradeMessage) return false;
  if(tradeMessage){
    dispatch(message).then(data=>respond({ok:true,data})).catch(error=>respond({ok:false,error:error.message}));
    return true;
  }
  const readOnly=['teamRunState','teamCancel','sbcBuildStop','state','tradeState','sbcBuyState','sbcBuyStop','marketInsightsState','cardArt'].includes(message.type);
  if(busy&&!readOnly) {respond({ok:false,error:'Please wait for the current operation.'});return false;}
  const locks=!readOnly;if(locks)busy=true;
  (async()=>{
    let response;
    try{response={ok:true,data:await dispatch(message)};}
    catch(error){
      if(locks)try{const s=await state();await save({...s,progress:null});}catch{}
      response={ok:false,error:error.message};
    }finally{if(locks)busy=false;}
    respond(response);
  })();
  return true;
});
