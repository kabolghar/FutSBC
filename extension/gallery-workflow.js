import {readGalleryLoader,galleryURL,galleryPlan,galleryDirectory,galleryCollectionKey,galleryRemaining,galleryCaps} from './gallery-data.js';
export const GALLERY_KEY='futsbc-gallery-v1';
export const GALLERY_ALARM='futsbc-gallery-buy';

export function createGalleryCollector({storage,alarms,connect,ea,available,fetcher=fetch}){
  let inFlight=false,stopRequested=false;
  const state=async()=> (await storage.get(GALLERY_KEY))[GALLERY_KEY]||{enabled:false};
  const save=async next=>{await storage.set({[GALLERY_KEY]:next});return next;};
  async function page(url){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12_000);
    try{const response=await fetcher(url,{credentials:'omit',signal:controller.signal});if(!response.ok)throw Error(`Gallery provider unavailable (${response.status}).`);if(response.url&&new URL(response.url).origin!=='https://www.fut.gg')throw Error('Gallery provider redirected outside FUT.GG.');return readGalleryLoader(await response.text());}
    finally{clearTimeout(timer);}
  }
  async function remember(accountKey,ids,source='club'){
    const key=galleryCollectionKey(accountKey),history=(await storage.get(key))[key]||{};
    for(const id of ids)history[id]={at:Date.now(),source};
    await storage.set({[key]:history});return history;
  }
  async function idle(){const current=await state();if(inFlight||current.enabled||current.pending)throw Error('Stop Gallery collecting and resolve any pending purchase first.');return current;}
  async function prepare(url,grade){
    await idle();await available();
    const plan=galleryPlan(await page(galleryURL(url)),url,grade);
    const connection=await connect(),accountKey=connection.accountKey;
    const owned=[];let balance=connection.balance;
    for(let offset=0;offset<plan.players.length;offset+=100){const response=await ea(connection.tabId,'galleryOwnership',{accountKey,players:plan.players.slice(offset,offset+100)});owned.push(...response.owned);balance=response.balance;}
    const history=await remember(accountKey,owned);
    const players=plan.players.map(p=>({...p,phase:owned.includes(p.definitionId)?'owned':history[p.definitionId]?'collected':'missing'}));
    return save({...plan,players,accountKey,tabId:connection.tabId,balance,enabled:false,spent:0,pending:null,status:players.every(p=>p.phase!=='missing')?'Cards collected. Autocomplete and grade this set in-game.':'Ready to collect missing cards.'});
  }
  async function mark(definitionId,collected){
    const current=await idle();const player=current.players?.find(p=>p.definitionId===definitionId);
    if(!player||player.phase==='owned'||player.phase==='in-club'||typeof collected!=='boolean')throw Error('Choose a missing or manually recorded Gallery card.');
    const connection=await connect();if(connection.accountKey!==current.accountKey)throw Error('Switch back to the EA club for this Gallery plan.');
    const key=galleryCollectionKey(current.accountKey),history=(await storage.get(key))[key]||{};
    if(collected)history[definitionId]={at:Date.now(),source:'manual'};else delete history[definitionId];
    await storage.set({[key]:history});
    return save({...current,players:current.players.map(p=>p===player?{...p,phase:collected?'collected':'missing'}:p),status:'Collection record updated. Grade confirmation stays in-game.'});
  }
  async function start(budget,caps,planId){
    const current=await idle();await available();
    if(!current.id||planId!==current.id)throw Error('Refresh this Gallery plan before buying.');
    if(Date.now()-current.checkedAt>30*60_000)throw Error('Refresh this Gallery plan before buying; its price estimates are old.');
    const queue=galleryCaps(current,budget,caps);if(!queue.length)throw Error('These cards are already collected. Grade the set in-game.');
    const connection=await connect();if(connection.accountKey!==current.accountKey)throw Error('Switch back to the EA club for this Gallery plan.');
    if(connection.balance<budget)throw Error('The Gallery budget exceeds your current coin balance.');
    stopRequested=false;
    const next=await save({...current,tabId:connection.tabId,balance:connection.balance,enabled:true,queue,budget,spent:0,pending:null,status:'Collecting missing cards…'});
    await alarms.create(GALLERY_ALARM,{when:Date.now()+1000});return next;
  }
  async function stop(){stopRequested=true;const current=await state();await alarms.clear(GALLERY_ALARM);return save({...current,enabled:false,status:current.pending?'Stopping after the current purchase.':'Collection stopped. Collected cards remain in EA.'});}
  async function run(){
    if(inFlight)return;inFlight=true;
    try{
      let current=await state();if(!current.enabled||current.pending)return;
      await available();
      const player=current.queue?.[0];if(!player){await save({...current,enabled:false,status:'Cards collected. Autocomplete and grade this set in-game.'});return;}
      const connection=await connect();if(connection.accountKey!==current.accountKey)throw Error('The EA club changed. Gallery collecting stopped.');
      current=await state();if(stopRequested||!current.enabled||current.pending)return;
      const remaining=current.budget-current.spent;
      // Persist intent before sending a purchase. A suspended worker never repeats it blindly.
      await save({...current,pending:{...player,at:Date.now()},status:`Collecting ${player.name}…`});
      if(stopRequested){await save({...await state(),enabled:false,pending:null,status:'Collection stopped. No new purchase was sent.'});return;}
      const result=await ea(connection.tabId,'galleryBuyOne',{accountKey:current.accountKey,player,maxPrice:player.maxPrice,remaining});
      current=await state();if(stopRequested)current.enabled=false;
      if(['uncertain','purchased-unverified'].includes(result.phase)){
        await save({...current,enabled:false,pending:{...current.pending,...result},status:result.warning||'Check EA New Items before collecting again.'});return;
      }
      if(!['owned','in-club','unavailable'].includes(result.phase))throw Error('EA returned an unknown Gallery purchase result.');
      if(result.phase==='in-club'&&(!Number.isSafeInteger(result.price)||result.price<150||result.price>player.maxPrice||result.price>remaining))throw Error('The confirmed purchase price needs review in EA. No further purchase was attempted.');
      if(result.phase==='unavailable'){await save({...current,enabled:false,pending:null,players:current.players.map(p=>p.definitionId===player.definitionId?{...p,phase:'unavailable'}:p),status:`${player.name}: ${result.reason||'No listing within the approved price.'} Adjust its limit, then retry.`});return;}
      await remember(current.accountKey,[player.definitionId]);
      const next={...current,pending:null,spent:current.spent+(result.phase==='in-club'?result.price:0),balance:result.balance,queue:current.queue.slice(1),players:current.players.map(p=>p.definitionId===player.definitionId?{...p,phase:result.phase,paid:result.price||0}:p)};
      next.status=!next.queue.length?'Cards collected. Autocomplete and grade this set in-game.':current.enabled?`Collected ${player.name}. Next card…`:'Collection stopped. Collected cards remain in EA.';
      if(!next.queue.length)next.enabled=false;await save(next);
      if(next.enabled)await alarms.create(GALLERY_ALARM,{when:Date.now()+3000});
    }catch(error){const current=await state();await save({...current,enabled:false,pending:error.purchaseAttempted===false?null:current.pending,status:error.message});}
    finally{inFlight=false;}
  }
  async function recover(){
    if(inFlight)throw Error('The current Gallery request is still finishing.');
    const current=await state();if(!current.pending)return current;
    const connection=await connect();if(connection.accountKey!==current.accountKey)throw Error('Switch back to the EA club for this Gallery purchase.');
    const result=await ea(connection.tabId,'galleryOwnership',{accountKey:current.accountKey,players:[current.pending]});
    if(!result.owned.includes(current.pending.definitionId))throw Error('The card is not confirmed in your club. Resolve EA New Items, then check again. No new purchase was attempted.');
    await remember(current.accountKey,[current.pending.definitionId]);
    return save({...current,enabled:false,pending:null,balance:result.balance,queue:current.queue?.filter(p=>p.definitionId!==current.pending.definitionId),players:current.players.map(p=>p.definitionId===current.pending.definitionId?{...p,phase:'owned'}:p),status:'Card confirmed in club. Review the remaining cards before restarting.'});
  }
  async function restore(){const current=await state();if(current.pending){await save({...current,enabled:false,status:'A Gallery purchase was interrupted. Check EA New Items, then check the card again.'});await alarms.clear(GALLERY_ALARM);}else if(current.enabled)await alarms.create(GALLERY_ALARM,{when:Date.now()+1000});}
  return {state,prepare,mark,start,stop,run,recover,restore,catalogue:async()=>galleryDirectory(await page('https://www.fut.gg/fut-gallery/'))};
}
