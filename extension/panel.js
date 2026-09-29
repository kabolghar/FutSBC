import {suggestMapping} from './core.js';
const embedded=window.parent!==window;
let reportSize=()=>{};
if(embedded){
  document.documentElement.classList.add('embedded');
  reportSize=()=>window.parent.postMessage({type:'futsbc-panel-size',height:Math.ceil(document.body.scrollHeight),view:activeView==='trader'?'trader':activeView==='insights'?'market':activeView==='team'?'team':state.plan?'lineup':'menu',hasResult:activeView==='sbc'&&!!state.plan},'*');
  new ResizeObserver(reportSize).observe(document.body);
  window.addEventListener('load',reportSize);
}
const $=id=>document.getElementById(id);
const preview=!globalThis.chrome?.runtime?.id;
let state={},busy=false,mapping=[],activeView='sbc',trader={enabled:false},traderPending=false,buy={enabled:false},buyPending=false;
let insights={},insightsPending=false,insightsUiError='';
let teamSwapView=null;
let teamPicks=new Map(),teamPickerSlot=null,teamPickerEpoch=0;
let team={},teamResult=null,teamSelected=new Set(),teamPending=false,teamUiError='',teamRunActive=false,teamProgressText='';
let swapCache=new Map(),swapQueue=[],swapActive=null,swapEpoch=0;
let recovering=false;
const recoveryKey='futsbc-last-context-reload';
const fmt=n=>new Intl.NumberFormat('en-US').format(n);
const artCache=new Map(),artRequests=new Map();
const artObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
  for(const entry of entries){
    if(!entry.isIntersecting)continue;
    artObserver.unobserve(entry.target);
    void loadCardArt(entry.target);
  }
},{rootMargin:'300px'}):null;
function queueCardArt(element,assetId,definitionId){
  if(preview||!Number.isSafeInteger(assetId)||assetId<1||!Number.isSafeInteger(definitionId)||definitionId<1||definitionId%0x1000000!==assetId)return;
  element.dataset.assetId=assetId;element.dataset.definitionId=definitionId;
  const cached=artCache.get(`${assetId}:${definitionId}`);
  if(cached){applyCardArt(element,cached);return;}
  if(artObserver)artObserver.observe(element);else void loadCardArt(element);
}
function applyCardArt(element,art){
  element.style.backgroundImage=`url("${art.imageURL}")`;
  element.classList.add('has-art');
  if(element.tagName==='A')element.href=art.pageURL;
}
async function loadCardArt(element){
  const assetId=Number(element.dataset.assetId),definitionId=Number(element.dataset.definitionId),key=`${assetId}:${definitionId}`;
  if(!artRequests.has(key))artRequests.set(key,call('cardArt',{assetId,definitionId}).then(art=>{artCache.set(key,art);return art;}).catch(()=>null).finally(()=>artRequests.delete(key)));
  const art=await artRequests.get(key);
  if(art)applyCardArt(element,art);
}
function cardArtElement(className,rating,position,assetId,definitionId,name,link=false){
  definitionId=Number(definitionId);assetId=Number(assetId);
  if(Number.isSafeInteger(definitionId)&&definitionId>0&&(!assetId||assetId===definitionId))assetId=definitionId%0x1000000;
  const art=document.createElement(link?'a':'span');art.className=className;
  if(link){art.href=`https://www.fut.gg/players/${assetId}/27-${definitionId}/`;art.target='_blank';art.rel='noreferrer';art.setAttribute('aria-label',`View ${name} card on FUT.GG`);}else art.setAttribute('aria-hidden','true');
  const score=document.createElement('strong');score.textContent=rating||'—';
  const role=document.createElement('small');role.textContent=position||'';
  art.append(score,role);queueCardArt(art,assetId,definitionId);
  return art;
}
function notice(message,error=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function recoverContext(error) {
  if(!/Extension context invalidated/i.test(String(error?.message||error)))return false;
  let lastAttempt=0;
  try{lastAttempt=Number(sessionStorage.getItem(recoveryKey)||0);}catch{}
  if(Date.now()-lastAttempt<10000){
    recovering=true;
    notice('FutSBC could not reconnect. Click its toolbar icon to reopen the panel.',true);
    return true;
  }
  recovering=true;
  notice('Reconnecting FutSBC…');
  try{sessionStorage.setItem(recoveryKey,String(Date.now()));}catch{}
  window.location.reload();
  return true;
}
async function call(type,extra={},prefetch=false) {
  const readOnly=['teamRunState','teamCancel','state','tradeState','sbcBuyState','sbcBuyStop','marketInsightsState','cardArt'];
  if(!prefetch&&swapActive&&!readOnly.includes(type))await stopTeamPrefetch();
  if(preview) throw Error('Install the extension and open FutSBC in the EA Web App. This is a visual preview.');
  try{
    const response=await chrome.runtime.sendMessage({type,...extra});
    if(!response?.ok) throw Error(response?.error||'Extension unavailable. Reload the panel.');
    try{sessionStorage.removeItem(recoveryKey);}catch{}
    return response.data;
  }catch(error){
    if(recoverContext(error))throw Error('FutSBC is reconnecting.');
    throw error;
  }
}
async function run(type,extra={}) {
  if(busy)return;busy=true;render();notice({connect:'Reading the open SBC…',build:'Checking FUTBIN squads…',complete:'Checking your club…',market:'Opening EA market…',swapOptions:'Finding cheaper, valid swaps…',swapApply:'Checking and saving the swap…',sbcPrepare:'Checking live EA prices…'}[type]||'Updating…');
  try {state=await call(type,extra);mapping=[];if(type==='connect')$('source').value='';notice({market:'EA market search opened.'}[type]||'');}catch(e){if(!recovering){try{state=await call('state');}catch{}if(!recovering)notice(e.message,true);}}
  finally{busy=false;render();}
}
function render() {
  document.documentElement.classList.toggle('has-result',activeView==='sbc'&&!!state.plan);
  $('challenge').textContent=state.challenge?.name||'Choose a challenge';
  $('sbc-visual').hidden=!!state.plan;
  $('formation').textContent=state.challenge?`${state.challenge.formation||'SBC'} · #${state.challenge.id}`:'Open an SBC in EA.';
  for(const id of ['connect','compare','source','reset'])$(id).disabled=busy;
  $('compare').firstElementChild.textContent=state.plan?'Find another squad':'Build this SBC';
  $('result').hidden=!state.plan;
  if(!state.plan){$('swap-panel').hidden=true;$('buy-section').hidden=true;reportSize();return;}
  const p=state.plan;
  $('plan-name').textContent=p.name===state.challenge?.name?'Lineup':p.name;
  $('price-label').textContent=p.eaSkippedCount?'LOWEST EA-MATCHED':'LOWEST VERIFIED';
  $('total').textContent=fmt(p.total);
  $('coverage').textContent=`${p.attemptedCount||p.recheckedCount}/${p.listedCount} checked · ${p.recheckedCount} complete${p.incompleteCount?` · ${p.incompleteCount} incomplete`:''}${p.eaSkippedCount?` · ${p.eaSkippedCount} unavailable in EA`:''}`;
  $('freshness').textContent=`Checked ${new Date(p.checkedAt).toLocaleTimeString()}`;
  $('players').replaceChildren();
  const players=state.resolved||p.players;
  const ownedCount=players.filter(player=>player.owned).length;
  $('lineup-count').textContent=state.inserted?`${ownedCount} IN CLUB · ${players.length-ownedCount} TO BUY`:`${players.length} PLAYERS`;
  $('lineup-action').textContent=state.approved?'PRICE / MARKET':'EST. PRICE';
  const slots=state.challenge?.slots||[];
  if(mapping.length!==players.length){try{mapping=suggestMapping(players,slots);}catch{mapping=[];}}
  $('build-status').textContent=state.approved?'✓ Squad ready · buy missing players in EA':state.inserted?'Squad added · checking requirements':state.resolved?'Cards matched · review slots':'Cards found · ready to match';
  $('shopping-note').hidden=!state.approved||ownedCount===players.length;
  players.forEach((player,index)=>{
    const row=document.createElement('div');row.className='player';const main=document.createElement('div');main.className='player-main';const assetId=Number(player.baseId)||Number(player.definitionId)%0x1000000;const art=cardArtElement('player-art',player.rating,player.position,assetId,Number(player.definitionId),player.name);const title=document.createElement('div');title.className='player-name';title.textContent=player.name;const detail=document.createElement('small');detail.textContent=player.position;title.append(detail);const price=document.createElement('span');price.className='player-price';price.textContent=player.owned?'IN CLUB':fmt(player.price);main.append(art,title,price);row.append(main);
    if(state.resolved&&!state.inserted){const select=document.createElement('select');select.setAttribute('aria-label',`SBC slot for ${player.name}`);slots.forEach(slot=>{const option=document.createElement('option');option.value=slot.index;option.textContent=`Slot ${slot.index+1} · ${slot.position}`;select.append(option);});select.value=mapping[index];select.disabled=busy;select.onchange=()=>{mapping[index]=Number(select.value);};row.append(select);}
    if(state.approved&&!player.owned){const actions=document.createElement('div');actions.className='player-actions';const swap=document.createElement('button');swap.type='button';swap.textContent='⇄';swap.title='Find a cheaper swap';swap.setAttribute('aria-label',`Find cheaper chemistry-safe swaps for ${player.name}`);swap.disabled=busy||buy.enabled;swap.onclick=()=>run('swapOptions',{index});const market=document.createElement('button');market.type='button';market.textContent='↗';market.title='Search EA market';market.setAttribute('aria-label',`Find ${player.name} in EA market`);market.disabled=busy||buy.enabled;market.onclick=()=>run('market',{index});actions.append(swap,market);row.append(actions);}
    $('players').append(row);
  });
  $('complete').hidden=!!state.approved;
  $('complete').disabled=busy;
  $('complete').textContent=state.inserted?'Check squad':state.resolved?'Add to SBC':'Match + add';
  const swap=state.swapOptions,open=!!swap&&state.approved;
  $('swap-panel').hidden=!open;
  if(open){
    $('swap-title').textContent=players[swap.index]?.name||'Player';
    $('swap-summary').textContent=swap.options.length?`Live EA price ${fmt(swap.currentPrice)} · each option is cheaper and passes this SBC's requirements.`:'No cheaper chemistry-safe swap was found in the checked FUTBIN squads.';
    $('swap-list').replaceChildren();
    swap.options.forEach((option,optionIndex)=>{const button=document.createElement('button');button.type='button';button.className='swap-option';button.disabled=busy||buy.enabled;const art=cardArtElement('player-art',option.player.rating,option.player.position,Number(option.player.baseId)||Number(option.player.definitionId)%0x1000000,Number(option.player.definitionId),option.player.name);const label=document.createElement('span');const name=document.createElement('strong');name.textContent=option.player.name;const detail=document.createElement('small');detail.textContent=option.price?`EA ${fmt(option.price)} · saves ${fmt(swap.currentPrice-option.price)}`:`In your club · saves ${fmt(swap.currentPrice)}`;label.append(name,detail);const price=document.createElement('span');price.className='swap-price';price.textContent=option.price?fmt(option.price):'IN CLUB';button.append(art,label,price);button.onclick=()=>run('swapApply',{option:optionIndex});$('swap-list').append(button);});
  }
  renderSbcBuy();
  reportSize();
}
function renderSbcBuy(){
  $('buy-section').hidden=!state.approved;
  if(!state.approved)return;
  const checkout=state.checkout,ready=checkout&&Date.now()-checkout.preparedAt<120000&&checkout.fingerprint===state.challenge?.fingerprint;
  $('price-check').disabled=busy||buyPending||buy.enabled||!!buy.pending;
  $('checkout-summary').hidden=!ready;
  if(ready)$('checkout-summary').textContent=`${checkout.quotes.length} to buy · up to ${fmt(checkout.total)} coins · balance ${fmt(checkout.balance)}`;
  $('buy-start').hidden=!ready||buy.enabled||!!buy.pending||buy.done;
  $('buy-start').disabled=busy||buyPending;
  $('buy-start').firstElementChild.textContent=checkout?.quotes.length?`Buy ${checkout.quotes.length} · max ${fmt(checkout.total)}`:'Fill squad from club';
  $('buy-status').textContent=buy.status||'Check live prices, then approve one coin ceiling for the squad.';
  $('buy-stop').hidden=!buy.enabled;
  $('buy-stop').disabled=buyPending;
  $('buy-reset').hidden=buy.enabled||!buy.status;
  $('buy-reset').disabled=buyPending||busy;
}
function renderTrader(){
  const active=!!trader.enabled;
  const pauseRemaining=Math.max(0,Math.ceil(((trader.cooldownUntil||0)-Date.now())/1000));
  $('trader-state').textContent=pauseRemaining?'PAUSED':active?trader.watchOnly?'MONITORING':'RUNNING':trader.inFlight?'STOPPING':trader.recoveryRequired?'REVIEW':'OFF';
  $('trader-state').classList.toggle('on',active);
  $('trader-view').dataset.running=String(active&&!pauseRemaining&&!trader.recoveryRequired);
  $('trader-orbit').setAttribute('aria-label',active?'Trader active':'Trader idle');
  const pendingReview=trader.recoveryRequired&&trader.pendingBid&&['unavailable','unconfirmed'].includes(trader.pendingBid.lastReview?.phase);
  $('trader-status').textContent=trader.cooldownUntil&&!pauseRemaining&&!active?'The rate-limit pause ended. Test one normal market search in EA before restarting.':trader.status||(pendingReview?`EA has not confirmed ${trader.pendingBid.name} (${trader.pendingBid.tradeId}). Continue monitoring this saved auction only; new searches stay off.`:'Connect to your signed-in console club to start.');
  $('trader-coins').textContent=Number.isSafeInteger(trader.lastBalance)?fmt(trader.lastBalance):'—';
  $('trader-spent').textContent=fmt(trader.spent||0);
  $('trader-count').textContent=fmt(trader.completedTrades||0);
  const remaining=active&&trader.nextAt?Math.max(0,Math.ceil((trader.nextAt-Date.now())/1000)):0;
  const watching=trader.activeBids?.length||Number(!!trader.activeBid);
  $('trader-next').textContent=pauseRemaining?`${watching?`${watching} bids · `:''}Break ${Math.floor(pauseRemaining/60)}:${String(pauseRemaining%60).padStart(2,'0')}`:remaining?`${watching?`${watching} bids · next check`:'Next scan'} ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:active?'Checking EA…':'Scans every 20s';
  const evidence=trader.marketEvidence;
  const evidenceAge=evidence?.checkedAt?Math.max(0,Math.floor((Date.now()-evidence.checkedAt)/60_000)):null;
  $('trader-source').textContent=evidenceAge===null?'FUTBIN has not been checked.':`FUTBIN ${evidenceAge<10?'checked':'last checked'} ${evidenceAge}m ago${evidenceAge>=10?' · stale':''} · ${evidence.rows} rows · ${evidence.shortlisted} shortlisted`;
  const selected=evidence?.selected,proof=$('trader-proof');
  proof.hidden=!selected;
  if(selected){
    proof.href=/^https:\/\/www\.futbin\.com\/27\/player\/\d+\//.test(selected.url||'')?selected.url:'https://www.futbin.com/27/market-player-list';
    proof.textContent=Number.isSafeInteger(selected.estimatedProfit)?`${selected.name} ↗  FUTBIN ${fmt(selected.futbinPrice)} · EA ${fmt(selected.eaReference)} · planned ${fmt(selected.sell)} · estimated +${fmt(selected.estimatedProfit)}`:`${selected.name} ↗  FUTBIN ${fmt(selected.futbinPrice)} · trend ${selected.trend}% · updated ${Math.floor(selected.updatedSeconds/60)}m ago`;
  }
  $('trader-toggle').disabled=traderPending||!active&&(!!trader.inFlight||!!trader.recoveryRequired||!!pauseRemaining);
  $('trader-toggle').classList.toggle('stop',active);
  $('trader-toggle').firstElementChild.textContent=active?trader.watchOnly?'Stop monitoring':'Stop auto trader':'Start auto trader';
  $('trader-toggle').lastElementChild.textContent=active?'■':'→';
  $('trader-diagnose').hidden=active;
  $('trader-diagnose').disabled=traderPending||!!trader.inFlight||!!pauseRemaining;
  $('trader-futbin').hidden=active;
  $('trader-futbin').disabled=traderPending||!!trader.inFlight;
  $('trader-recover').hidden=!trader.recoveryRequired;
  $('trader-recover').disabled=traderPending||!!trader.inFlight;
  $('trader-recover').textContent=['not-found','lost'].includes(trader.pendingBid?.lastReview?.phase)&&!trader.activeBids?.length?'I checked EA · unlock start':trader.pendingBid||trader.activeBids?.length?'I checked EA · monitor auction':'I checked EA · unlock start';
  $('trader-review').hidden=!trader.recoveryRequired||!trader.pendingBid?.tradeId;
  $('trader-review').disabled=traderPending||!!trader.inFlight;
  $('trader-reset').disabled=traderPending||!!trader.inFlight;
  const last=trader.lastTrade;
  $('trader-last').hidden=!last;
  if(last){
    $('trader-last-name').textContent=last.name;
    $('trader-last-detail').textContent=`${last.purchased?`Won for ${fmt(last.buy)}`:'Win unverified'} · ${last.listed?`listed ${fmt(last.sell)}`:'not listed'}`;
  }
  reportSize();
}
async function refreshTrader(){
  if(preview)return;
  try{trader=await call('tradeState');$('trader-error').hidden=true;renderTrader();}
  catch(error){if(!recovering){$('trader-error').textContent=error.message;$('trader-error').hidden=false;}}
}
function renderInsights(){
  const brief=insights.brief;
  $('insights-refresh').disabled=insightsPending;
  $('insights-refresh').textContent=insightsPending?'Checking…':'Refresh';
  $('insights-date').textContent=brief?new Date(brief.at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'No brief yet';
  $('insights-summary').textContent=insights.status||'Refresh to check current FUTBIN prices.';
  $('insights-count').textContent=brief?.candidates?.length||0;
  $('insights-error').hidden=!insightsUiError&&!insights.modelError&&!insights.newsError;
  $('insights-error').textContent=[insightsUiError,insights.modelError,insights.newsError].filter(Boolean).join(' · ');
  $('insights-model-state').textContent=!insights.modelConfigured?'No model key saved. Local price signals still work.':insights.modelError?'Key saved · Gemini notes unavailable. See the error above.':brief?.model?.ideas?.length?`${brief.model.model||'Gemini'} notes ready for this brief.`:'Key saved · refresh the market brief to generate notes.';
  const cards=$('insights-cards');cards.replaceChildren();
  if(!brief?.candidates?.length){const empty=document.createElement('p');empty.className='field-note';empty.textContent='No current cards passed the price checks. Refresh when FUTBIN has recent console quotes.';cards.append(empty);}
  for(const card of brief?.candidates?.slice(0,6)||[]){
    const model=brief.model?.ideas?.find(idea=>idea.assetId===card.assetId);
    const sellTarget=card.sellTarget||card.price,projectedNet=Number.isFinite(card.projectedNet)?card.projectedNet:Math.floor(sellTarget*.95)-card.buyCeiling;
    const row=document.createElement('article');row.className='insight-card';
    const main=document.createElement('div');main.className='insight-card-main';
    const art=cardArtElement('player-art','FC','27',card.assetId,card.assetId,card.name,true);
    const head=document.createElement('div');head.className='insight-card-head';
    const link=document.createElement('a');link.href=card.url;link.target='_blank';link.rel='noreferrer';link.textContent=card.name;
    const stance=document.createElement('em');stance.textContent=card.risk==='unrated'?'NOT RATED':`${card.risk?.toUpperCase()||'HIGH'} RISK`;stance.dataset.risk=card.risk||'unrated';stance.title=card.riskReason||card.evidence?.reason||'';head.append(link,stance);
    const meta=document.createElement('p');meta.className='insight-card-meta';meta.textContent=`FUTBIN ${fmt(card.price)} · today ${card.trend>0?'+':''}${card.trend}%${card.dayChange===null?' · first daily sample':` · since last sample ${card.dayChange>0?'+':''}${card.dayChange}%`}`;main.append(art,head,meta);
    const price=document.createElement('strong');price.className='insight-card-price';price.textContent=fmt(card.price);
    const plan=document.createElement('div');plan.className='insight-trade-plan';
    const entry=document.createElement('span');entry.innerHTML=`<small>${card.stance==='consider'&&card.hold?.label!=='Wait for confirmation'?'BUY NOW IF EA ≤':'WAIT FOR EA ≤'}</small>`;entry.append(document.createTextNode(fmt(card.buyCeiling)));
    const exit=document.createElement('span');exit.innerHTML='<small>LIST TARGET</small>';exit.append(document.createTextNode(fmt(sellTarget)));
    const margin=document.createElement('span');margin.innerHTML='<small>AFTER 5% FEE</small>';margin.append(document.createTextNode(`+${fmt(projectedNet)}`));plan.append(entry,exit,margin);
    const deadline=document.createElement('p');deadline.className='insight-card-deadline';deadline.textContent=`HOLD ${card.hold?.label||'Refresh for estimate'} · ${card.hold?.basis||'Recheck current price evidence.'}`;
    const opinion=document.createElement('p');opinion.className='insight-card-opinion';opinion.textContent=card.hold?.approval===null||card.hold?.approval===undefined?'Community rating unavailable':`Community ${card.hold.approval}% positive · ${card.hold.votes} votes${card.hold.games?` · ${fmt(card.hold.games)} games used`:''}`;
    const catalyst=card.hold?.sourceURL?document.createElement('a'):null;
    if(catalyst){catalyst.className='insight-card-catalyst';catalyst.href=card.hold.sourceURL;catalyst.target='_blank';catalyst.rel='noreferrer';catalyst.textContent='Player-linked content ↗';}
    const reason=document.createElement('p');reason.className='insight-card-reason';reason.textContent=card.evidence?`${card.evidence.strategy}: ${card.evidence.reason} ${card.evidence.exitRule}`:model?.reason||'Refresh for current demand and price evidence.';
    const filter=document.createElement('p');filter.className='insight-card-filter';filter.textContent=`SEARCH FILTER  ${card.filter} · checked price only, not a live EA listing`;
    const details=document.createElement('details');details.className='insight-research';const more=document.createElement('summary');more.textContent='Why this card & search filter';const confidence=document.createElement('p');confidence.className='insight-card-meta';confidence.textContent=`Data confidence: ${card.confidence||'not assessed'} · ${card.historyDays??0} prior daily samples`;const rationale=document.createElement('p');rationale.className='insight-card-reason';rationale.textContent=card.riskReason||card.evidence?.reason||'Refresh to assess risk.';details.append(more,rationale,opinion,reason,filter);if(catalyst)details.append(catalyst);deadline.prepend(uiIcon('clock'));stance.prepend(uiIcon('shield'));row.append(main,price,plan,deadline,confidence,details);cards.append(row);
  }
  const news=$('insights-news');news.replaceChildren();
  if(!brief?.headlines?.length){const empty=document.createElement('p');empty.className='field-note';empty.textContent='No recent trading-source headlines were readable. Add no event premium to these prices.';news.append(empty);}
  for(const item of brief?.headlines||[]){const link=document.createElement('a');link.href=item.url;link.target='_blank';link.rel='noreferrer';const tag=document.createElement('span');tag.className=item.kind==='rumour'?'rumour':'';tag.textContent=item.kind==='rumour'?'RUMOUR':item.topic||'NEWS';link.append(tag,document.createTextNode(item.title));news.append(link);}
  reportSize();
}
function teamBudget(){
  const mode=$('team-budget').value;
  return mode==='custom'?Number($('team-custom-budget').value):mode==='half'?Math.floor((team.balance||0)/2/50)*50:team.balance||0;
}
function teamNoFitReason(group){
  const s=group.screening;
  if(!s)return 'No verified meta cards were found for this position in the checked ranking.';
  if(!s.valid){
    const reason=Object.entries(s.rejected||{}).sort((a,b)=>b[1]-a[1])[0]?.[0];
    const labels={id:'card IDs',rating:'card ratings',source:'ranking source',definition:'card versions',price:'price data',rank:'ranking positions',fit:'player ratings'};
    return reason&&s.rejected[reason]?`Could not verify ${labels[reason]} for ${s.rejected[reason]} ranked cards.`:'The ranking did not contain usable FC 27 cards.';
  }
  if(!s.concept)return 'EA returned no concept cards for these ranked players.';
  if(!s.exact)return 'EA card IDs or ratings did not match the ranking.';
  if(!s.position)return 'EA says none of these exact cards can play this squad position.';
  if(!s.withinBudget)return 'No matching unowned card fits the per-position budget.';
  if(!s.chemistryCalculated)return 'EA could not calculate chemistry with these cards.';
  if(!s.chemistryKept)return 'All matched cards reduced squad or slot chemistry.';
  return 'No matched card improved this slot after the final checks.';
}
// Visual layout only: slot selection and EA validation remain in the existing flow.
let teamLayout='pitch';
const uiPaths={refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',plus:'<path d="M12 5v14M5 12h14"/>',swap:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',pitch:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 12h16M9 3v4h6V3M9 21v-4h6v4"/><circle cx="12" cy="12" r="3"/>',list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/>',coin:'<circle cx="12" cy="12" r="9"/><path d="M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9M12 6v12"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',check:'<path d="m5 12 4 4L19 6"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>'};
function uiIcon(name){const span=document.createElement('span');span.className='ui-icon';span.setAttribute('aria-hidden','true');span.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${uiPaths[name]||uiPaths.plus}</svg>`;return span;}
function chemistryMarks(value){const marks=document.createElement('span');marks.className='chemistry-marks';marks.setAttribute('aria-hidden','true');for(let i=0;i<3;i++){const dot=document.createElement('i');dot.classList.toggle('filled',Number.isFinite(value)&&i<value);marks.append(dot);}return marks;}
function layoutPitch(container,players){
  container.classList.toggle('is-pitch',teamLayout==='pitch'&&players.length>0);
  const bands={ST:0,CF:0,LW:0,RW:0,CAM:1,LM:2,CM:2,RM:2,CDM:3,LWB:4,LB:4,CB:4,RB:4,RWB:4,GK:5};
  const lateral={LW:0,LM:0,LWB:0,LB:0,ST:1,CF:1,CAM:1,CM:1,CDM:1,CB:1,GK:1,RW:2,RM:2,RWB:2,RB:2};
  const compactMidfield=players.filter(player=>['CAM','LM','CM','RM','CDM'].includes(player.position)).length<=4;
  const groups=new Map();players.forEach((player,index)=>{const band=compactMidfield&&['CAM','LM','CM','RM','CDM'].includes(player.position)?2:bands[player.position]??2;if(!groups.has(band))groups.set(band,[]);groups.get(band).push({player,index});});
  [...groups].sort((a,b)=>a[0]-b[0]).forEach(([,group],row)=>{group.sort((a,b)=>(lateral[a.player.position]??1)-(lateral[b.player.position]??1)||a.index-b.index);const span=Math.floor(60/group.length);group.forEach(({index},column)=>{const item=container.children[index];if(!item)return;item.style.setProperty('--pitch-row',row+1);item.style.setProperty('--pitch-column',column*span+1);item.style.setProperty('--pitch-span',span);});});
}
function layoutSwitch(){const group=document.createElement('div');group.className='layout-switch';group.setAttribute('aria-label','Squad view');for(const [view,label] of [['pitch','Pitch'],['list','List']]){const button=document.createElement('button');button.type='button';button.append(uiIcon(view),document.createTextNode(label));button.setAttribute('aria-pressed',String(teamLayout===view));button.onclick=()=>{const selector=button.closest('.lineup-toolbar')?'.lineup-toolbar':'#team-layout';teamLayout=view;renderTeam();document.querySelector(selector+' button[aria-pressed=true]')?.focus({preventScroll:true});};group.append(button);}return group;}
function renderTeam(){
  $('team-refresh').disabled=teamPending;$('team-find').disabled=(teamPending&&!teamRunActive)||(!teamSelected.size&&!teamPicks.size);
  $('team-find').firstElementChild.textContent=teamRunActive?'Stop team check':teamPending?'Reading squad…':teamResult?.pricingIncomplete?'Continue team search':'Find my XI';
  $('team-name').textContent=team.name||'Open your active squad';
  $('team-chemistry').textContent=Number.isFinite(team.chemistry)?`${team.chemistry}/33 chemistry`:'— chemistry';
  $('team-balance').textContent=Number.isFinite(team.balance)?`${fmt(team.balance)} coins`:'— coins';
  $('team-error').hidden=!teamUiError;$('team-error').textContent=teamUiError;
  const selectedCount=teamSelected.size,budget=teamBudget();
  $('team-select-empty').disabled=teamPending||!(team.players||[]).some(player=>!player.definitionId);
  $('team-select-clear').disabled=teamPending||!selectedCount;
  $('team-allowance').textContent=teamRunActive?teamProgressText:selectedCount?`${fmt(budget)} coins for the full lineup · ${selectedCount} positions chosen`:teamPicks.size?`${fmt(budget)} coins · ${teamPicks.size} chosen player(s)`:'Choose one or more positions.';
  if(!teamRunActive&&$('team-budget').value==='custom')$('team-allowance').textContent+=' · Planning only; can exceed your balance.';
  $('team-layout').replaceChildren(layoutSwitch());
  const playerList=$('team-players');playerList.replaceChildren();
  for(const original of team.players||[]){
    const pick=teamPicks.get(original.index),player=pick?{...original,...pick}:original;
    const label=document.createElement('div');label.className='team-player';
    const box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label',`Replace ${player.position} ${player.name}`);box.checked=teamSelected.has(player.index);box.disabled=teamPending;box.onchange=()=>{if(box.checked){teamPicks.delete(player.index);teamSelected.add(player.index);}else teamSelected.delete(player.index);teamResult=null;renderTeam();$(`team-position-${player.index}`)?.focus({preventScroll:true});};
    const art=cardArtElement('team-mini-art',player.rating,player.position,player.assetId,player.definitionId,player.name);
    const position=document.createElement('strong');position.textContent=player.position||'—';
    const name=document.createElement('span');name.textContent=player.name+(pick?' · CHOSEN':player.concept?' · CONCEPT':'');
    const copy=document.createElement('label');copy.className='team-player-copy';box.id=`team-position-${player.index}`;copy.htmlFor=box.id;copy.append(art,position,name);
    label.append(box,copy);
    const choose=document.createElement('button');choose.type='button';choose.className='team-choose-player text-button';choose.append(uiIcon(pick?'swap':'plus'));choose.title=pick?'Change chosen player':'Choose a specific player';choose.setAttribute('aria-label',`Choose player for ${player.position}`);choose.disabled=teamPending;choose.onclick=()=>openTeamPicker(player.index);label.append(choose);
    if(pick){const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='×';remove.setAttribute('aria-label',`Remove chosen ${player.name}`);remove.disabled=teamPending;remove.onclick=()=>{teamPicks.delete(player.index);teamResult=null;renderTeam();};label.append(remove);}
    playerList.append(label);
  }
  layoutPitch(playerList,team.players||[]);
  if(!team.players?.length){const empty=document.createElement('p');empty.className='field-note';empty.textContent='Refresh to load your starting XI from EA.';playerList.append(empty);}
  const results=$('team-results');results.replaceChildren();
  if(teamResult){
    const audit=document.createElement('details');audit.className='plan-evidence';const auditLabel=document.createElement('summary');auditLabel.textContent='Prices & checks';audit.append(auditLabel);const top=document.createElement('p');top.className='team-result-note';top.textContent=`${teamResult.source==='FUT.GG'?'FUT.GG budget ranking':teamResult.source==='FUTBIN + FUT.GG'?'FUTBIN + FUT.GG rankings':'FUTBIN player ratings'} · ${teamResult.priceMode==='estimate'?'Third-party price estimates':`${teamResult.cardsPriced} targeted EA price checks`} · ${new Date(teamResult.checkedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`;audit.append(top);results.append(audit);
    if(teamResult.linkSearchError){const notice=document.createElement('p');notice.className='team-result-note';notice.textContent='Some targeted FUTBIN link searches were unavailable. League and nation coverage may be limited.';results.append(notice);}
    if(teamResult.plan||teamResult.progressPlan){
      const plan=teamResult.plan||teamResult.progressPlan;
      if(!teamResult.plan){const notice=document.createElement('p');notice.className='team-plan-failure';notice.textContent=`Full target not reached (${plan.targetChemistry}/33). Optional partial step: ${plan.baselineChemistry} → ${plan.chemistry} chemistry. This is not a finished meta XI.`;results.append(notice);}
      if(plan.choices.filter(card=>!card.locked).length<teamSelected.size){const coverage=document.createElement('p');coverage.className='team-plan-failure';coverage.textContent=`Partial result: ${plan.choices.filter(card=>!card.locked).length}/${teamSelected.size} selected positions covered. Still unchanged: ${team.players.filter(player=>teamSelected.has(player.index)&&!plan.choices.some(choice=>choice.slotIndex===player.index)).map(player=>`${player.position} (${player.name})`).join(', ')}. The displayed cost covers only the proposed changes.`;results.append(coverage);}
      if(plan.chemistryTradeoff){const tradeoff=document.createElement('p');tradeoff.className='team-plan-failure';const low=plan.choices.filter(card=>card.slotChemistry<2).map(card=>`${card.name}: ${card.slotChemistry}/3`).join(' · ');tradeoff.textContent=`Chemistry trade-off: ${plan.baselineChemistry} → ${plan.chemistry}/33. Best complete lineup checked around your chosen players; the ${plan.targetChemistry}/33 target or individual chemistry requirements were not met.${low?' '+low+'.':''} Review before adding concepts.`;results.append(tradeoff);}
      const summary=document.createElement('div');summary.className='team-plan-summary';
      for(const [label,value] of [['SQUAD CHEMISTRY',`${plan.chemistry}/33`],[teamResult.priceMode==='estimate'?'EST. COST · COINS':'COST · COINS',fmt(plan.cost)],['LEFT · COINS',fmt(plan.remaining)]]){
        const metric=document.createElement('div');const caption=document.createElement('small');caption.textContent=label;const amount=document.createElement('strong');amount.textContent=value;metric.append(caption,amount);summary.append(metric);
      }
      const budgetTrack=document.createElement('meter');budgetTrack.className='budget-meter';budgetTrack.min=0;budgetTrack.max=Math.max(1,plan.cost+plan.remaining);budgetTrack.value=plan.cost;budgetTrack.setAttribute('aria-label','Planned spend out of team budget');summary.append(budgetTrack);results.append(summary);
      if(plan.cost>(team.balance||0)){const shortfall=document.createElement('p');shortfall.className='team-result-note';shortfall.textContent=`Coins needed: ${fmt(plan.cost-(team.balance||0))} more · Current balance ${fmt(team.balance||0)}. You can add this plan as concepts now.`;results.append(shortfall);}
      const note=document.createElement('p');note.className='team-result-note';note.textContent=`${plan.choices.filter(card=>!card.locked).length} positions updated · chemistry checked by EA · ${fmt(teamResult.combinationsChecked)} combinations · ${teamResult.priceMode==='estimate'?'Third-party estimates; check prices before buying.':'Prices are current listings, not reserved purchases.'}`;audit.append(note);
      const lineupTitle=document.createElement('h2');lineupTitle.className='team-lineup-title';lineupTitle.textContent='Your new XI';const lineupHead=document.createElement('div');lineupHead.className='lineup-toolbar';lineupHead.append(lineupTitle,layoutSwitch());results.append(lineupHead);
      const lineup=document.createElement('div');lineup.className='team-lineup';let swapDrawer=null;
      const planned=new Map(plan.choices.map(option=>[option.slotIndex,option]));
      for(const player of team.players){
        const option=planned.get(player.index),card=option||player;
        const row=document.createElement('article');row.className=`team-lineup-card${option?' is-planned':''}`;
        const art=cardArtElement('team-lineup-art',card.rating,player.position,card.assetId,card.definitionId,card.name,!!card.definitionId);
        const content=document.createElement('div');content.className='team-lineup-description';const position=document.createElement('small');position.textContent=`${player.position} · ${option?.locked?'BUILD AROUND':option?'NEW CARD':player.concept?'CONCEPT':'CURRENT'}`;
        const name=document.createElement(option?'a':'strong');name.textContent=card.name;
        if(option){if(option.url)name.href=option.url;name.target='_blank';name.rel='noreferrer';}
        const detail=document.createElement('span');detail.className='player-evidence';detail.textContent=option?`${option.locked?'Your chosen player':option.source==='FUT.GG'?`FUT.GG cheap #${option.metaRank}`:Number.isFinite(option.futbinRating)?`FUTBIN ${Number(option.futbinRating).toFixed(1)}`:'FUTBIN ranked card'} · ${option.slotChemistry} chem`:`${plan.slotChemistry?.[player.index]??'—'} chem`;
        if(option&&!option.locked)detail.textContent+=` · Selected for the team's chemistry, ranking and total budget${option.owned?'; owned card saves coins, with no ranking bonus':''}.`;
        if(option?.priceSource)detail.textContent+=` · ${option.priceSource} estimate (${Math.max(0,Math.round((Date.now()-option.priceUpdatedAt)/60000))}m old)`;
        const evidence=document.createElement('details');evidence.className='player-details';const disclosure=document.createElement('summary');const chemLabel=`${option?.slotChemistry??plan.slotChemistry?.[player.index]??'—'}/3 chemistry`;disclosure.setAttribute('aria-label',chemLabel+' · show card details');disclosure.title=chemLabel;const chemText=document.createElement('span');chemText.className='chemistry-label';chemText.textContent=chemLabel;disclosure.append(chemText);disclosure.prepend(chemistryMarks(option?.slotChemistry??plan.slotChemistry?.[player.index]));evidence.append(disclosure,detail);content.append(position,name,evidence);
        const price=document.createElement('strong');price.className='team-lineup-price';price.textContent=option?(option.owned?'IN CLUB':fmt(option.price)):player.definitionId?'IN XI':'OPEN';
        const actions=document.createElement('div');actions.className='team-lineup-actions';actions.append(price);row.append(art,content,actions);
        if(teamResult.plan&&teamSelected.has(player.index)){
          const swap=document.createElement('button');swap.type='button';swap.className='team-swap-button';swap.title='Swap player';swap.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/></svg>';swap.setAttribute('aria-label',`Find alternatives for ${player.position} ${card.name}`);swap.disabled=teamPending||!!teamResult.applied;swap.onclick=()=>loadTeamAlternatives(player.index);actions.append(swap);
          if(teamSwapView?.slotIndex===player.index){
            const picker=document.createElement('div');picker.className='team-swap-options';
            const heading=document.createElement('strong');heading.textContent=teamSwapView.loading?'Checking fresh alternatives…':'Compare swaps';picker.append(heading);
            if(!teamSwapView.loading&&!teamSwapView.alternatives.length){const empty=document.createElement('p');empty.textContent=teamSwapView.reason||'No verified alternative is available within the remaining budget.';picker.append(empty);}
            for(const alternative of teamSwapView.alternatives){
              const button=document.createElement('button');button.type='button';button.className='team-swap-choice';button.disabled=teamPending;
              const candidate=alternative.card;
              const picture=cardArtElement('team-lineup-art',candidate.rating,player.position,candidate.assetId,candidate.definitionId,candidate.name);
              const description=document.createElement('span');description.className='team-swap-description';
              const title=document.createElement('strong');title.textContent=alternative.card.name;
              const delta=value=>value===0?'±0':`${value>0?'+':'−'}${fmt(Math.abs(value))}`;
              const detail=document.createElement('span');detail.textContent=`${candidate.owned?'In club':`${fmt(candidate.price)} coins`} · ${delta(alternative.cost-plan.cost)} coins vs current pick`;
              const chemistry=document.createElement('span');chemistry.textContent=`Squad chemistry ${alternative.chemistry}/33 (${delta(alternative.chemistry-plan.chemistry)}) · Player ${candidate.slotChemistry??'—'}/3`;
              description.append(title,detail,chemistry);button.append(picture,description);button.onclick=()=>chooseTeamAlternative(player.index,alternative.card.definitionId);picker.append(button);
            }
            const close=document.createElement('button');close.type='button';close.textContent='Close alternatives';close.onclick=()=>{teamSwapView=null;renderTeam();};picker.append(close);swapDrawer=picker;
          }
        }
        lineup.append(row);
      }
      layoutPitch(lineup,team.players);results.append(lineup);if(swapDrawer){results.append(swapDrawer);}
      if(teamResult.plan){
        const apply=document.createElement('button');apply.type='button';apply.id='team-apply';apply.className='primary team-apply';apply.textContent=teamResult.applied?'Players added to squad':'Add players to squad';apply.disabled=teamPending||!!teamResult.applied;apply.onclick=applyTeamConcepts;results.append(apply);
      }
    }else{
      const reason=document.createElement('p');reason.className='team-plan-failure';reason.textContent=teamResult.planReason||'No full lineup passed every check.';results.append(reason);
      for(const group of teamResult.results||[]){if(group.options.length)continue;const note=document.createElement('p');note.className='field-note';note.textContent=`${group.player.position}: ${teamNoFitReason(group)}`;results.append(note);}
    }
  }
  reportSize();
}
async function applyTeamConcepts(){
  if(teamPending||!teamResult?.plan||teamResult.applied)return;
  teamPending=true;teamUiError='';teamSwapView=null;renderTeam();
  try{teamResult=await call('teamApply',{planId:teamResult.planId});}
  catch(error){teamUiError=error.message;}
  finally{teamPending=false;renderTeam();}
}
function showPrefetchedSwap(slotIndex,entry){
  if(teamSwapView?.slotIndex!==slotIndex)return;
  teamSwapView=entry.data?{...entry.data,loading:false}:{slotIndex,loading:entry.state!=='error',alternatives:[],reason:entry.error};
  renderTeam();
}
function drainTeamPrefetch(){
  if(swapActive||teamPending||!swapQueue.length)return;
  swapActive=(async()=>{
    while(swapQueue.length&&!teamPending){
      const task=swapQueue.shift(),entry=swapCache.get(task.slotIndex);
      if(task.epoch!==swapEpoch||task.context!==teamResult||teamResult?.applied||!entry)continue;
      entry.state='loading';
      try{
        const data=await call('teamAlternatives',{slotIndex:task.slotIndex,planId:task.context.planId},true);
        if(task.epoch!==swapEpoch||task.context!==teamResult)continue;
        Object.assign(entry,{state:'ready',data,at:Date.now()});
      }catch(error){
        if(task.epoch!==swapEpoch||task.context!==teamResult)continue;
        Object.assign(entry,{state:'error',error:error.message,at:Date.now()});
        if(/\b(?:401|429)\b|squad changed|expired|another panel/i.test(error.message)){
          for(const waiting of swapQueue){const pending=swapCache.get(waiting.slotIndex);if(pending)Object.assign(pending,{state:'error',error:error.message,at:Date.now()});}
          swapQueue=[];
        }
      }
      if(task.epoch===swapEpoch&&task.context===teamResult)showPrefetchedSwap(task.slotIndex,entry);
    }
  })().finally(()=>{swapActive=null;drainTeamPrefetch();});
}
function queueTeamAlternative(slotIndex,priority=false){
  if(!teamResult?.plan||teamResult.applied)return;
  let entry=swapCache.get(slotIndex);
  if(entry?.context!==teamResult||entry.state==='error'||entry.state==='ready'&&Date.now()-Math.min(entry.at,teamResult.checkedAt||entry.at)>=10*60_000){
    entry={context:teamResult,state:'queued'};swapCache.set(slotIndex,entry);
    swapQueue=swapQueue.filter(task=>task.slotIndex!==slotIndex);
    const task={slotIndex,context:teamResult,epoch:swapEpoch};
    if(priority)swapQueue.unshift(task);else swapQueue.push(task);
  }else if(priority&&entry.state==='queued'){
    const index=swapQueue.findIndex(task=>task.slotIndex===slotIndex);
    if(index>0)swapQueue.unshift(...swapQueue.splice(index,1));
  }
  showPrefetchedSwap(slotIndex,entry);drainTeamPrefetch();
}
async function stopTeamPrefetch(){
  swapEpoch++;swapQueue=[];swapCache.clear();
  if(swapActive){await call('teamCancel');await swapActive;}
}
function startTeamPrefetch(){
  swapEpoch++;swapQueue=[];swapCache.clear();
  if(!teamResult?.plan||teamResult.applied)return;
  for(const card of teamResult.plan.choices)if(!card.locked&&teamSelected.has(card.slotIndex))queueTeamAlternative(card.slotIndex);
}
async function loadTeamAlternatives(slotIndex){
  if(teamPending)return;
  teamUiError='';teamSwapView={slotIndex,loading:true,alternatives:[]};
  queueTeamAlternative(slotIndex,true);renderTeam();document.querySelector('.team-swap-options')?.scrollIntoView?.({block:'nearest'});
}
async function chooseTeamAlternative(slotIndex,definitionId){
  if(teamPending)return;teamPending=true;teamUiError='';renderTeam();
  try{teamResult=await call('teamSwap',{slotIndex,definitionId,planId:teamResult.planId});team=teamResult.team;teamSwapView=null;startTeamPrefetch();}
  catch(error){teamUiError=error.message;}
  finally{teamPending=false;renderTeam();drainTeamPrefetch();}
}
function openTeamPicker(slotIndex){
  if(teamPending)return;
  teamPickerSlot=slotIndex;teamPickerEpoch++;
  $('team-picker').hidden=false;$('team-picker-title').textContent=`Choose ${team.players.find(player=>player.index===slotIndex)?.position||'player'}`;
  $('team-picker-query').value='';$('team-picker-results').replaceChildren();$('team-picker-status').textContent='Search to see eligible card versions.';$('team-picker-query').focus();
}
function closeTeamPicker(){teamPickerEpoch++;teamPickerSlot=null;$('team-picker').hidden=true;}
async function searchTeamPicker(event){
  event?.preventDefault();if(teamPending||teamPickerSlot===null)return;
  const slotIndex=teamPickerSlot,epoch=++teamPickerEpoch,query=$('team-picker-query').value.trim();
  if(query.length<2)return;
  teamPending=true;renderTeam();$('team-picker-search').disabled=true;$('team-picker-results').replaceChildren();$('team-picker-status').textContent='Finding eligible card versions…';
  try{
    const result=await call('teamPlayerSearch',{slotIndex,query,fingerprint:team.fingerprint});
    if(epoch!==teamPickerEpoch)return;
    $('team-picker-status').textContent=result.cards.length?`${result.cards.length} eligible card(s). Choose the version you want.${result.truncated?' More matches exist; narrow the name.':''}`:'No matching cards can play here. Try a fuller name or another position.';
    for(const card of result.cards){
      const button=document.createElement('button');button.type='button';button.className='team-picker-card';button.title=`${card.name} · ${card.rating} · card ${card.definitionId}`;
      const art=cardArtElement('team-mini-art',card.rating,card.position,card.assetId,card.definitionId,card.name);
      const name=document.createElement('strong');name.textContent=card.name;
      const detail=document.createElement('span');detail.textContent=`${card.rating} ${card.position} · ${card.rarity>1?'Special':'Regular'} · Price checked when building`;
      button.append(art,name,detail);button.onclick=()=>{
        if(teamPending)return;
        if([...teamPicks].some(([index,pick])=>index!==slotIndex&&pick.assetId===card.assetId)){$('team-picker-status').textContent='This player is already chosen for another position.';return;}
        teamPicks.set(slotIndex,card);teamSelected.delete(slotIndex);teamResult=null;swapEpoch++;swapQueue=[];swapCache.clear();closeTeamPicker();renderTeam();
      };$('team-picker-results').append(button);
    }
  }catch(error){if(epoch===teamPickerEpoch)$('team-picker-status').textContent=error.message;}
  finally{teamPending=false;$('team-picker-search').disabled=false;renderTeam();}
}
$('team-picker-form').onsubmit=searchTeamPicker;$('team-picker-close').onclick=closeTeamPicker;
$('team-picker-query').addEventListener('keydown',event=>{if(event.key==='Escape')closeTeamPicker();});
let teamSyncing=false;
async function syncTeam(force=false){
  if(preview||teamPending||teamSyncing||swapActive&&!force||activeView!=='team')return;
  teamSyncing=true;
  try{
    const next=await call('teamSnapshot');
    if(teamPending)return;
    if(next.fingerprint!==team.fingerprint){
      const previous=new Map((team.players||[]).map(player=>[player.index,player]));
      teamSelected=new Set([...teamSelected].filter(index=>next.players.some(player=>player.index===index&&!(player.concept&&player.definitionId!==previous.get(index)?.definitionId))));
      teamPicks.clear();teamPickerEpoch++;$('team-picker').hidden=true;team=next;teamResult=null;teamSwapView=null;swapEpoch++;swapQueue=[];swapCache.clear();renderTeam();
    }
  }catch{}finally{teamSyncing=false;}
}
setInterval(()=>{if(!document.hidden)void syncTeam();},5000);
window.addEventListener('focus',()=>void syncTeam(true));
async function refreshTeam(){
  if(preview||teamPending)return;teamPending=true;teamUiError='';renderTeam();
  try{const next=await call('teamSnapshot');teamSelected=new Set([...teamSelected].filter(index=>next.players.some(player=>player.index===index&&!(player.concept&&player.definitionId!==team.players?.find(old=>old.index===index)?.definitionId))));if(next.fingerprint!==team.fingerprint){teamPicks.clear();teamPickerEpoch++;$('team-picker').hidden=true;}team=next;teamResult=null;}
  catch(error){teamUiError=error.message;}
  finally{teamPending=false;renderTeam();}
}
async function findTeam(){
  if(preview)return;
  if(teamRunActive){
    try{await call('teamCancel');teamProgressText='Stopping after the current EA request…';renderTeam();}catch(error){teamUiError=error.message;renderTeam();}
    return;
  }
  if(teamPending)return;
  await refreshTeam();if(teamUiError)return;
  teamSwapView=null;teamPending=true;teamRunActive=true;teamProgressText='Reading your squad…';teamUiError='';renderTeam();
  let timer,polling=false,idlePolls=0,rejectInterrupted;
  const startedAt=Date.now();
  const interrupted=new Promise((_,reject)=>{rejectInterrupted=reject;});
  const poll=setInterval(async()=>{
    if(polling)return;polling=true;
    try{const progress=await call('teamRunState');
      idlePolls=progress.running?0:idlePolls+1;
      if(teamRunActive&&idlePolls>=2&&Date.now()-startedAt>5000)rejectInterrupted(Error('The background team check was interrupted. Retry to start a new check.'));
      if(teamRunActive&&progress.status){teamProgressText=progress.status;$('team-allowance').textContent=teamProgressText;}}
    catch{}finally{polling=false;}
  },1000);
  try{
    teamResult=await Promise.race([interrupted,call('teamRecommend',{slots:[...teamSelected],budget:teamBudget(),picks:[...teamPicks].map(([slotIndex,card])=>({slotIndex,definitionId:card.definitionId}))}),new Promise((_,reject)=>{timer=setTimeout(()=>{void call('teamCancel').catch(()=>{});reject(Error('Team check took too long. Reopen the menu and retry; no team was applied.'));},9*60_000);})]);
    team=teamResult.team;if(teamResult.plan)$('team-editor').open=false;startTeamPrefetch();
  }catch(error){teamUiError=error.message;}
  finally{clearInterval(poll);clearTimeout(timer);teamPending=false;teamRunActive=false;renderTeam();drainTeamPrefetch();}
}

async function refreshInsights(){
  if(preview||insightsPending)return;
  insightsPending=true;renderInsights();
  try{insights=await call('marketInsightsRefresh');insightsUiError='';}
  catch(error){if(!recovering){insightsUiError=error.message;try{insights=await call('marketInsightsState');}catch{}}}
  finally{insightsPending=false;renderInsights();}
}
function setView(view){
  activeView=view;
  document.documentElement.classList.toggle('trader-active',view==='trader');
  document.documentElement.classList.toggle('insights-active',view==='insights');
  document.documentElement.classList.toggle('team-active',view==='team');
  $('sbc-view').hidden=view!=='sbc';
  $('trader-view').hidden=view!=='trader';
  $('insights-view').hidden=view!=='insights';
  $('team-view').hidden=view!=='team';
  for(const name of ['sbc','trader','insights','team']){
    const tab=$(name+'-tab'),selected=view===name;
    tab.classList.toggle('active',selected);
    if(selected)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
  }
  if(view==='trader')refreshTrader();
  if(view==='insights'&&!preview)call('marketInsightsState').then(value=>{insights=value;renderInsights();}).catch(()=>{});
  if(view==='team')void syncTeam(true);
  render();renderTrader();renderInsights();renderTeam();
}
for(const [id,icon] of [['trader-futbin','coin'],['trader-diagnose','shield'],['price-check','coin']])$(id).prepend(uiIcon(icon));
for(const id of ['connect','team-refresh']){const button=$(id);button.replaceChildren(uiIcon('refresh'));button.title=id==='connect'?'Refresh SBC':'Refresh squad';button.setAttribute('aria-label',button.title);}
document.querySelector('.club-brand').onclick=event=>{event.preventDefault();setView('sbc');};
$('sbc-tab').onclick=()=>setView('sbc');
$('trader-tab').onclick=()=>setView('trader');
$('insights-tab').onclick=()=>setView('insights');
$('team-tab').onclick=()=>setView('team');
$('team-refresh').onclick=()=>refreshTeam();
$('team-find').onclick=()=>findTeam();
$('team-select-empty').onclick=()=>{for(const player of team.players||[])if(!player.definitionId&&!teamPicks.has(player.index))teamSelected.add(player.index);teamResult=null;renderTeam();};
$('team-select-clear').onclick=()=>{teamSelected.clear();teamResult=null;renderTeam();};
$('team-budget').onchange=()=>{teamResult=null;teamSwapView=null;$('team-custom-budget').hidden=$('team-budget').value!=='custom';renderTeam();};
$('team-custom-budget').oninput=()=>{teamResult=null;teamSwapView=null;renderTeam();};
$('insights-refresh').onclick=()=>refreshInsights();
$('insights-save-key').onclick=async()=>{if(insightsPending)return;insightsPending=true;renderInsights();try{insights=await call('marketInsightsSetKey',{key:$('insights-key').value});$('insights-key').value='';insightsUiError='';}catch(error){insightsUiError=error.message;}finally{insightsPending=false;renderInsights();}};
$('insights-clear-key').onclick=async()=>{if(insightsPending)return;insightsPending=true;renderInsights();try{insights=await call('marketInsightsSetKey',{key:''});$('insights-key').value='';insightsUiError='';}catch(error){insightsUiError=error.message;}finally{insightsPending=false;renderInsights();}};
$('trader-toggle').onclick=async()=>{
  if(traderPending)return;
  traderPending=true;renderTrader();
  try{trader=await call(trader.enabled?'tradeStop':'tradeStart');$('trader-error').hidden=true;}
  catch(error){if(!recovering){$('trader-error').textContent=error.message;$('trader-error').hidden=false;}}
  finally{traderPending=false;renderTrader();}
};
$('trader-diagnose').onclick=async()=>{
  if(traderPending||trader.enabled)return;
  traderPending=true;renderTrader();
  try{trader=await call('tradeDiagnose');$('trader-error').hidden=true;}
  catch(error){if(!recovering){$('trader-error').textContent=error.message;$('trader-error').hidden=false;}}
  finally{traderPending=false;renderTrader();}
};
$('trader-futbin').onclick=async()=>{
  if(traderPending||trader.enabled)return;
  traderPending=true;renderTrader();
  try{trader=await call('tradeCheckFutbin');$('trader-error').hidden=true;}
  catch(error){if(!recovering){$('trader-error').textContent=error.message;$('trader-error').hidden=false;}}
  finally{traderPending=false;renderTrader();}
};
$('trader-recover').onclick=async()=>{
  if(traderPending||!trader.recoveryRequired)return;
  traderPending=true;renderTrader();
  try{trader=await call('tradeRecover');$('trader-error').hidden=true;}
  catch(error){if(!recovering){$('trader-error').textContent=error.message;$('trader-error').hidden=false;}}
  finally{traderPending=false;renderTrader();}
};
$('trader-review').onclick=async()=>{
  if(traderPending||!trader.recoveryRequired||!trader.pendingBid?.tradeId)return;
  traderPending=true;renderTrader();
  try{trader=await call('tradeReview');$('trader-error').hidden=true;}
  catch(error){if(!recovering){$('trader-error').textContent=error.message;$('trader-error').hidden=false;}}
  finally{traderPending=false;renderTrader();}
};
$('trader-reset').onclick=async()=>{
  if(traderPending||trader.inFlight)return;
  traderPending=true;renderTrader();
  try{trader=await call('tradeReset');$('trader-error').hidden=true;}
  catch(error){if(!recovering){$('trader-error').textContent=error.message;$('trader-error').hidden=false;}}
  finally{traderPending=false;renderTrader();}
};
$('connect').onclick=()=>run('connect');$('compare').onclick=()=>run('build',{url:$('source').value.trim()});$('complete').onclick=()=>run('complete',state.resolved&&!state.inserted?{mapping:[...mapping]}:{});$('reset').onclick=()=>run('reset');
$('swap-close').onclick=()=>run('swapDismiss');
$('price-check').onclick=()=>run('sbcPrepare');
for(const [id,type] of [['buy-start','sbcBuyStart'],['buy-stop','sbcBuyStop'],['buy-reset','sbcBuyReset']])$(id).onclick=async()=>{if(buyPending)return;buyPending=true;render();try{buy=await call(type);notice('');}catch(error){if(!recovering)notice(error.message,true);}finally{buyPending=false;render();}};
if(!preview){
  let reconnectAfterReload=false;
  try{reconnectAfterReload=!!sessionStorage.getItem(recoveryKey);}catch{}
  call('state').then(s=>{
    state=s;$('source').value='';render();
    if(reconnectAfterReload&&!s.challenge)run('connect');
  }).catch(e=>{if(!recovering)notice(e.message,true);});
  call('sbcBuyState').then(value=>{buy=value;render();}).catch(()=>{});
  chrome.storage.onChanged.addListener((changes,area)=>{
    const progress=changes.state?.newValue?.progress;if(progress)notice(progress);
    if(area==='session'&&changes.state?.newValue){state=changes.state.newValue;render();}
    if(area==='local'&&changes['futsbc-sbc-buy-v1']){buy=changes['futsbc-sbc-buy-v1'].newValue||{enabled:false};render();}
    if(area==='local'&&changes['futsbc-auto-trade-v1']){trader=changes['futsbc-auto-trade-v1'].newValue||{enabled:false};renderTrader();}
    if(area==='local'&&changes['futsbc-market-insights-v1']){insights={...changes['futsbc-market-insights-v1'].newValue,modelConfigured:insights.modelConfigured,modelName:insights.modelName};renderInsights();}
  });
}else{notice('Extension preview · no EA account connected.');}
render();
renderTrader();
renderInsights();
renderTeam();
setInterval(()=>{if(activeView==='trader')renderTrader();},1000);
setInterval(()=>{if(activeView==='trader'&&!trader.enabled&&trader.inFlight)void refreshTrader();},10000);
