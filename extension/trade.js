import {renderPortfolio} from './trader-portfolio-ui.js';
import {coins,tradeMath,rankQuotes,parseQuotes} from './trade-core.js';

const $=id=>document.getElementById(id);
const fmt=value=>new Intl.NumberFormat('en-US').format(value);
const key='futsbc-trade-desk-v1';
const data={watchlist:[],trades:[]};
let autoState={enabled:false};
let autoPending=false;
const id=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;

function element(tag,className='',text=''){
  const node=document.createElement(tag);
  if(className)node.className=className;
  node.textContent=text;
  return node;
}

function notice(message,error=false){
  $('notice').hidden=!message;
  $('notice').textContent=message;
  $('notice').classList.toggle('error',error);
}

function renderAuto(){
  const active=!!autoState.enabled;
  $('auto-state').textContent=active?'ON':'OFF';
  $('auto-status').textContent=autoState.status||'Connect to your signed-in FC 27 console club to start.';
  $('auto-coins').textContent=Number.isSafeInteger(autoState.lastBalance)?fmt(autoState.lastBalance):'—';
  $('auto-spent').textContent=`${autoState.portfolio?.dayProfit>0?'+':''}${fmt(autoState.portfolio?.dayProfit||0)}`;
  renderPortfolio($('auto-portfolio'),autoState.portfolio);
  $('auto-trades').textContent=fmt(autoState.portfolio?.sales||0);
  $('auto-toggle').disabled=autoPending;
  $('auto-toggle').classList.toggle('stop',active);
  $('auto-toggle').replaceChildren(document.createTextNode(active?'Stop auto trader':'Start auto trader'),element('span','',active?'■':'→'));
  const remaining=active&&autoState.nextAt?Math.max(0,Math.ceil((autoState.nextAt-Date.now())/1000)):0;
  $('auto-next').textContent=remaining?`Next scan in ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'Within balance · return per coin';
  const last=autoState.lastTrade;
  $('auto-history').hidden=!last;
  $('auto-history').textContent=last?`LAST ATTEMPT  ${last.name} · ${last.purchased?`won for ${fmt(last.buy)}`:'win unverified'} · ${last.listed?`listed ${fmt(last.sell)}`:'not listed'}`:'';
}

async function refreshAuto(){
  if(!globalThis.chrome?.runtime?.sendMessage)return;
  try{
    const response=await chrome.runtime.sendMessage({type:'tradeState'});
    if(!response?.ok)throw Error(response?.error||'Could not read trader status.');
    autoState=response.data||{enabled:false};
    renderAuto();
  }catch(error){
    $('auto-status').textContent=`Trader status unavailable: ${error.message}`;
  }
}

$('auto-toggle').addEventListener('click',async()=>{
  if(!globalThis.chrome?.runtime?.sendMessage){notice('Open the Trade Desk from the installed extension.',true);return;}
  autoPending=true;renderAuto();
  try{
    const response=await chrome.runtime.sendMessage({type:autoState.enabled?'tradeStop':'tradeStart'});
    if(!response?.ok)throw Error(response?.error||'Trader could not change state.');
    autoState=response.data;renderAuto();notice(autoState.status);
  }catch(error){notice(error.message,true);}
  finally{autoPending=false;renderAuto();}
});

async function readSaved(){
  try{
    const saved=globalThis.chrome?.storage?.local
      ?(await chrome.storage.local.get(key))[key]
      :JSON.parse(localStorage.getItem(key)||'null');
    if(Array.isArray(saved?.watchlist))data.watchlist=saved.watchlist.filter(entry=>{
      try{return typeof entry.name==='string'&&!!entry.name.trim()&&!!tradeMath(entry.buy,entry.sell,entry.target);}catch{return false;}
    }).slice(0,500);
    if(Array.isArray(saved?.trades))data.trades=saved.trades.filter(entry=>{
      try{return typeof entry.name==='string'&&!!entry.name.trim()&&!!tradeMath(entry.buy,entry.sell);}catch{return false;}
    }).slice(0,500);
  }catch{notice('Saved trades could not be loaded. New entries will still work.',true);}
  render();
}

async function save(){
  const value={watchlist:data.watchlist,trades:data.trades};
  if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({[key]:value});
  else localStorage.setItem(key,JSON.stringify(value));
}

function quoteValues(){
  return {name:$('player').value.trim(),buy:coins($('buy').value),sell:coins($('sell').value),target:coins($('target').value,{allowZero:true})};
}

function updateMath(){
  try{
    const {buy,sell,target}=quoteValues();
    const math=tradeMath(buy,sell,target);
    $('profit').textContent=`${math.profit>=0?'+':''}${fmt(math.profit)}`;
    $('profit').classList.toggle('negative',math.profit<0);
    $('net').textContent=fmt(math.netSale);
    $('max-buy').textContent=fmt(math.maxBuy);
    $('break-even').textContent=fmt(math.breakEvenSale);
    $('quote-feedback').textContent=math.meetsTarget?'Meets your target. Verify the live market before trading.':`Below your ${fmt(target)} coin target. Check prices again before trading.`;
  }catch{
    for(const field of ['profit','net','max-buy','break-even'])$(field).textContent='—';
    $('profit').classList.remove('negative');
    $('quote-feedback').textContent='Enter prices to see the margin. Check current listings before buying.';
  }
}

function watchRow(entry){
  const row=element('div','watch-row');
  const identity=element('div','watch-identity');
  identity.append(element('strong','',entry.name),element('small','',entry.math.meetsTarget?'MEETS TARGET':'BELOW TARGET'));
  const buy=element('div','watch-number',fmt(entry.math.buy));
  buy.dataset.label='BUY';
  const sell=element('div','watch-number',fmt(entry.math.sell));
  sell.dataset.label='SELL';
  const profit=element('div',`watch-profit ${entry.math.profit<0?'negative':''}`,`${entry.math.profit>=0?'+':''}${fmt(entry.math.profit)}`);
  profit.dataset.label='NET PROFIT';
  const actions=element('div','row-actions');
  const use=element('button','text-button','Check');
  use.type='button';
  use.setAttribute('aria-label',`Check ${entry.name}`);
  use.onclick=()=>{
    $('player').value=entry.name;$('buy').value=entry.buy;$('sell').value=entry.sell;$('target').value=entry.target;
    updateMath();$('player').focus();window.scrollTo({top:0,behavior:'smooth'});
  };
  const record=element('button','text-button','Record');
  record.type='button';
  record.setAttribute('aria-label',`Record a completed sale for ${entry.name}`);
  record.onclick=()=>{
    $('trade-player').value=entry.name;$('trade-buy').value=entry.buy;$('trade-sell').value='';
    $('trade-sell').focus();$('trade-form').scrollIntoView({behavior:'smooth',block:'center'});
  };
  const remove=element('button','remove-button','×');
  remove.type='button';
  remove.setAttribute('aria-label',`Remove ${entry.name} from watchlist`);
  remove.onclick=async()=>{
    data.watchlist=data.watchlist.filter(item=>item.id!==entry.id);
    render();
    try{await save();}catch{notice('Could not save the watchlist change.',true);}
  };
  actions.append(use,record,remove);
  row.append(identity,buy,sell,profit,actions);
  return row;
}

function renderWatchlist(){
  const ranked=rankQuotes(data.watchlist);
  $('watch-count').textContent=`${ranked.length} ${ranked.length===1?'CARD':'CARDS'}`;
  const rows=ranked.map(watchRow);
  $('watch-rows').replaceChildren(...(rows.length?rows:[element('p','empty','No cards saved yet. Check a trade or paste a price list to start.')]));
}

function renderTrades(){
  $('trade-count').textContent=`${data.trades.length} ${data.trades.length===1?'SALE':'SALES'}`;
  const realized=data.trades.reduce((sum,entry)=>sum+tradeMath(entry.buy,entry.sell).profit,0);
  $('realized').textContent=`${realized>0?'+':''}${fmt(realized)}`;
  $('realized').classList.toggle('negative',realized<0);
  const rows=data.trades.map(entry=>{
    const math=tradeMath(entry.buy,entry.sell);
    const row=element('div','trade-row');
    const name=element('div','trade-identity');
    name.append(element('strong','',entry.name),element('small','',new Date(entry.at).toLocaleDateString()));
    const numbers=element('div','trade-numbers',`${fmt(math.buy)} → ${fmt(math.sell)}`);
    const profit=element('strong',`trade-profit ${math.profit<0?'negative':''}`,`${math.profit>=0?'+':''}${fmt(math.profit)}`);
    const remove=element('button','remove-button','×');
    remove.type='button';
    remove.setAttribute('aria-label',`Remove recorded sale for ${entry.name}`);
    remove.onclick=async()=>{
      data.trades=data.trades.filter(item=>item.id!==entry.id);
      render();
      try{await save();}catch{notice('Could not save the trade change.',true);}
    };
    row.append(name,numbers,profit,remove);
    return row;
  });
  $('trade-rows').replaceChildren(...(rows.length?rows:[element('p','empty','Your completed sales will appear here.')]));
}

function render(){renderWatchlist();renderTrades();updateMath();}

for(const field of ['player','buy','sell','target'])$(field).addEventListener('input',updateMath);

$('quote-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const values=quoteValues();
    if(!values.name)throw Error('Enter a player name.');
    data.watchlist.unshift({...values,id:id(),at:Date.now()});
    data.watchlist=data.watchlist.slice(0,500);
    render();await save();notice(`${values.name} added to the watchlist.`);
  }catch(error){notice(error.message,true);}
});

$('import-button').addEventListener('click',async()=>{
  try{
    const quotes=parseQuotes($('import-quotes').value,$('target').value);
    data.watchlist=[...quotes.map(quote=>({...quote,id:id(),at:Date.now()})),...data.watchlist].slice(0,500);
    render();await save();$('import-quotes').value='';
    notice(`${quotes.length} ${quotes.length===1?'card':'cards'} ranked in the watchlist.`);
  }catch(error){notice(error.message,true);}
});

$('trade-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const name=$('trade-player').value.trim();
    if(!name)throw Error('Enter a player name.');
    const buy=coins($('trade-buy').value),sell=coins($('trade-sell').value);
    const math=tradeMath(buy,sell);
    data.trades.unshift({id:id(),name,buy,sell,at:Date.now()});
    data.trades=data.trades.slice(0,500);
    render();await save();$('trade-form').reset();
    notice(`${name} recorded: ${math.profit>=0?'+':''}${fmt(math.profit)} coins after tax.`);
  }catch(error){notice(error.message,true);}
});

readSaved();
refreshAuto();
setInterval(()=>{if(!autoPending)refreshAuto();else renderAuto();},5000);
