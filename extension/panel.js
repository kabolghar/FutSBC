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
let team={},teamResult=null,teamSelected=new Set(),teamPending=false,teamUiError='',teamRunActive=false,teamProgressText='';
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
async function call(type,extra={}) {
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
  $('challenge').textContent=state.challenge?.name||'No SBC connected';
  $('formation').textContent=state.challenge?`${state.challenge.formation||'SBC'} · #${state.challenge.id}`:'Open an SBC in EA.';
  for(const id of ['connect','compare','source','reset'])$(id).disabled=busy;
  $('compare').firstElementChild.textContent=state.plan?'Find another squad':'Find + build squad';
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
    const stance=document.createElement('em');stance.textContent=`${card.risk?.toUpperCase()||'HIGH'} RISK`;head.append(link,stance);
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
    const reason=document.createElement('p');reason.className='insight-card-reason';reason.textContent=model?.reason||((card.historyDays>=2&&card.stance==='consider')?'Prior sampled prices support this entry. Verify live EA supply before buying.':'Early signal: fewer than two prior daily samples. Treat this as a conditional search, not a confirmed rise.');
    const filter=document.createElement('p');filter.className='insight-card-filter';filter.textContent=`SEARCH FILTER  ${card.filter} · checked price only, not a live EA listing`;
    row.append(main,price,plan,deadline,opinion,reason,filter);if(catalyst)row.append(catalyst);cards.append(row);
  }
  const news=$('insights-news');news.replaceChildren();
  if(!brief?.headlines?.length){const empty=document.createElement('p');empty.className='field-note';empty.textContent='No recent FUTBIN headlines were readable. Add no event premium to these prices.';news.append(empty);}
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
function renderTeam(){
  $('team-refresh').disabled=teamPending;$('team-find').disabled=(teamPending&&!teamRunActive)||!teamSelected.size;
  $('team-find').firstElementChild.textContent=teamRunActive?'Stop team check':teamPending?'Reading squad…':'Build a meta XI';
  $('team-name').textContent=team.name||'Open your active squad';
  $('team-chemistry').textContent=Number.isFinite(team.chemistry)?`${team.chemistry}/33 chemistry`:'— chemistry';
  $('team-balance').textContent=Number.isFinite(team.balance)?`${fmt(team.balance)} coins`:'— coins';
  $('team-error').hidden=!teamUiError;$('team-error').textContent=teamUiError;
  const selectedCount=teamSelected.size,budget=teamBudget();
  $('team-select-empty').disabled=teamPending||!(team.players||[]).some(player=>!player.definitionId);
  $('team-select-clear').disabled=teamPending||!selectedCount;
  $('team-allowance').textContent=teamRunActive?teamProgressText:selectedCount?`${fmt(Math.min(budget,team.balance||0))} coins for the full lineup · ${selectedCount} positions chosen`:'Choose one or more positions.';
  const playerList=$('team-players');playerList.replaceChildren();
  for(const player of team.players||[]){
    const label=document.createElement('label');label.className='team-player';
    const box=document.createElement('input');box.type='checkbox';box.checked=teamSelected.has(player.index);box.disabled=teamPending;box.onchange=()=>{if(box.checked)teamSelected.add(player.index);else teamSelected.delete(player.index);teamResult=null;renderTeam();};
    const art=cardArtElement('team-mini-art',player.rating,player.position,player.assetId,player.definitionId,player.name);
    const position=document.createElement('strong');position.textContent=player.position||'—';
    const name=document.createElement('span');name.textContent=player.name;
    const rating=document.createElement('em');rating.textContent=player.rating||'—';
    label.append(box,art,position,name,rating);playerList.append(label);
  }
  if(!team.players?.length){const empty=document.createElement('p');empty.className='field-note';empty.textContent='Refresh to load your starting XI from EA.';playerList.append(empty);}
  const results=$('team-results');results.replaceChildren();
  if(teamResult){
    const top=document.createElement('p');top.className='team-result-note';top.textContent=`${teamResult.source==='FUT.GG'?'FUT.GG meta ranking':'FUTBIN player ratings'} · ${teamResult.priceMode==='estimate'?'FUTBIN price estimates':`${teamResult.cardsPriced} targeted EA price checks`} · ${new Date(teamResult.checkedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`;results.append(top);
    if(teamResult.plan){
      const plan=teamResult.plan;
      const summary=document.createElement('div');summary.className='team-plan-summary';
      for(const [label,value] of [['SQUAD CHEMISTRY',`${plan.chemistry}/33`],[teamResult.priceMode==='estimate'?'EST. TO BUY':'TOTAL TO BUY',`${fmt(plan.cost)} coins`],['BUDGET LEFT',`${fmt(plan.remaining)} coins`]]){
        const metric=document.createElement('div');const caption=document.createElement('small');caption.textContent=label;const amount=document.createElement('strong');amount.textContent=value;metric.append(caption,amount);summary.append(metric);
      }
      results.append(summary);
      const note=document.createElement('p');note.className='team-result-note';note.textContent=`${plan.choices.length} positions updated · chemistry checked by EA · ${fmt(teamResult.combinationsChecked)} combinations · ${teamResult.priceMode==='estimate'?'FUTBIN estimates; check prices before buying.':'Prices are current listings, not reserved purchases.'}`;results.append(note);
      const lineupTitle=document.createElement('h2');lineupTitle.className='team-lineup-title';lineupTitle.textContent=`Planned ${team.formation||'starting'} squad`;results.append(lineupTitle);
      const lineup=document.createElement('div');lineup.className='team-lineup';
      const planned=new Map(plan.choices.map(option=>[option.slotIndex,option]));
      for(const player of team.players){
        const option=planned.get(player.index),card=option||player;
        const row=document.createElement('article');row.className=`team-lineup-card${option?' is-planned':''}`;
        const art=cardArtElement('team-lineup-art',card.rating,player.position,card.assetId,card.definitionId,card.name,!!card.definitionId);
        const content=document.createElement('div');const position=document.createElement('small');position.textContent=`${player.position} · ${option?'NEW CARD':'CURRENT'}`;
        const name=document.createElement(option?'a':'strong');name.textContent=card.name;
        if(option){name.href=option.url;name.target='_blank';name.rel='noreferrer';}
        const detail=document.createElement('span');detail.textContent=option?`${option.source==='FUT.GG'?`FUT.GG cheap #${option.metaRank}`:`FUTBIN ${Number(option.futbinRating).toFixed(1)}`} · ${option.slotChemistry} chem`:`${plan.slotChemistry?.[player.index]??'—'} chem`;
        content.append(position,name,detail);
        const price=document.createElement('strong');price.className='team-lineup-price';price.textContent=option?(option.owned?'IN CLUB':fmt(option.price)):player.definitionId?'IN XI':'OPEN';
        row.append(art,content,price);lineup.append(row);
      }
      results.append(lineup);
    }else{
      const reason=document.createElement('p');reason.className='team-plan-failure';reason.textContent=teamResult.planReason||'No full lineup passed every check.';results.append(reason);
      for(const group of teamResult.results||[]){if(group.options.some(option=>option.priceVerified))continue;const note=document.createElement('p');note.className='field-note';note.textContent=`${group.player.position}: ${teamNoFitReason(group)}`;results.append(note);}
    }
  }
  reportSize();
}
async function refreshTeam(){
  if(preview||teamPending)return;teamPending=true;teamUiError='';renderTeam();
  try{team=await call('teamSnapshot');teamSelected=new Set([...teamSelected].filter(index=>team.players.some(player=>player.index===index)));teamResult=null;}
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
  teamPending=true;teamRunActive=true;teamProgressText='Reading your squad…';teamUiError='';renderTeam();
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
    teamResult=await Promise.race([interrupted,call('teamRecommend',{slots:[...teamSelected],budget:teamBudget()}),new Promise((_,reject)=>{timer=setTimeout(()=>{void call('teamCancel').catch(()=>{});reject(Error('Team check took too long. Reopen the menu and retry; no team was applied.'));},9*60_000);})]);
    team=teamResult.team;
  }catch(error){teamUiError=error.message;teamResult=null;}
  finally{clearInterval(poll);clearTimeout(timer);teamPending=false;teamRunActive=false;renderTeam();}
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
  if(view==='team'&&!team.players?.length)void refreshTeam();
  render();renderTrader();renderInsights();renderTeam();
}
$('sbc-tab').onclick=()=>setView('sbc');
$('trader-tab').onclick=()=>setView('trader');
$('insights-tab').onclick=()=>setView('insights');
$('team-tab').onclick=()=>setView('team');
$('team-refresh').onclick=()=>refreshTeam();
$('team-find').onclick=()=>findTeam();
$('team-select-empty').onclick=()=>{for(const player of team.players||[])if(!player.definitionId)teamSelected.add(player.index);teamResult=null;renderTeam();};
$('team-select-clear').onclick=()=>{teamSelected.clear();teamResult=null;renderTeam();};
$('team-budget').onchange=()=>{$('team-custom-budget').hidden=$('team-budget').value!=='custom';renderTeam();};
$('team-custom-budget').oninput=()=>renderTeam();
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
