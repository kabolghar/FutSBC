// Points adapter checked against EA FC 27 client builds 11321 and 11389. No raw EA endpoints or credentials.
// Called only by chrome.scripting from our trusted extension service worker.
export async function eaOperation(action, payload = {}) {
  let sbcPurchaseAttempted=false;
  try {
    if (String(window.fut_year) !== '2027') throw Error('Open the FC 27 Web App and sign in first.');
    if (typeof getAppMain !== 'function' || typeof services === 'undefined') throw Error('The FC client is not ready.');
    const club=services.User?.getUser()?.getSelectedPersona()?.getCurrentClub();
    if(!club || !(club.isPlaystation || club.isXbox)) throw Error('Select your PlayStation or Xbox club. This extension uses the console market.');
    const root=getAppMain().getRootViewController();
    const tabs=root?.getPresentedViewController();
    const nav=tabs?.getCurrentViewController?.();
    const current=nav?.getCurrentController?.();
    const findChallenge=()=>{
      const candidates=[current,...(current?.childViewControllers||[])];
      for(const c of candidates) {
        const challenge=c?._challenge || (c?._set&&c?._challengeId?c._set.getChallenge(c._challengeId):null);
        if(challenge?.squad) return challenge;
      }
      throw Error('Open the SBC squad screen in the Web App, then reconnect.');
    };
    const readCancelled=()=>!payload.sbcBuildSaving&&payload.sbcBuildToken&&window.__futsbcCancelledSbcBuild===payload.sbcBuildToken||payload.readToken&&window.__futsbcCancelledTeamRead===payload.readToken&&['teamSnapshot','teamEvaluate','teamQuote','teamPlan'].includes(action);
    if(readCancelled())throw Error(payload.sbcBuildToken?'SBC build stopped. Nothing was added.':'Background recommendations stopped.');
    const observe=(observable,allowRejection=false,stage=null)=>new Promise((resolve,reject)=>{
      const owner={};
      const timeout=payload.sbcBuildDeadline&&!payload.sbcBuildSaving?Math.max(1,Math.min(20000,payload.sbcBuildDeadline-Date.now())):20000;
      let cancelTimer;
      const timer=setTimeout(()=>{clearInterval(cancelTimer);observable.unobserve(owner);reject(Error(payload.sbcBuildDeadline&&!payload.sbcBuildSaving&&Date.now()>=payload.sbcBuildDeadline?'SBC search reached its time limit. Nothing was added.':'EA did not respond. Check the Web App connection before retrying.'));},timeout);
      if(payload.sbcBuildToken&&!payload.sbcBuildSaving)cancelTimer=setInterval(()=>{if(readCancelled()){clearTimeout(timer);clearInterval(cancelTimer);observable.unobserve(owner);reject(Error('SBC build stopped. Nothing was added.'));}},250);
      observable.observe(owner,(sender,result)=>{clearTimeout(timer);clearInterval(cancelTimer);sender.unobserve(owner);if(readCancelled()){reject(Error(payload.sbcBuildToken?'SBC build stopped. Nothing was added.':'Background recommendations stopped.'));return;}if(result.success||allowRejection)resolve(result);else{const unauthorized=Number(result.status)===401;const error=Error(unauthorized?'EA could not authenticate this request (401). Reload the EA Web App and sign in again if prompted, then reopen your squad and retry.':`EA rejected the request (${result.status ?? 'unknown'}).`);error.status=result.status;error.stage=stage;reject(error);}});
    });
    const coinBalance=()=>Number(services.User.getUser()?.getCurrency(GameCurrency.COINS)?.amount);
    const activeTeam=()=>{
      const id=services.Squad?.getActiveSquadId?.();
      const user=services.User.getUser();
      const persona=user?.selectedPersona||user?.getSelectedPersona?.();
      const displayed=[current,...(current?.childViewControllers||[])].map(controller=>controller?._squad||controller?.squad).find(squad=>squad?.getPlayers?.()&&!squad?.isSBC?.());
      const team=displayed||(id!=null&&persona?repositories.Squad?.getSquadById?.(persona,id):null);
      if(!team?.getPlayers?.()||!team?.getFormation?.())throw Error('Open your active squad in EA, then refresh Team.');
      const players=team.getFieldPlayers?.()||team.getPlayers().slice(0,11);
      if(players.length<11)throw Error('EA did not return a complete starting XI. Open your active squad and retry.');
      return {team,players};
    };
    // Cache read-only concept metadata, never club ownership or purchases.
    // Scope it to this client and squad; applying a team always queries afresh.
    const teamConceptRows=async(criteria,stage=null)=>{
      const scope=teamFingerprint(activeTeam().players),search=services.Item.searchConceptItems;
      let cache=window.__futsbcTeamConceptCache;
      if(!cache||cache.client!==services||cache.search!==search||cache.scope!==scope){
        cache={client:services,search,scope,queries:new Map(),cards:new Map()};
        window.__futsbcTeamConceptCache=cache;
      }
      const key=JSON.stringify([[...criteria.defId].sort((a,b)=>a-b),criteria.count,criteria.offset]);
      const cached=cache.queries.get(key);
      if(action!=='teamApply'&&cached&&Date.now()-cached.at<60_000){
        if(readCancelled())throw Error('Background recommendations stopped.');
        return {response:{items:cached.rows}};
      }
      const result=await observe(search.call(services.Item,criteria),false,stage);
      const rows=result.response?.items;
      if(Array.isArray(rows)&&rows.length&&rows.every(item=>item?.concept)){
        const at=Date.now();cache.queries.set(key,{at,rows});
        for(const item of rows)cache.cards.set(Number(item.definitionId),{at,item});
        while(cache.queries.size>64)cache.queries.delete(cache.queries.keys().next().value);
        while(cache.cards.size>528)cache.cards.delete(cache.cards.keys().next().value);
      }
      return result;
    };
    const hasTeamCard=item=>Number(item?.definitionId)>0&&(item?.isValid?.()||item?.concept===true);
    const teamPlayerName=item=>{
      if(!hasTeamCard(item))return 'Open position';
      const data=item.getStaticData?.()||item._staticData||{};
      const display=String(data.commonName||data.name||[data.firstName,data.lastName].filter(Boolean).join(' ')||item.commonName||item.name||item.lastName||'').trim();
      return display||`Player ${Number(item.rating)||''}`.trim();
    };
    const workArea=[current,current?.workAreaController,...(current?.childViewControllers||[])].find(controller=>controller?.getViewModel?.()?.getChallenge?.()?.isOneClickChallenge?.());
    if(workArea&&['status','sbcPointsBuild'].includes(action)){
      const model=workArea.getViewModel(),challenge=model.getChallenge();
      const snapshot=()=>({id:challenge.id,name:String(challenge.name||'Points SBC'),kind:'points',formation:'Item Score',target:Number(challenge.scoreRequirement),submitted:Number(challenge.submittedScore)||0,selected:Number(model.getSelectedScore()),selectionLimit:Number(model.getSelectionLimit()),slots:[],fingerprint:`points:${challenge.id}:${challenge.scoreRequirement}:${challenge.submittedScore}:${[...model.getSelectedItemIds()].map(String).sort().join(',')}`});
      const before=snapshot(),selectionBefore=JSON.stringify([...model.getSelectedItemIds()]);
      if(action==='status')return {ok:true,challenge:before};
      if(payload.fingerprint!==before.fingerprint)throw Error('The points challenge changed. Refresh and retry.');
      const target=before.target-before.submitted,limit=before.selectionLimit,maxRating=payload.maxRating??82;
      if(!Number.isSafeInteger(target)||target<1||target>100000||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(maxRating)||maxRating<1||maxRating>99)throw Error('EA did not provide a supported score target or selection limit.');
      if(!Array.isArray(payload.excludedDefinitionIds||[])||(payload.excludedDefinitionIds||[]).length>528||(payload.excludedDefinitionIds||[]).some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Invalid card exclusions.');
      if(typeof model.getSortDirection!=='function'||typeof model.getTradeStatus!=='function'||typeof services.Item?.isFavoritePlayersEnabled!=='function')throw Error('EA Work Area search settings are not ready. Reopen this challenge and retry.');
      const sort=model.getSortDirection(),tradeStatus=model.getTradeStatus(),favoritesEnabled=services.Item.isFavoritePlayersEnabled();
      const initialBatch=model._initialFetchBatch??2*limit+1,subsequentBatch=model._subsequentFetchBatch??limit+1;
      if(typeof favoritesEnabled!=='boolean'||!Number.isInteger(initialBatch)||initialBatch<1||initialBatch>201||!Number.isInteger(subsequentBatch)||subsequentBatch<1||subsequentBatch>101)throw Error('EA did not provide supported Work Area pagination settings.');
      payload.sbcBuildDeadline=Date.now()+90000;
      const deadline=payload.sbcBuildDeadline;
      const check=()=>{
        if(readCancelled())throw Error('SBC build stopped. Nothing was selected.');
        if(Date.now()>=deadline)throw Error('Points search timed out. Nothing was selected.');
        const displayed=getAppMain().getRootViewController()?.getPresentedViewController?.()?.getCurrentViewController?.()?.getCurrentController?.();
        const displayedWorkArea=[displayed,displayed?.workAreaController,...(displayed?.childViewControllers||[])].find(controller=>controller?.getViewModel?.()?.getChallenge?.()?.isOneClickChallenge?.());
        if(displayed!==current||displayedWorkArea!==workArea||workArea.getViewModel()!==model||model.getChallenge()!==challenge||services.User.getUser()?.getSelectedPersona()?.getCurrentClub()!==club)throw Error('The points SBC screen or club changed. Nothing was selected.');
        if(model.getSortDirection()!==sort||model.getTradeStatus()!==tradeStatus||services.Item.isFavoritePlayersEnabled()!==favoritesEnabled)throw Error('Your Work Area filters changed during the search. Nothing selected.');
        if(JSON.stringify([...model.getSelectedItemIds()])!==selectionBefore)throw Error('Your Work Area selection changed during the search. Nothing selected.');
        if(snapshot().fingerprint!==before.fingerprint)throw Error('The challenge progress changed. Nothing selected.');
      };
      let retries=0;
      // Only these read factories may retry. Never replay selection, buying or submission.
      const read=async(request,stage,label)=>{
        for(;;){
          check();
          try{const result=await observe(request(),false,stage);check();return result;}
          catch(error){
            if(Number(error.status)!==503)throw error;
            check();
            if(retries>=2){error.message=`EA is temporarily unavailable (503) while ${label}. Retry later. Your selection was not changed.`;throw error;}
            retries++;
            window.__futsbcSbcBuildProgress={id:payload.sbcBuildToken,status:`EA unavailable · retry ${retries}/2 · ${label}…`};
            // Wait in short slices so Stop, navigation and manual edits take effect promptly.
            for(let remaining=retries===1?1500:3000;remaining>0;remaining-=100){check();await new Promise(resolve=>setTimeout(resolve,100));}
          }
        }
      };
      const excluded=new Set(payload.excludedDefinitionIds||[]),protectedIds=new Set();
      const active=await read(()=>services.Squad.requestSquadByType('active'),'pointsActiveSquad','checking your active squad');
      const activeSquad=active.data?.squad||active.response?.squad||active.response;
      if(!activeSquad?.getPlayers)throw Error('Could not check your active squad. Nothing selected.');
      for(const slot of activeSquad.getPlayers())if(slot.item?.id)protectedIds.add(String(slot.item.id));
      const candidates=new Map();
      for(const pile of [PileSearchType.CLUB,PileSearchType.STORAGE].filter(value=>value!=null)){
        for(let offset=0;offset<5000;){
          check();window.__futsbcSbcBuildProgress={id:payload.sbcBuildToken,status:`Reading eligible cards · ${candidates.size} checked…`};
          const storage=pile===PileSearchType.STORAGE;
          // Match native _buildCriteria: feature-gated favorite flag, sort/trade status,
          // and server offsets advanced by returned rows, not an assumed 100-card page.
          const result=await read(()=>{
            const criteria=new UTSearchCriteriaDTO();criteria.sort=sort;criteria.untradeables=tradeStatus;criteria.sbcChallengeId=challenge.id;criteria.pileSearchType=pile;
            if(favoritesEnabled)criteria.isFavorite=false;
            criteria.count=offset===0?initialBatch:subsequentBatch;criteria.offset=offset;
            return services.Club.search(criteria);
          },storage?'pointsStorageCards':'pointsClubCards',storage?'reading SBC Storage cards':'reading eligible club cards');
          const items=result.response?.items;if(!Array.isArray(items)||typeof result.response.retrievedAll!=='boolean')throw Error('EA did not confirm eligible card coverage. Nothing selected.');
          for(const item of items){
            const score=Number(item.sbsScore),rating=Number(item.rating);
            if(!item.isValid?.()||!Number.isSafeInteger(Number(item.id))||Number(item.id)<1||!Number.isSafeInteger(Number(item.definitionId))||Number(item.definitionId)<1||item.concept||!Number.isSafeInteger(score)||score<1||score>100000||!Number.isInteger(rating)||rating>maxRating||protectedIds.has(String(item.id))||services.SBC.isItemInSquad(Number(item.id))||excluded.has(Number(item.definitionId))||Number(item.loans)>=0||item.isLimitedUse?.()||item.isEnrolledInAcademy?.()||Number(item.endTime)>0||item.loan?.remaining>0||item.isFavorite===true||typeof item.isFavorite==='function'&&item.isFavorite()||item.isEvolution?.()||Number(item.rareflag)>1)continue;
            candidates.set(String(item.id),{item,score,rating,pile});
          }
          if(result.response.retrievedAll)break;
          offset+=items.length;
          if(!items.length||offset>=5000)throw Error('Eligible card coverage is incomplete. Narrow the rating limit and retry.');
        }
      }
      check();
      // Each owned instance is distinct: duplicate definitions are legal in Simplified SBCs.
      const rows=[...candidates.values()].sort((a,b)=>a.rating-b.rating),cap=Math.min(100000,target+Math.max(0,...rows.map(row=>row.score)));
      let states=new Map([['0:0',{score:0,cost:0,rows:[]}]]);
      for(let index=0;index<rows.length;index++){
        const row=rows[index];
        for(const previous of [...states.values()]){
          const score=previous.score;
          if(previous.rows.length>=limit||score>=target)continue;
          const sum=score+row.score;if(sum>cap)continue;
          const cost=previous.cost+Math.pow(2,Math.max(0,row.rating-60)/3),key=`${previous.rows.length+1}:${sum}`,known=states.get(key);
          if(!known||cost<known.cost||cost===known.cost&&previous.rows.length+1<known.rows.length)states.set(key,{score:sum,cost,rows:[...previous.rows,row]});
        }
        if(states.size>150000)throw Error('The score search is too broad. Lower the rating limit and retry.');
        if(index%10===0){check();window.__futsbcSbcBuildProgress={id:payload.sbcBuildToken,status:`Finding a low-waste batch · ${index+1}/${rows.length} cards…`};await new Promise(resolve=>setTimeout(resolve,0));}
      }
      const scored=[...states.values()].map(value=>[value.score,value]);
      const options=scored.filter(([score])=>score>=target).sort((a,b)=>a[0]-b[0]||a[1].cost-b[1].cost);
      const best=options[0]||scored.sort((a,b)=>b[0]-a[0]||a[1].cost-b[1].cost)[0];
      const [score,selection]=best;
      if(!selection.rows.length)throw Error('No eligible unprotected cards found under this rating limit.');
      check();if(JSON.stringify([...model.getSelectedItemIds()])!==selectionBefore)throw Error('Your Work Area selection changed during the search. Nothing selected.');if(snapshot().fingerprint!==before.fingerprint)throw Error('The challenge progress changed. Nothing selected.');
      // Stage a reviewable selection only. Never call EA submission or consume cards.
      const oldIds=[...model.getSelectedItemIds()];
      try{
        model.clearSelection();
        for(const row of selection.rows){const item=row.item;model._itemEntityMap.set(item.id,item);model._itemScoreMap.set(item.id,row.score);model._itemTabMap.set(item.id,row.pile===PileSearchType.STORAGE?OneClickSBCWorkAreaTab.STORAGE:OneClickSBCWorkAreaTab.CLUB);if(!model.selectItem(item))throw Error('EA selection limit changed.');}
        if(model.getSelectedScore()!==score)throw Error('EA did not confirm the selected score.');
        workArea._refreshCurrentPage();
      }catch(error){model.clearSelection();for(const id of oldIds){const item=model._itemEntityMap.get(id);if(item)model.selectItem(item);}workArea._refreshCurrentPage();throw error;}
      return {ok:true,challenge:snapshot(),score,target,excess:Math.max(0,score-target),shortfall:Math.max(0,target-score),checked:rows.length,players:selection.rows.map(({item,score})=>({itemId:String(item.id),definitionId:Number(item.definitionId),name:teamPlayerName(item),rating:Number(item.rating),score,owned:true}))};
    }
    const teamFingerprint=players=>players.map(slot=>`${slot.index}:${slot.item?.definitionId||0}:${slot.item?.id||0}:${!!slot.item?.concept}:${slot.generalPositionName||''}`).join('|');
    if(['teamStyles','teamStyleApply','teamStyleOpen'].includes(action)){
      const {team,players}=activeTeam(),fingerprint=teamFingerprint(players);
      if(payload.fingerprint!==fingerprint)throw Error('Your squad changed. Refresh My XI before choosing styles.');
      const slots=payload.slots;
      if(!Array.isArray(slots)||!slots.length||slots.length>11||new Set(slots).size!==slots.length||slots.some(index=>!Number.isInteger(index)||!players.some(slot=>slot.index===index&&hasTeamCard(slot.item))))throw Error('Select occupied squad positions for chemistry styles.');
      const definitions=repositories.PlayStyle?.getPlayStyles?.();
      if(!Array.isArray(definitions)||!definitions.length)throw Error('EA chemistry-style data is not ready. Refresh the Web App.');
      const styleName=id=>String(UTLocalizationUtil.playStyleIdToName(id,services.Localization));
      if(action==='teamStyleOpen'){
        const slot=players.find(slot=>slot.index===payload.slotIndex);
        if(!slots.includes(slot?.index)||slot.item.concept)throw Error('Chemistry styles can only be applied to owned cards.');
        const controller=new UTConsumableCategoriesViewController();controller.initWithSquad(team,slot.index);nav.pushViewController(controller);return {ok:true};
      }
      const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.CONSUMABLES_DEVELOPMENT;criteria.category=SearchCategory.ANY;
      const inventory=await observe(services.Club.search(criteria));
      const consumables=inventory.response?.items;
      if(!Array.isArray(consumables))throw Error('EA did not return your chemistry-style inventory.');
      if(teamFingerprint(activeTeam().players)!==fingerprint)throw Error('Your squad changed while styles were loading. Refresh My XI.');
      if(action==='teamStyleApply'){
        const slot=players.find(slot=>slot.index===payload.slotIndex),item=slot?.item;
        if(!slots.includes(slot?.index)||item.concept||String(item.id)!==String(payload.itemId)||Number(item.playStyle)!==payload.currentStyle)throw Error('This player or current style changed. Check the squad and refresh styles.');
        const pending=window.__futsbcStyleReview;
        if(pending&&String(pending.itemId)===String(item.id)){if(Number(item.playStyle)===pending.styleId)delete window.__futsbcStyleReview;else throw Error('The previous style application needs review. Refresh EA and check this player before applying again.');}
        const style=definitions.find(style=>Number(style.styleId)===payload.styleId);
        if(!style||!Number.isSafeInteger(payload.styleId))throw Error('Choose an EA chemistry style.');
        if(Number(item.playStyle)===payload.styleId)return {ok:true,applied:false,styleName:styleName(payload.styleId)};
        const consumable=consumables.find(card=>card.isStyleModifier?.()&&Number(card.subtype)===payload.styleId&&Number(card.stackCount)>0&&card.canApplyTo?.(item));
        if(!consumable)throw Error('You do not own an applicable copy of this style. Use EA consumables to add one.');
        // One explicit click spends one owned consumable. Never buy or retry an uncertain application.
        window.__futsbcStyleReview={itemId:String(item.id),styleId:payload.styleId};
        try{await observe(services.Item.applyTo(consumable,item));}
        catch(error){throw Error(`Style application was not confirmed. Check this player in EA before trying again. ${error.message}`);}
        if(Number(item.playStyle)!==payload.styleId)throw Error('EA accepted the request but has not confirmed the new style. Check the player in EA before trying again.');
        delete window.__futsbcStyleReview;
        if(typeof team.save==='function'){const saved=team.save();if(saved?.observe)try{await observe(saved);}catch(error){throw Error(`The style was applied but squad refresh was not confirmed. Refresh EA before continuing. ${error.message}`);}}
        return {ok:true,applied:true,styleName:styleName(payload.styleId)};
      }
      const weights={GK:[1.3,1.1,.2,1.5,.2,1.3],CB:[1.3,.05,.2,.3,1.6,1],LB:[1.4,.1,.6,.5,1.2,.7],RB:[1.4,.1,.6,.5,1.2,.7],LWB:[1.5,.2,.8,.6,1,.6],RWB:[1.5,.2,.8,.6,1,.6],CDM:[1,.2,.8,.5,1.4,1],CM:[1,.6,1.2,1.1,.7,.6],CAM:[1.2,1.1,1.2,1.4,.05,.3],LM:[1.5,.9,1,1.2,.1,.3],RM:[1.5,.9,1,1.2,.1,.3],LW:[1.5,1.2,.7,1.4,.05,.3],RW:[1.5,1.2,.7,1.4,.05,.3],ST:[1.4,1.6,.2,1,.05,.6],CF:[1.3,1.5,.7,1.2,.05,.4]};
      const rows=slots.map(index=>{
        const slot=players.find(slot=>slot.index===index),item=slot.item,isGK=item.isGK?.()===true,attributes=item.getAttributes?.();
        if(!Array.isArray(attributes)||attributes.length<6||attributes.slice(0,6).some(value=>!Number.isFinite(value)||value<1||value>99))throw Error(`EA attributes are unavailable for ${teamPlayerName(item)}.`);
        const priorities=weights[slot.generalPositionName]||weights.CM,labels=isGK?['DIV','HAN','KIC','REF','SPD','POS']:['PAC','SHO','PAS','DRI','DEF','PHY'];
        const options=definitions.map(style=>{
          const styleId=Number(style.styleId),bars=repositories.PlayStyle.getPlayStyleBonusById(styleId,isGK);
          if(!Number.isSafeInteger(styleId)||!Array.isArray(bars)||bars.length!==6||bars.some(value=>!Number.isFinite(value)||value<0)||!bars.some(value=>value>0))return null;
          const fit=bars.reduce((sum,value,i)=>sum+value*priorities[i]*Math.max(0,99-attributes[i]),0);
          const count=consumables.filter(card=>card.isStyleModifier?.()&&Number(card.subtype)===styleId&&(item.concept||Number(item.playStyle)===styleId||card.canApplyTo?.(item))).reduce((sum,card)=>sum+Math.max(0,Number(card.stackCount)||0),0);
          return {styleId,name:styleName(styleId),fit,owned:count,current:Number(item.playStyle)===styleId,focus:bars.map((value,i)=>value>0?labels[i]:null).filter(Boolean)};
        }).filter(Boolean).sort((a,b)=>b.fit-a.fit||Number(b.current)-Number(a.current)||a.styleId-b.styleId);
        const top=options.slice(0,3);if(!top.some(option=>option.current)){const current=options.find(option=>option.current);if(current)top.push(current);}
        return {slotIndex:index,itemId:String(item.id),definitionId:Number(item.definitionId),assetId:Number(item.assetId)||Number(item.definitionId)%0x1000000,name:teamPlayerName(item),rating:Number(item.rating),position:slot.generalPositionName,concept:!!item.concept,review:window.__futsbcStyleReview?.itemId===String(item.id)&&Number(item.playStyle)!==window.__futsbcStyleReview.styleId,chemistry:Number(slot.chemistry)||0,currentStyle:Number(item.playStyle)||0,currentName:styleName(Number(item.playStyle)||0),options:top};
      });
      return {ok:true,fingerprint,players:rows,source:'EA attribute fit',checkedAt:Date.now()};
    }
    if(action==='teamSnapshot'){
      const {team,players}=activeTeam();
      const balance=coinBalance();
      if(!Number.isSafeInteger(balance)||balance<0)throw Error('EA did not provide your coin balance.');
      return {ok:true,id:team.getId?.(),name:String(team.getName?.()||'Current squad'),formation:team.getFormation()?.displayName||'',chemistry:Number(team.getChemistry?.())||0,balance,fingerprint:teamFingerprint(players),players:players.map(slot=>({index:slot.index,position:String(slot.generalPositionName||''),name:teamPlayerName(slot.item),rating:hasTeamCard(slot.item)?Number(slot.item.rating)||0:0,assetId:hasTeamCard(slot.item)?Number(slot.item.assetId)||Number(slot.item.definitionId)%0x1000000:0,definitionId:hasTeamCard(slot.item)?Number(slot.item.definitionId)||0:0,itemId:hasTeamCard(slot.item)?Number(slot.item.id)||0:0,concept:!!slot.item?.concept,tradable:slot.item?.tradable===true&&!slot.item?.concept,leagueId:Number(slot.item?.leagueId)||0,nationId:Number(slot.item?.nationId??slot.item?.nationalityId)||0,clubId:Number(slot.item?.teamId)||0,chemistry:Number(slot.chemistry)||0}))};
    }
    if(action==='teamPlayerSearch'){
      const {players}=activeTeam();
      if(payload.fingerprint!==teamFingerprint(players))throw Error('Your squad changed. Refresh Team and search again.');
      const slot=players.find(row=>row.index===payload.slotIndex);
      const query=String(payload.query||'').trim();
      if(!slot||query.length<2||query.length>50)throw Error('Choose a position and enter at least two letters.');
      const positions={GK:0,RWB:2,RB:3,CB:5,LB:7,LWB:8,CDM:10,RM:12,CM:14,LM:16,CAM:18,CF:21,RW:23,ST:25,LW:27};
      const target=positions[slot.generalPositionName];
      if(!Number.isInteger(target))throw Error('EA did not provide this position.');
      const data=repositories.Item?.getStaticData?.();
      if(!Array.isArray(data))throw Error('EA player names are not ready. Reopen your squad and retry.');
      const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      const words=normalize(query).split(/\s+/);
      const matches=data.filter(player=>Number.isSafeInteger(Number(player.id))&&Number(player.id)>0&&Number(player.id)<0x1000000&&words.every(word=>normalize([player.commonName,player.firstName,player.lastName,player.name].filter(Boolean).join(' ')).includes(word)));
      const ids=[...new Set(matches.map(player=>Number(player.id)))].slice(0,20),cards=new Map();
      if(!ids.length)return {ok:true,cards:[],truncated:false};
      let truncated=matches.length>20;
      for(let page=0;page<3;page++){
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=ids;criteria.count=100;criteria.offset=page*100;
        const response=await observe(services.Item.searchConceptItems(criteria),false,'team-player-search');
        const rows=response.response?.items;if(!Array.isArray(rows))throw Error('EA player search results changed.');
        for(const item of rows){
          const definitionId=Number(item.definitionId),assetId=Number(item.assetId)||definitionId%0x1000000;
          if(!item.concept||!ids.includes(assetId)||!Number.isSafeInteger(definitionId)||definitionId<1||!Number.isInteger(Number(item.rating)))continue;
          if(Number(item.preferredPosition)!==target&&![item.basePossiblePositions,item.possiblePositions].some(list=>Array.isArray(list)&&list.some(position=>Number(position)===target)))continue;
          cards.set(definitionId,{definitionId,assetId,rating:Number(item.rating),name:teamPlayerName(item),rarity:Number(item.rareflag)||0,clubId:Number(item.teamId)||0,leagueId:Number(item.leagueId)||0,nationId:Number(item.nationId??item.nationalityId)||0,position:slot.generalPositionName});
        }
        if(response.response.endOfList===true||rows.length<100)break;
        if(page===2)truncated=true;
      }
      return {ok:true,cards:[...cards.values()].sort((a,b)=>b.rating-a.rating||a.definitionId-b.definitionId),truncated};
    }
    if(action==='teamEvaluate'){
      const {team,players}=activeTeam();
      if(payload.fingerprint!==teamFingerprint(players))throw Error('Your active squad changed. Refresh Team before comparing upgrades.');
      const slot=players.find(row=>row.index===payload.slotIndex);
      if(!slot)throw Error('Choose a starting XI position.');
      const candidates=Array.isArray(payload.cards)?payload.cards.slice(0,48):[];
      if(!candidates.length)return {ok:true,options:[]};
      const budget=Number(payload.budget);
      if(!Number.isSafeInteger(budget)||budget<0)throw Error('Enter a valid planning budget.');
      if(typeof UTSquadChemCalculatorUtils!=='function')throw Error('EA chemistry calculator is unavailable in this Web App version.');
      const formation=team.getFormation(),manager=team.getManager()?.item,items=players.map(row=>row.item);
      const calculator=new UTSquadChemCalculatorUtils(services.Chemistry,repositories.TeamConfig);
      const before=calculator.calculate(formation,items,manager);
      if(!Number.isFinite(before?.chemistry))throw Error('EA did not calculate your current team chemistry.');
      const beforeSlot=Number(before.getSlotChemistry?.(slot.index)?.points);
      const positionIds={GK:0,RWB:2,RB:3,CB:5,LB:7,LWB:8,CDM:10,RM:12,CM:14,LM:16,CAM:18,CF:21,RW:23,ST:25,LW:27};
      const targetPosition=positionIds[String(slot.generalPositionName||'').toUpperCase()];
      if(!Number.isInteger(targetPosition))throw Error('EA did not provide an eligible position for this squad slot.');
      const rejected={id:0,rating:0,source:0,definition:0,price:0,rank:0,fit:0};
      const wanted=candidates.filter(card=>{
        let reason=null;
        if(!Number.isSafeInteger(card.assetId)||card.assetId<=0)reason='id';
        else if(!Number.isInteger(card.rating)||card.rating<(['User','Menu'].includes(card.source)?1:75)||card.rating>99)reason='rating';
        else if(card.source==='User'){
          if(!slot.item?.concept||Number(slot.item.definitionId)!==card.definitionId)reason='definition';
        }else if(card.source==='Menu'){
          if(!Number.isSafeInteger(card.definitionId)||card.definitionId<1)reason='definition';
        }else if(card.source==='FUT.GG'){
          if(!Number.isSafeInteger(card.definitionId)||card.definitionId<=0)reason='definition';
          else if(card.price!=null)reason='price';
          else if(!Number.isInteger(card.metaRank)||card.metaRank<1||card.metaRank>120)reason='rank';
        }else if(card.source==='FUTBIN'||card.source==null){
          if(!Number.isSafeInteger(card.price)||card.price<500)reason='price';
          else if(!Number.isFinite(card.futbinRating)||card.futbinRating<75)reason='fit';
        }else reason='source';
        if(reason)rejected[reason]++;
        return !reason;
      });
      const byId=new Map();
      const sameAsset=(item,card)=>Number(item.assetId)===card.assetId||Number(item.definitionId)%0x1000000===card.assetId;
      const addConceptRows=(rows,batch)=>{
        for(const item of rows)for(const card of batch){
          if(!sameAsset(item,card))continue;
          const current=byId.get(card.assetId)||[];
          if(!current.some(row=>Number(row.definitionId)===Number(item.definitionId)))byId.set(card.assetId,[...current,item]);
        }
      };
      for(let offset=0;offset<wanted.length;offset+=12){
        const batch=wanted.slice(offset,offset+12);
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=batch.map(card=>['FUT.GG','User','Menu'].includes(card.source)?card.definitionId:card.assetId);criteria.count=100;criteria.offset=0;
        const response=await teamConceptRows(criteria,'team-concept-search');
        if(!Array.isArray(response.response?.items))throw Error('EA concept search changed. No upgrades were suggested.');
        addConceptRows(response.response.items,batch);
      }
      const missing=wanted.filter(card=>['FUT.GG','User','Menu'].includes(card.source)&&!(byId.get(card.assetId)||[]).some(item=>Number(item.definitionId)===card.definitionId));
      for(let offset=0;offset<missing.length;offset+=12){
        const batch=missing.slice(offset,offset+12);
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=[...new Set(batch.map(card=>card.assetId))];criteria.count=100;criteria.offset=0;
        const response=await teamConceptRows(criteria,'team-concept-search');
        if(!Array.isArray(response.response?.items))throw Error('EA base-card concept search changed. No upgrades were suggested.');
        addConceptRows(response.response.items,batch);
      }
      if(typeof services.Club?.search!=='function')throw Error('EA club search is unavailable. No upgrades were suggested.');
      const definitionIds=[...new Set([...byId.values()].flat().map(item=>Number(item.definitionId)).filter(id=>Number.isSafeInteger(id)&&id>0))];
      const clubByDefinition=new Map(),inSquad=new Set(players.map(row=>Number(row.item?.id)).filter(Boolean));
      for(let start=0;start<definitionIds.length;start+=12){
        const ids=definitionIds.slice(start,start+12);
        for(let page=0;page<5;page++){
          const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=ids;criteria.count=100;criteria.offset=page*100;
          const response=await observe(services.Club.search(criteria),false,'team-club-search');
          const rows=response.response?.items;
          if(!Array.isArray(rows))throw Error('EA club results changed. No upgrades were suggested.');
          for(const item of rows){
            const id=Number(item.id),definitionId=Number(item.definitionId);
            if(!Number.isSafeInteger(id)||id<1||item.concept||item.isValid?.()===false||inSquad.has(id)||!ids.includes(definitionId))continue;
            clubByDefinition.set(definitionId,[...(clubByDefinition.get(definitionId)||[]),item]);
          }
          if(response.response?.retrievedAll===true||rows.length<criteria.count)break;
          if(page===4)throw Error('EA club search was incomplete. No upgrades were suggested.');
        }
      }
      const options=[],screening={candidates:candidates.length,valid:wanted.length,rejected,concept:0,exact:0,position:0,chemistryCalculated:0,chemistryKept:0,withinBudget:0};
      for(const card of wanted){
        const rows=byId.get(card.assetId)||[];
        if(rows.length)screening.concept++;
        const exact=rows.filter(item=>item.concept&&sameAsset(item,card)&&Number(item.rating)===Number(card.rating)&&(!['FUT.GG','User','Menu'].includes(card.source)||Number(item.definitionId)===card.definitionId)&&(['User','Menu'].includes(card.source)||Number(item.definitionId)!==Number(slot.item?.definitionId)));
        if(exact.length)screening.exact++;
        const positioned=item=>Number(item.preferredPosition)===targetPosition||[item.basePossiblePositions,item.possiblePositions].some(positions=>Array.isArray(positions)&&positions.some(position=>Number(position)===targetPosition));
        const matched=exact.filter(positioned);
        if(matched.length)screening.position++;
        const definitions=[...new Set(matched.map(item=>Number(item.definitionId)))];
        if(definitions.length!==1)continue;
        const owned=(clubByDefinition.get(definitions[0])||[]).find(item=>sameAsset(item,card)&&Number(item.rating)===card.rating&&positioned(item));
        if(!payload.allowChemistryDrop&&!owned&&Number.isSafeInteger(card.price)&&card.price>budget)continue;
        screening.withinBudget++;
        const item=owned||matched[0],replacement=items.map((row,index)=>index===players.indexOf(slot)?item:row);
        let after;
        try{after=calculator.calculate(formation,replacement,manager);}catch{continue;}
        screening.chemistryCalculated++;
        const afterSlot=Number(after?.getSlotChemistry?.(slot.index)?.points);
        if(!Number.isFinite(after?.chemistry)||!Number.isFinite(afterSlot))continue;
        if(!payload.allowChemistryDrop&&(after.chemistry<before.chemistry||Number.isFinite(beforeSlot)&&afterSlot<beforeSlot))continue;
        screening.chemistryKept++;
        const chemistryChange=Number(after.chemistry-before.chemistry),slotChemistryChange=Number.isFinite(beforeSlot)?afterSlot-beforeSlot:0;
        if(!payload.allowChemistryDrop&&Number(item.rating)<(slot.item?.isValid?.()?Number(slot.item.rating):0)&&chemistryChange===0&&slotChemistryChange===0)continue;
        options.push({assetId:card.assetId,definitionId:Number(item.definitionId),ownedId:owned?Number(item.id):null,owned:!!owned,name:card.name,url:card.url,price:owned?0:card.price??null,estimatedPrice:card.price??null,priceVerified:!!owned||Number.isSafeInteger(card.price),source:card.source||'FUTBIN',futbinRating:card.futbinRating??null,metaRank:card.metaRank??null,popularity:card.popularity,rating:Number(item.rating),leagueId:Number(item.leagueId)||0,nationId:Number(item.nationId??item.nationalityId)||0,clubId:Number(item.teamId)||0,position:String(slot.generalPositionName),chemistry:Number(after.chemistry),chemistryChange,slotChemistry:afterSlot,slotChemistryChange,slotIndex:slot.index});
      }
      return {ok:true,options,baselineChemistry:Number(before.chemistry),checked:candidates.length,screening};
    }
    if(action==='teamMarket'){
      const definitionId=Number(payload.definitionId);
      if(!Number.isSafeInteger(definitionId)||definitionId<1)throw Error('Choose a verified EA card first.');
      const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=[definitionId];
      services.Item.clearTransferMarketCache();
      const results=new UTMarketSearchResultsViewController();results.initWithSearchCriteria(criteria);
      nav.pushViewController(results,true);
      return {ok:true};
    }
    const searchMarket=(criteria,allowRejection=false,page=1,stage=null)=>{
      if(typeof services.Item?.clearTransferMarketCache!=='function') throw Error('EA market search cache API changed. Trading stopped.');
      // EA's own search results controller selects the market module before searching.
      services.Module?.set?.(3355443200);
      if(page===1)services.Item.clearTransferMarketCache();
      return observe(services.Item.searchTransferMarket(criteria,page),allowRejection,stage);
    };
    const marketCriteria=(definitionId,maxBuy)=>{
      const criteria=new UTSearchCriteriaDTO();
      criteria.type=SearchType.PLAYER;
      if(Number.isInteger(definitionId)&&definitionId>0) criteria.defId=[definitionId];
      if(Number.isInteger(maxBuy)&&maxBuy>=150){
        // EA's currency controls accept only its published price increments.
        const step=maxBuy>=100000?1000:maxBuy>=50000?500:maxBuy>=10000?250:maxBuy>=1000?100:50;
        criteria.maxBuy=Math.floor(maxBuy/step)*step;
      }
      return criteria;
    };
    const AUCTION_PAGES_PER_PASS=2;
    const auction=item=>item?.getAuctionData?.();
    const watchedItems=result=>Array.isArray(result?.response?.items)?result.response.items:Array.isArray(result?.data?.items)?result.data.items:Array.isArray(result?.response)?result.response:null;
    const bidState=(item,minimumBid)=>{
      const data=auction(item),currentBid=Number(data?.currentBid);
      if(data?.isWon?.())return 'won';
      if(data?.isClosedTrade?.()||data?.isExpired?.()||Number(data?.getSecondsRemaining?.())<=0)return 'lost';
      if(!Number.isSafeInteger(currentBid))return 'unconfirmed';
      if(currentBid<minimumBid)return 'below-attempt';
      if(data?.isHighestBid?.())return 'highest';
      if(data?.isOutbid?.())return 'outbid';
      return 'unconfirmed';
    };
    const marketRows=result=>{
      if(!Array.isArray(result.data?.items)) throw Error('EA market results changed. Trading stopped.');
      return result.data.items.filter(item=>item?.isPlayer?.()&&Number.isInteger(Number(item.definitionId))&&Number(item.definitionId)>0&&auction(item)?.buyNowPrice>0);
    };
    const tick=price=>price<1000?50:price<10000?100:price<50000?250:price<100000?500:1000;
    const floorPrice=price=>Math.floor(price/tick(price))*tick(price);
    const previousPrice=price=>Math.max(150,floorPrice(price-1));
    const quotePrices=(values,futbinPrice,buy,strategy=null)=>{
      const prices=values.filter(price=>Number.isSafeInteger(price)&&price>=150).sort((a,b)=>a-b);
      if(prices.length<5)return null;
      const reference=prices[0],sell=Math.min(previousPrice(reference),floorPrice(futbinPrice));
      const minimumProfit=strategy==='quick-flip'?Math.max(buy<=1500?10:50,Math.ceil(buy*(buy<=1500 ? .02 : .04))):Math.max(200,Math.ceil(buy*.08/50)*50);
      const profit=Math.floor(sell*.95)-buy;
      return sell>buy&&profit>=minimumProfit?{sell,reference,profit,minimumProfit,comparables:prices.slice(0,5)}:null;
    };
    const quote=(rows,definitionId,tradeId,futbinPrice,buy,strategy=null)=>{
      const unique=new Map();
      for(const row of rows){
        const data=auction(row),id=String(data?.tradeId||'');
        if(Number(row.definitionId)===definitionId&&/^\d+$/.test(id)&&id!==String(tradeId)&&Number(data?.getSecondsRemaining?.())>0)unique.set(id,row);
      }
      const prices=[...unique.values()].map(row=>Number(auction(row)?.buyNowPrice)).filter(price=>Number.isSafeInteger(price)&&price>=150).sort((a,b)=>a-b);
      const offer=quotePrices(prices,futbinPrice,buy,strategy);
      const lifetime=Math.min(30,...[...unique.values()].map(row=>Number(auction(row)?.getSecondsRemaining?.())));
      return offer?{...offer,quoteValidUntil:Date.now()+Math.max(0,lifetime)*1000}:null;
    };
    if(action==='teamQuote'){
      const {players}=activeTeam();
      if(payload.fingerprint!==teamFingerprint(players))throw Error('Your active squad changed. Refresh Team before checking prices.');
      const definitionIds=[...new Set(Array.isArray(payload.definitionIds)?payload.definitionIds:[])];
      if(!definitionIds.length||definitionIds.length>8||definitionIds.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Choose up to eight exact EA cards to price.');
      const balance=coinBalance(),ceiling=Number(payload.maxPrice);
      if(!Number.isSafeInteger(ceiling)||ceiling<150)throw Error('No valid coin budget is available for market prices.');
      const quotes=[];
      for(const definitionId of definitionIds){
        if(quotes.length)await new Promise(resolve=>setTimeout(resolve,1000));
        let result;
        try{result=await searchMarket(marketCriteria(definitionId,ceiling));}
        catch(error){error.message=`Price lookup for EA card ${definitionId}: ${error.message}`;error.stage='team-price';throw error;}
        const prices=marketRows(result).filter(item=>Number(item.definitionId)===definitionId&&Number(auction(item)?.getSecondsRemaining?.())>0).map(item=>Number(auction(item).buyNowPrice)).filter(price=>Number.isSafeInteger(price)&&price>=150&&price<=ceiling).sort((a,b)=>a-b);
        quotes.push({definitionId,price:prices[0]??null,listingCount:prices.length});
      }
      return {ok:true,quotes,checkedAt:Date.now(),balance};
    }
    if(action==='teamPlan'||action==='teamApply'){
      const {team,players}=activeTeam();
      if(payload.fingerprint!==teamFingerprint(players))throw Error('Your active squad changed. Refresh Team before planning.');
      const groups=Array.isArray(payload.groups)?payload.groups:[];
      const limit=Number(payload.budget);
      if(!groups.length||groups.length>11||!Number.isSafeInteger(limit)||limit<0)throw Error('Choose squad positions and a valid total budget.');
      if(typeof UTSquadChemCalculatorUtils!=='function')throw Error('EA chemistry calculator is unavailable.');
      const ids=[...new Set(groups.flatMap(group=>group.options||[]).map(option=>Number(option.definitionId)))];
      if(ids.length>528||ids.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('The planned cards could not be verified.');
      const concepts=new Map();
      const cached=window.__futsbcTeamConceptCache;
      if(action==='teamPlan'&&cached?.client===services&&cached.search===services.Item.searchConceptItems&&cached.scope===payload.fingerprint){
        for(const id of ids){const row=cached.cards.get(id);if(row&&Date.now()-row.at<60_000)concepts.set(id,row.item);}
      }
      const uncached=ids.filter(id=>!concepts.has(id));
      for(let start=0;start<uncached.length;start+=12){
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=uncached.slice(start,start+12);criteria.count=100;criteria.offset=0;
        const found=await teamConceptRows(criteria);
        if(!Array.isArray(found.response?.items))throw Error('EA concept search changed.');
        for(const item of found.response.items)if(item?.concept&&ids.includes(Number(item.definitionId)))concepts.set(Number(item.definitionId),item);
      }
      const missing=ids.filter(id=>!concepts.has(id));
      for(let start=0;start<missing.length;start+=12){
        const batch=missing.slice(start,start+12);
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=[...new Set(batch.map(id=>id%0x1000000))];criteria.count=100;criteria.offset=0;
        const found=await teamConceptRows(criteria);
        if(!Array.isArray(found.response?.items))throw Error('EA concept search changed.');
        for(const item of found.response.items)if(item?.concept&&batch.includes(Number(item.definitionId)))concepts.set(Number(item.definitionId),item);
      }
      const ownedForApply=new Map();
      if(action==='teamApply'){
        if(typeof services.Club?.search!=='function')throw Error('EA club search is unavailable. No squad changes were made.');
        const occupied=new Set(players.map(slot=>Number(slot.item?.id)).filter(id=>id>0));
        for(let start=0;start<ids.length;start+=12){
          const batch=ids.slice(start,start+12);
          for(let page=0;page<5;page++){
            const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=batch;criteria.count=100;criteria.offset=page*100;
            const found=await observe(services.Club.search(criteria),false,'team-apply-club');
            const rows=found.response?.items;
            if(!Array.isArray(rows))throw Error('EA club results changed. No squad changes were made.');
            for(const item of rows){
              const id=Number(item.id),definitionId=Number(item.definitionId);
              if(!Number.isSafeInteger(id)||id<1||item.concept||occupied.has(id)||!batch.includes(definitionId)||item.isValid?.()===false)continue;
              if(!groups.some(group=>group.options?.some(option=>Number(option.definitionId)===definitionId&&Number(option.rating)===Number(item.rating))))continue;
              if(!ownedForApply.has(definitionId))ownedForApply.set(definitionId,item);
            }
            if(found.response?.retrievedAll===true||rows.length<criteria.count)break;
            if(page===4)throw Error('EA club search was incomplete. No squad changes were made.');
          }
        }
        for(const group of groups)for(const option of group.options||[]){
          if(option.owned&&!ownedForApply.has(Number(option.definitionId)))throw Error(`${option.name||'An owned card'} is no longer available in your club. Refresh Team before adding players. No squad changes were made.`);
        }
        // Evaluate and insert the actual owned instance, including its chemistry data.
        for(const [id,item] of ownedForApply)concepts.set(id,item);
      }
      if(new Set(groups.map(group=>group.slotIndex)).size!==groups.length)throw Error('Choose each squad position once.');
      const rejections={invalidCards:0,overBudget:0,duplicatePlayer:0,chemistryUnavailable:0,totalChemistry:0,newCardChemistry:0,retainedChemistry:0,belowTarget:0};
      const bySlot=groups.map(group=>{
        const slot=players.find(row=>row.index===group.slotIndex);
        if(!slot)throw Error('A selected squad slot changed. Refresh Team.');
        const positionIds={GK:0,RWB:2,RB:3,CB:5,LB:7,LWB:8,CDM:10,RM:12,CM:14,LM:16,CAM:18,CF:21,RW:23,ST:25,LW:27};
        const target=positionIds[String(slot.generalPositionName||'').toUpperCase()];
        const choices=(group.options||[]).map(option=>action==='teamApply'&&ownedForApply.has(Number(option.definitionId))?{...option,owned:true,ownedId:Number(ownedForApply.get(Number(option.definitionId)).id),price:0,priceVerified:true}:option).filter(option=>{
          const item=concepts.get(Number(option.definitionId));
          return item&&Number(item.rating)===Number(option.rating)&&(Number(item.assetId)===Number(option.assetId)||Number(item.definitionId)%0x1000000===Number(option.assetId))&&
            (Number(item.preferredPosition)===target||[item.basePossiblePositions,item.possiblePositions].some(positions=>Array.isArray(positions)&&positions.some(position=>Number(position)===target)))&&
            (option.owned===true||option.priceVerified===true&&Number.isSafeInteger(option.price)&&option.price>=150);
        }).map(option=>({option,item:concepts.get(Number(option.definitionId))}));
        rejections.invalidCards+=(group.options||[]).length-choices.length;
        // Keeping a selected player permits useful partial upgrades.
        if(group.allowRetained!==false&&!slot.item?.concept&&Number(slot.item?.definitionId)>0)choices.push({item:slot.item,option:{definitionId:Number(slot.item.definitionId),assetId:Number(slot.item.assetId||Number(slot.item.definitionId)%0x1000000),rating:Number(slot.item.rating),name:String(slot.item.name||slot.item.lastName||'Current player'),owned:true,price:0,priceVerified:true,retained:true}});
        return {slot,choices};
      });
      bySlot.sort((a,b)=>a.choices.length-b.choices.length||a.slot.index-b.slot.index);
      if(bySlot.some(group=>!group.choices.length))return {ok:true,plan:null,rejections,reason:'No exact card with a checked price is available for every selected position.'};
      const fixedAssets=new Set(players.filter(row=>!bySlot.some(group=>group.slot.index===row.index)).map(row=>Number(row.item?.assetId||Number(row.item?.definitionId)%0x1000000)).filter(Boolean));
      const calculator=new UTSquadChemCalculatorUtils(services.Chemistry,repositories.TeamConfig),formation=team.getFormation(),manager=team.getManager()?.item;
      const baseline=calculator.calculate(formation,players.map(row=>row.item),manager);
      if(!Number.isFinite(baseline?.chemistry))throw Error('EA could not calculate the current chemistry.');
      let best=null,progress=null,chemistryFallback=null,checked=0;const alternatives=new Map();
      const fixed=players.filter(row=>!bySlot.some(group=>group.slot.index===row.index));
      const hasCard=item=>Number(item?.definitionId)>0;
      const completeXI=fixed.every(row=>hasCard(row.item));
      const allowChemistryTradeoff=payload.allowChemistryTradeoff===true;
      const minimumChemistry=allowChemistryTradeoff?0:Math.max(Number(baseline.chemistry),completeXI?30:0);
      const anchors=bySlot.filter(group=>group.choices.some(choice=>choice.option.locked)).map(group=>({index:group.slot.index,item:group.choices.find(choice=>choice.option.locked).item}));
      const anchorScore=(chem,cap=2)=>anchors.reduce((sum,anchor)=>sum+Math.min(cap,Number(chem.getSlotChemistry?.(anchor.index)?.points)||0),0);
      const linkSupport=chosen=>[...chosen.values()].reduce((sum,choice)=>sum+anchors.reduce((links,anchor)=>links+['leagueId','teamId','nationId'].filter(key=>Number(anchor.item[key])>0&&Number(anchor.item[key])===Number(choice.item[key])).length,0),0);
      const rankValue=option=>option.retained?0:.8*(option.source==='FUT.GG'?100/(1+(Number(option.metaRank)-1)/40):Number(option.futbinRating)||75)+.2*(Number(option.rating)||75);
      const required=new Set(payload.requiredUpgradeSlots||[]),support=new Set(payload.supportSlots||[]);
      if([...required,...support].some(index=>!bySlot.some(g=>g.slot.index===index))||[...required].some(index=>support.has(index)))throw Error('Invalid supporting-position plan.');
      const compare=(a,b)=>(a.supportChanges||0)-(b.supportChanges||0)||(b.coverage||0)-(a.coverage||0)||(b.anchorChemistry||0)-(a.anchorChemistry||0)||b.chemistry-a.chemistry||(b.anchorTotal||0)-(a.anchorTotal||0)||b.meta-a.meta||(b.fallbackMeta||0)-(a.fallbackMeta||0)||a.cost-b.cost;
      // Bounded beam search preserves whole-team alternatives instead of reducing
      // each position to the cheapest two plus one highly ranked card.
      const reserveByStep=Array(bySlot.length+1).fill(0);
      for(let index=bySlot.length-1;index>=0;index--)reserveByStep[index]=reserveByStep[index+1]+Math.min(...bySlot[index].choices.filter(value=>!value.option.retained).map(value=>value.option.owned?0:Number(value.option.price)));
      let beam=[{chosen:new Map(),used:new Set(fixedAssets),cost:0,meta:0,chemistry:Number(baseline.chemistry)}];
      for(let step=0;step<bySlot.length;step++){
        const {slot,choices}=bySlot[step],expanded=[];
        for(const branch of beam)for(const choice of choices){
          const asset=Number(choice.option.assetId),cost=branch.cost+(choice.option.owned?0:Number(choice.option.price));
          if(branch.used.has(asset)){rejections.duplicatePlayer++;continue;}
          if(cost>limit){rejections.overBudget++;continue;}
          const chosen=new Map(branch.chosen);chosen.set(slot.index,choice);
          const used=new Set(branch.used);used.add(asset);
          const lineup=players.map(row=>chosen.get(row.index)?.item||row.item);
          let chem;try{chem=calculator.calculate(formation,lineup,manager);}catch{rejections.chemistryUnavailable++;continue;}
          if(!Number.isFinite(chem?.chemistry)){rejections.chemistryUnavailable++;continue;}
          const meta=branch.meta+rankValue(choice.option);
          const fallbackMeta=[...chosen.values()].reduce((sum,value)=>sum+(!value.option.retained&&value.option.source!=='FUT.GG'?(Number(value.option.futbinRating)||75):0),0);
          const metaEvidence=[...chosen.values()].filter(value=>!value.option.retained&&value.option.source==='FUT.GG'&&Number.isInteger(value.option.metaRank)).length;
          const coverage=[...chosen.values()].filter(value=>!value.option.retained).length;
          const reserve=reserveByStep[step+1];
          const canComplete=coverage===chosen.size&&cost+reserve<=limit;
          const supportChanges=[...chosen].filter(([index,value])=>support.has(index)&&!value.option.retained).length;
          if(Number.isInteger(payload.maxSupportChanges)&&supportChanges>payload.maxSupportChanges)continue;
          const candidate={supportChanges,chosen,used,cost,meta,anchorChemistry:anchorScore(chem),anchorTotal:anchorScore(chem,3),linkSupport:linkSupport(chosen),fallbackMeta,metaEvidence,coverage,canComplete,chemistry:Number(chem.chemistry)};
          if(step===bySlot.length-1){
            checked++;
            if([...required].some(index=>!chosen.has(index)||chosen.get(index).option.retained))continue;
            // An explicit build-around choice may require chemistry trade-offs.
            // Keep the best complete alternative, without relaxing identity or cost.
            if(action==='teamPlan'&&payload.allowChemistryFallback===true&&completeXI&&(required.size?coverage>0:coverage===bySlot.length)){
              const slotChemistry=Object.fromEntries(players.map(row=>[row.index,Number(chem.getSlotChemistry?.(row.index)?.points)]));
              if(Object.values(slotChemistry).every(points=>Number.isFinite(points)&&points>=0&&points<=3)){
                const fallback={supportChanges,anchorChemistry:anchorScore(chem),anchorTotal:anchorScore(chem,3),meta,fallbackMeta,metaEvidence,score:meta,cost,coverage,selectedCount:bySlot.length,unfilledSlots:bySlot.filter(group=>chosen.get(group.slot.index)?.option.retained).map(group=>group.slot.index),chemistry:candidate.chemistry,slotChemistry,chemistryTradeoff:true,targetChemistry:minimumChemistry,baselineChemistry:Number(baseline.chemistry),choices:[...chosen].filter(([,value])=>!value.option.retained).map(([slotIndex,value])=>({...value.option,slotIndex,slotChemistry:slotChemistry[slotIndex]})).sort((a,b)=>a.slotIndex-b.slotIndex)};
                if(!chemistryFallback||((chemistryFallback.anchorChemistry-fallback.anchorChemistry)||(chemistryFallback.chemistry-fallback.chemistry)||compare(fallback,chemistryFallback))<0)chemistryFallback=fallback;
              }
            }
            if(!allowChemistryTradeoff&&candidate.chemistry<Number(baseline.chemistry)){rejections.totalChemistry++;continue;}
            if(![...chosen.values()].some(value=>!value.option.retained))continue;
            const points=index=>Number(chem.getSlotChemistry?.(index)?.points);
            if([...chosen].some(([index,value])=>!Number.isFinite(points(index))||points(index)<(allowChemistryTradeoff?0:value.option.retained?Number(baseline.getSlotChemistry?.(index)?.points)||0:2))){rejections.newCardChemistry++;continue;}
            if(fixed.some(row=>hasCard(row.item)&&(!Number.isFinite(points(row.index))||points(row.index)<(allowChemistryTradeoff?0:Number(baseline.getSlotChemistry?.(row.index)?.points)||0)))){rejections.retainedChemistry++;continue;}
            const meetsTarget=candidate.chemistry>=minimumChemistry;
            if(!meetsTarget)rejections.belowTarget++;
            const prior=meetsTarget?best:progress;
            if(meetsTarget||candidate.chemistry>Number(baseline.chemistry)){
              const found={supportChanges,anchorChemistry:anchorScore(chem),anchorTotal:anchorScore(chem,3),meta,fallbackMeta,metaEvidence,score:meta,cost,coverage,selectedCount:bySlot.length,unfilledSlots:bySlot.filter(group=>chosen.get(group.slot.index)?.option.retained).map(group=>group.slot.index),chemistry:candidate.chemistry,slotChemistry:Object.fromEntries(players.map(row=>[row.index,points(row.index)||0])),choices:[...chosen].filter(([,value])=>!value.option.retained).map(([slotIndex,value])=>({...value.option,slotIndex,slotChemistry:points(slotIndex)})).sort((a,b)=>a.slotIndex-b.slotIndex)};
              if(!prior||compare(candidate,prior)<0){if(meetsTarget)best=found;else progress=found;}
              if(meetsTarget&&Number.isInteger(payload.alternativesForSlot)){
                const id=chosen.get(payload.alternativesForSlot)?.option.definitionId;
                if(id&&(!alternatives.has(id)||compare(found,alternatives.get(id))<0))alternatives.set(id,found);
              }
            }
          }else expanded.push(candidate);
        }
        expanded.sort((a,b)=>Number(b.canComplete)-Number(a.canComplete)||compare(a,b));
        // Keep affordable branches alive for positions still to fill.
        const affordable=[...expanded].sort((a,b)=>(b.coverage||0)-(a.coverage||0)||a.cost-b.cost||compare(a,b));
        // Keep chemistry-link families alive, even before their second/third link arrives.
        const families=new Map();
        for(const branch of affordable){
          const item=branch.chosen.get(slot.index)?.item;
          const key=[item?.leagueId,item?.teamId,(item?.nationId??item?.nationalityId)].join(':');
          const rows=families.get(key)||[];if(rows.length<8){rows.push(branch);families.set(key,rows);}
        }
        beam=[...new Set([...expanded.slice(0,192),...affordable.slice(0,192),...[...expanded].sort((a,b)=>b.linkSupport-a.linkSupport||compare(a,b)).slice(0,128),...[...families.values()].flat().slice(0,128)])];
        if(step<bySlot.length-1&&!beam.length)break;
      }
      if(chemistryFallback&&(!best||(!required.size&&best.choices.length<bySlot.length)))best=chemistryFallback;
      if(action==='teamApply'){
        if(!best||best.choices.length!==groups.length||best.chemistry<Number(payload.minimumChemistry))throw Error('The recommended team no longer passes the chemistry checks. No squad changes were made.');
        if(typeof team.addItemToSlot!=='function'||typeof team.save!=='function')throw Error('EA squad editing is unavailable.');
        if(activeTeam().team!==team||teamFingerprint(activeTeam().players)!==payload.fingerprint)throw Error('Your squad changed while loading concepts. No squad changes were made.');
        const previous=players.map(slot=>({index:slot.index,item:slot.item}));
        let saving=false;
        try{
          for(const choice of best.choices)team.addItemToSlot(choice.slotIndex,concepts.get(Number(choice.definitionId)));
          const after=calculator.calculate(formation,players.map(slot=>slot.item),manager);
          if(after.chemistry!==best.chemistry)throw Error('The inserted squad chemistry did not match the preview.');
          saving=true;await observe(team.save());
        }catch(error){
          for(const slot of previous)team.addItemToSlot(slot.index,slot.item);
          if(saving)error.stage='team-apply-save';
          error.message+=saving?' The local squad was restored; reopen your squad in EA to check whether the save succeeded.':' The local squad was restored.';
          throw error;
        }
        return {ok:true,applied:best.choices.length,owned:best.choices.filter(choice=>choice.owned).length,chemistry:best.chemistry,plan:{...best,remaining:limit-best.cost}};
      }
      return {ok:true,rejections,alternatives:[...alternatives.values()].sort(compare).slice(0,30).map(plan=>({...plan,remaining:limit-plan.cost})),progressPlan:!best&&progress?{...progress,remaining:limit-progress.cost,baselineChemistry:Number(baseline.chemistry),targetChemistry:minimumChemistry}:null,plan:best?{...best,remaining:limit-best.cost,baselineChemistry:Number(baseline.chemistry)}:null,reason:best?null:`No checked team meets ${minimumChemistry} chemistry, at least two chemistry for new cards, and your budget without reducing retained players’ chemistry. Try a larger budget or include existing players among the positions to replace.`,combinationsChecked:checked};
    }
    if(action==='tradeInventory'){
      if(typeof services.Item.requestTransferItems!=='function')return {ok:true,updates:[],unavailable:true};
      const result=await observe(services.Item.requestTransferItems());
      const rows=watchedItems(result);
      if(!rows)throw Error('EA did not return the Transfer List.');
      const records=Array.isArray(payload.records)?payload.records:[];
      const byItem=new Map(rows.map(item=>[String(item.id),item]));
      const updates=records.map(record=>{
        const item=byItem.get(String(record.itemId)),data=auction(item);
        if(!item||Number(item.definitionId)!==record.definitionId)return {itemId:record.itemId,definitionId:record.definitionId,phase:'unverified'};
        const sold=data?.isSold?.()===true;
        const sale=Number(data?.currentBid);
        return {itemId:record.itemId,definitionId:record.definitionId,phase:sold&&Number.isSafeInteger(sale)&&sale>=150?'sold':data?.isExpired?.()?'expired':data?.isSelling?.()?'selling':'unverified',sale:sold?sale:null};
      });
      return {ok:true,updates};
    }
    if(action==='tradeStatus') {
      const balance=coinBalance();
      if(!Number.isSafeInteger(balance)||balance<0) throw Error('EA did not provide a coin balance.');
      if(typeof services.Item?.searchTransferMarket!=='function'||typeof services.Item?.clearTransferMarketCache!=='function'||typeof services.Item?.target!=='function'||typeof services.Item?.requestWatchedItems!=='function'||typeof services.Item?.bid!=='function'||typeof services.Item?.list!=='function') throw Error('Trading is unavailable in this EA client version.');
      return {ok:true,balance};
    }
    if(action==='tradeDiagnose') {
      const balance=coinBalance();
      if(!Number.isSafeInteger(balance)||balance<150) throw Error('A valid coin balance is needed to check market searches.');
      const watched=await observe(services.Item.requestWatchedItems(),true);
      if(!watched.success)return {ok:true,stage:'targets',status:watched.status??null};
      if(!watchedItems(watched))return {ok:true,stage:'targets-data',status:watched.status??null};
      const targetId=Number(payload.assetId);
      if(Number.isSafeInteger(targetId)&&targetId>0){
        const criteria=marketCriteria(targetId);
        const rows=[];
        let pages=0;
        for(let page=1;page<=AUCTION_PAGES_PER_PASS;page++){
          const result=await searchMarket(criteria,true,page);
          if(!result.success)return {ok:true,stage:page===1?'target':`target-page${page}`,status:result.status??null,assetId:targetId,...(page>1?{exactCount:rows.length}:{})};
          const pageRows=marketRows(result);
          rows.push(...pageRows);
          pages++;
          if(result.data.items.length<20)break;
        }
        return {ok:true,stage:'target-complete',assetId:targetId,exactCount:rows.length,sameCount:rows.filter(row=>Number(row.assetId)===targetId||Number(row.definitionId)%0x1000000===targetId).length,pages};
      }
      const broad=await searchMarket(marketCriteria(null,balance),true);
      if(!broad.success) return {ok:true,stage:'broad',status:broad.status??null};
      const rows=marketRows(broad);
      if(!rows.length) return {ok:true,stage:'empty',broadCount:0};
      const definitionId=Number(rows[0].definitionId);
      const exact=await searchMarket(marketCriteria(definitionId),true);
      if(!exact.success) return {ok:true,stage:'exact',status:exact.status??null,broadCount:rows.length};
      const exactRows=marketRows(exact);
      return {ok:true,stage:'complete',broadCount:rows.length,exactCount:exactRows.length,sameCount:exactRows.filter(row=>Number(row.definitionId)===definitionId).length};
    }
    if(action==='tradeReview') {
      const tradeId=String(payload.tradeId||'');
      const minimumBid=Number(payload.lastBid);
      if(!/^\d+$/.test(tradeId)||!Number.isSafeInteger(minimumBid)||minimumBid<150)throw Error('FutSBC has no exact auction to review. Check Transfer Targets and New Items in EA.');
      const result=await observe(services.Item.requestWatchedItems(),true);
      if(!result.success)return {ok:true,phase:'unavailable',reason:'request-rejected',status:result.status??null,balance:coinBalance()};
      const rows=watchedItems(result);
      if(!rows)return {ok:true,phase:'unavailable',reason:'items-missing',status:result.status??null,balance:coinBalance()};
      const item=rows.find(row=>String(auction(row)?.tradeId)===tradeId);
      return {ok:true,phase:item?bidState(item,minimumBid):'not-found',tradeId,bid:item?Number(auction(item)?.currentBid)||null:null,balance:coinBalance()};
    }
    if(action==='tradeScan') {
      const maxBuy=Number(payload.maxBuy);
      if(!Number.isSafeInteger(maxBuy)||maxBuy<150) throw Error('Invalid scan limit.');
      const result=await searchMarket(marketCriteria(null,maxBuy));
      const broad=marketRows(result);
      const cheapestByCard=new Map();
      for(const item of broad) {
        const definitionId=Number(item.definitionId),price=Number(auction(item).buyNowPrice);
        if(price>maxBuy) continue;
        const previous=cheapestByCard.get(definitionId);
        if(!previous||price<Number(auction(previous).buyNowPrice)) cheapestByCard.set(definitionId,item);
      }
      const found=[];
      const candidates=[...cheapestByCard.values()].slice(0,2);
      for(const item of candidates) {
        const definitionId=Number(item.definitionId),price=Number(auction(item).buyNowPrice);
        const exact=await searchMarket(marketCriteria(definitionId));
        const same=marketRows(exact).filter(row=>Number(row.definitionId)===definitionId);
        const comparablePrices=same.filter(row=>String(auction(row).tradeId)!==String(auction(item).tradeId)).map(row=>Number(auction(row).buyNowPrice));
        if(comparablePrices.length>=5) found.push({definitionId,tradeId:String(auction(item).tradeId),buy:price,name:String(item.name||item.commonName||item.lastName||`Card ${definitionId}`),rating:Number(item.rating)||0,comparables:comparablePrices});
      }
      return {ok:true,balance:coinBalance(),listings:found,checked:candidates.length,marketCount:broad.length};
    }
    if(action==='tradeBidScan') {
      const balance=coinBalance();
      if(!Number.isSafeInteger(balance)||balance<150) throw Error('Not enough coins to place a bid.');
      if(typeof UTCurrencyInputControl==='undefined'||typeof UTCurrencyInputControl.getIncrementAboveVal!=='function') throw Error('EA bid increment API changed. Trading stopped.');
      const listings=[];
      let marketCount=0,checked=0;
      const cards=Array.isArray(payload.cards)?payload.cards.slice(0,2):[];
      if(!cards.length)throw Error('Fresh FUTBIN card evidence is required before scanning EA auctions.');
      for(const card of cards){
        if(!Number.isSafeInteger(card.assetId)||card.assetId<1||!Number.isSafeInteger(card.consolePrice)||card.consolePrice<500||card.consolePrice>balance||!Number.isSafeInteger(card.checkedAt)||Date.now()-card.checkedAt>60_000||!/^https:\/\/www\.futbin\.com\/27\/player\/\d+\//.test(card.url||''))continue;
        checked++;
        let result;
        try{result=await searchMarket(marketCriteria(card.assetId));}
        catch(error){error.message=`Exact-card auction search for ${card.name||card.assetId} failed: ${error.message}`;throw error;}
        if(!Array.isArray(result.data?.items))throw Error('EA market results changed. Trading stopped.');
        const auctions=result.data.items.filter(item=>{
          const data=auction(item);
          const base=Number(item.assetId)||Number(item.definitionId)%0x1000000;
          return item?.isPlayer?.()&&base===card.assetId&&Number(item.rareflag??0)<=1&&/^\d+$/.test(String(data?.tradeId))&&data?.getSecondsRemaining?.()>30&&data.getSecondsRemaining()<900;
        });
        marketCount+=auctions.length;
        const candidates=auctions.map(item=>{
          const data=auction(item),bid=data.currentBid>0?UTCurrencyInputControl.getIncrementAboveVal(data.currentBid):data.startingBid;
          return {item,bid};
        }).filter(({item,bid})=>Number.isSafeInteger(bid)&&bid>=150&&bid<=balance&&bid<card.consolePrice*.9&&(!auction(item).buyNowPrice||bid<auction(item).buyNowPrice)&&auction(item).canBid?.(bid,balance));
        candidates.sort((a,b)=>a.bid-b.bid||a.item.getAuctionData().getSecondsRemaining()-b.item.getAuctionData().getSecondsRemaining());
        if(!candidates.length)continue;
        const {item,bid}=candidates[0];
        const data=auction(item);
        const comparables=marketRows(result).filter(row=>Number(row.definitionId)===Number(item.definitionId)&&String(auction(row).tradeId)!==String(data.tradeId)).map(row=>Number(auction(row).buyNowPrice));
        if(comparables.length>=5)listings.push({definitionId:Number(item.definitionId),tradeId:String(data.tradeId),name:String(item.name||item.commonName||item.lastName||card.name||`Card ${item.definitionId}`),rating:Number(item.rating)||0,buy:bid,comparables,seconds:data.getSecondsRemaining(),futbinPrice:card.consolePrice,futbinURL:card.url});
      }
      return {ok:true,balance:coinBalance(),listings,checked,marketCount};
    }
    if(action==='tradeAuctionHunt') {
      const balance=coinBalance();
      if(!Number.isSafeInteger(balance)||balance<150)throw Error('EA did not provide enough available coins to bid.');
      if(typeof UTCurrencyInputControl==='undefined'||typeof UTCurrencyInputControl.getIncrementAboveVal!=='function'||typeof services.Item?.requestWatchedItems!=='function'||typeof services.Item?.target!=='function')throw Error('EA auction tools changed. Trading stopped.');
      const cards=Array.isArray(payload.cards)?payload.cards.slice(0,1):[];
      const card=cards[0];
      if(!card||!Number.isSafeInteger(card.assetId)||card.assetId<1||!Number.isSafeInteger(card.consolePrice)||card.consolePrice<500||!Number.isSafeInteger(card.checkedAt)||Date.now()-card.checkedAt>60_000||!/^https:\/\/www\.futbin\.com\/27\/player\/\d+\//.test(card.url||''))throw Error('Fresh FUTBIN price evidence is required before bidding.');
      let watched;
      try{watched=await observe(services.Item.requestWatchedItems());}
      catch(error){error.stage='targets-read';throw error;}
      const watchedRows=watchedItems(watched);
      if(!Array.isArray(watchedRows)){const error=Error('EA did not return Transfer Targets. No bids were placed.');error.stage='targets-read';throw error;}
      const known=new Set(watchedRows.map(item=>String(auction(item)?.tradeId)));
      for(const tradeId of payload.existingTradeIds||[])known.add(String(tradeId));
      const capacity=Math.max(0,50-watchedRows.length);
      if(!capacity)return {ok:true,balance,bids:[],checked:1,pages:0,auctions:0,candidates:0,full:true};
      let uncommitted=Math.max(0,balance-watchedRows.filter(item=>auction(item)?.isHighestBid?.()).reduce((sum,item)=>sum+(Number(auction(item)?.currentBid)||0),0));
      const criteria=marketCriteria(card.assetId),all=new Map();
      const startPage=Number.isSafeInteger(payload.startPage)&&payload.startPage>=1&&payload.startPage<=10?payload.startPage:1;
      let pages=0,nextPage=startPage;
      for(let page=startPage;page<startPage+AUCTION_PAGES_PER_PASS&&page<=10;page++){
        let result;
        try{result=await searchMarket(criteria,false,page);}
        catch(error){error.stage='market-search';error.page=page;throw error;}
        if(!Array.isArray(result.data?.items))throw Error('EA market results changed. No more bids were placed.');
        let added=0;
        for(const item of result.data.items){
          const id=String(auction(item)?.tradeId||'');
          if(/^\d+$/.test(id)&&!all.has(id)){all.set(id,item);added++;}
        }
        pages++;
        nextPage=page>=10?1:page+1;
        if(result.data.items.length<20||!added){nextPage=1;break;}
      }
      const rows=[...all.values()],candidates=[],rejections={ineligible:0,watched:0,time:0,bid:0,price:0};
      for(const item of rows){
        const data=auction(item),base=Number(item.assetId)||Number(item.definitionId)%0x1000000;
        const seconds=Number(data?.getSecondsRemaining?.());
        const bid=Number(data?.currentBid)>0?UTCurrencyInputControl.getIncrementAboveVal(Number(data.currentBid)):Number(data?.startingBid);
        if(!item?.isPlayer?.()||base!==card.assetId||Number(item.rareflag??0)>1){rejections.ineligible++;continue;}
        if(known.has(String(data?.tradeId))){rejections.watched++;continue;}
        if(!Number.isFinite(seconds)||seconds<8||seconds>180){rejections.time++;continue;}
        if(!Number.isSafeInteger(bid)||bid<150||bid>balance||bid>=card.consolePrice*.9||Number.isSafeInteger(card.researchBidCeiling)&&bid>card.researchBidCeiling||data?.buyNowPrice>0&&bid>=data.buyNowPrice||!data?.canBid?.(bid,balance)){rejections.bid++;continue;}
        const offer=quote(rows,Number(item.definitionId),data.tradeId,card.consolePrice,bid,card.marginStrategy);
        if(offer){
          const minutes=Number.isFinite(card.expectedSellMinutes)?Math.max(1,card.expectedSellMinutes):60;
          const efficiency=offer.profit/bid/minutes;
          candidates.push({item,bid,seconds,offer,efficiency});
        }else rejections.price++;
      }
      candidates.sort((a,b)=>b.efficiency-a.efficiency||a.seconds-b.seconds||b.offer.profit-a.offer.profit);
      const bids=[];
      let uncertain=null;
      for(const candidate of candidates){
        if(bids.length>=capacity)break;
        const {item,bid,seconds,offer}=candidate,data=auction(item),available=Math.min(coinBalance(),uncommitted);
        if(!Number.isSafeInteger(available)||bid>available||!data?.canBid?.(bid,available))continue;
        const order={name:String(item.name||item.commonName||item.lastName||card.name||`Card ${item.definitionId}`),definitionId:Number(item.definitionId),tradeId:String(data.tradeId),sell:offer.sell,quoteValidUntil:offer.quoteValidUntil,comparables:offer.comparables,reference:offer.reference,futbinPrice:card.consolePrice,futbinURL:card.url,quoteAt:Date.now(),lastBid:bid,seconds,misses:0,marginStrategy:card.marginStrategy,researchAt:card.checkedAt,researchBidCeiling:card.researchBidCeiling,bidCeiling:Math.min(Number.isSafeInteger(card.researchBidCeiling)?card.researchBidCeiling:Infinity,Math.floor(offer.sell*.95)-offer.minimumProfit)};
        try{await observe(services.Item.target(item));known.add(order.tradeId);}
        catch(error){if([401,429].includes(Number(error.status)))return {ok:true,balance:coinBalance(),bids,checked:1,pages,auctions:rows.length,candidates:candidates.length,rejections,nextPage,halt:{status:Number(error.status),error:error.message}};continue;}
        const balanceBeforeBid=coinBalance();
        try{await observe(services.Item.bid(item,bid));bids.push(order);uncommitted-=bid;}
        catch(error){
          let reconciliation='unavailable';
          try{
            const checked=await observe(services.Item.requestWatchedItems(),true);
            if(checked.success&&watchedItems(checked)){
              const matching=watchedItems(checked).find(row=>String(auction(row)?.tradeId)===order.tradeId);
              reconciliation=matching?bidState(matching,bid):'not-found';
              if(reconciliation==='highest'||reconciliation==='won'){
                bids.push(order);
                uncommitted-=bid;
                continue;
              }
            }
          }catch{}
          uncertain={...order,error:error.message,status:error.status??null,reconciliation,balanceBeforeBid,balanceAfterBid:coinBalance()};
          break;
        }
      }
      return {ok:true,balance:coinBalance(),bids,checked:1,pages,auctions:rows.length,candidates:candidates.length,rejections,nextPage,uncertain};
    }
    if(action==='tradeWatchBatch') {
      const orders=Array.isArray(payload.orders)?payload.orders.slice(0,50):[];
      if(!orders.length)return {ok:true,balance:coinBalance(),updates:[]};
      let response;
      try{response=await observe(services.Item.requestWatchedItems());}
      catch(error){error.stage='targets-watch';throw error;}
      const rows=watchedItems(response);
      if(!rows){const error=Error('EA did not return Transfer Targets.');error.stage='targets-watch';throw error;}
      const byTrade=new Map(rows.map(item=>[String(auction(item)?.tradeId),item]));
      const fresh=new Map(),updates=[];
      for(const order of orders){
        if(!/^\d+$/.test(String(order.tradeId))||!Number.isSafeInteger(order.definitionId))continue;
        const item=byTrade.get(String(order.tradeId));
        if(!item){
          const misses=(Number(order.misses)||0)+1;
          updates.push({tradeId:order.tradeId,phase:misses>=3?'missing-watch':'pending',misses});
          continue;
        }
        if(Number(item.definitionId)!==order.definitionId){updates.push({tradeId:order.tradeId,phase:'error',warning:`The exact card for ${order.name} changed. No bid or listing was attempted.`});continue;}
        const data=auction(item),seconds=Number(data?.getSecondsRemaining?.()),paid=Number(data?.currentBid)||Number(order.lastBid);
        if(data?.isWon?.()){
          if(!Number.isSafeInteger(paid)||paid<150){updates.push({tradeId:order.tradeId,phase:'won-unlisted',warning:`Won ${order.name}, but the paid price could not be verified. Check New Items.`});continue;}
          try{
            let result=fresh.get(order.definitionId);
            if(!result){result=await searchMarket(marketCriteria(order.definitionId));fresh.set(order.definitionId,result);}
            const offer=quote(result.data?.items||[],order.definitionId,order.tradeId,order.futbinPrice,paid,order.marginStrategy);
            if(!offer){updates.push({tradeId:order.tradeId,phase:'won-unlisted',paid,warning:`Won ${order.name}, but no current profitable sale price was verified. Check New Items.`});continue;}
            if(!item.hasPriceLimits?.()&&typeof services.Item.requestMarketData==='function')await observe(services.Item.requestMarketData(item));
            await observe(services.Item.list(item,previousPrice(offer.sell),offer.sell,3600));
            updates.push({tradeId:order.tradeId,phase:'listed',paid,sell:offer.sell,itemId:String(item.id||''),definitionId:order.definitionId});
          }catch(error){updates.push({tradeId:order.tradeId,phase:'won-unlisted',paid,warning:`Won ${order.name}, but listing failed: ${error.message} Check New Items.`});}
          continue;
        }
        if(data?.isClosedTrade?.()||data?.isExpired?.()){updates.push({tradeId:order.tradeId,phase:'lost'});continue;}
        if(data?.isHighestBid?.()){updates.push({tradeId:order.tradeId,phase:'highest',bid:paid,seconds,misses:0});continue;}
        if(!Number.isFinite(seconds)||seconds<=0){updates.push({tradeId:order.tradeId,phase:'pending',misses:0});continue;}
        if(Number(data?.currentBid)<=Number(order.lastBid)){updates.push({tradeId:order.tradeId,phase:'pending',misses:0});continue;}
        if(Number.isSafeInteger(order.researchAt)&&Date.now()-order.researchAt>5*60_000){updates.push({tradeId:order.tradeId,phase:'outbid-cap',reason:'Research expired; no further bids.'});continue;}
        const nextBid=Number(data?.currentBid)>0?UTCurrencyInputControl.getIncrementAboveVal(Number(data.currentBid)):Number(data?.startingBid);
        const availableBeforeQuote=coinBalance();
        if(!Number.isSafeInteger(nextBid)||nextBid<150||nextBid>availableBeforeQuote||data?.buyNowPrice>0&&nextBid>=data.buyNowPrice||Number.isSafeInteger(order.bidCeiling)&&nextBid>order.bidCeiling||Number.isSafeInteger(order.researchBidCeiling)&&nextBid>order.researchBidCeiling||!data?.canBid?.(nextBid,availableBeforeQuote)){
          updates.push({tradeId:order.tradeId,phase:'outbid-cap'});continue;
        }
        let result=fresh.get(order.definitionId);
        try{
          const cached=!result&&Number.isSafeInteger(order.quoteAt)&&Date.now()>=order.quoteAt&&Date.now()-order.quoteAt<=30_000&&Number.isFinite(order.quoteValidUntil)&&Date.now()<order.quoteValidUntil&&Array.isArray(order.comparables)&&order.comparables.length>=5;
          if(!result&&!cached){result=await searchMarket(marketCriteria(order.definitionId));fresh.set(order.definitionId,result);}
          const offer=cached?quotePrices(order.comparables,order.futbinPrice,nextBid,order.marginStrategy):quote(result.data?.items||[],order.definitionId,order.tradeId,order.futbinPrice,nextBid,order.marginStrategy);
          const available=coinBalance();
          if(!offer||!Number.isSafeInteger(nextBid)||nextBid<150||nextBid>available||Number.isSafeInteger(order.bidCeiling)&&nextBid>order.bidCeiling||Number.isSafeInteger(order.researchBidCeiling)&&nextBid>order.researchBidCeiling||!data?.canBid?.(nextBid,available))updates.push({tradeId:order.tradeId,phase:'outbid-cap'});
          else{await observe(services.Item.bid(item,nextBid));updates.push({tradeId:order.tradeId,phase:'bid',bid:nextBid,sell:offer.sell,reference:offer.reference,quoteValidUntil:cached?order.quoteValidUntil:offer.quoteValidUntil,comparables:offer.comparables,seconds,quoteAt:cached?order.quoteAt:Date.now(),misses:0});}
        }catch(error){updates.push({tradeId:order.tradeId,phase:'error',warning:`Could not verify the next bid on ${order.name}: ${error.message}`});}
      }
      return {ok:true,balance:coinBalance(),updates,watched:rows.length};
    }
    if(action==='tradeBidStep') {
      const {definitionId,tradeId,sell,comparables,futbinPrice,quoteAt,existing}=payload;
      if(!Number.isSafeInteger(definitionId)||definitionId<1||!/^\d+$/.test(String(tradeId))||!Number.isSafeInteger(sell)||sell<200||!Number.isSafeInteger(futbinPrice)||futbinPrice<sell||!Array.isArray(comparables)||comparables.length<5||!Number.isSafeInteger(quoteAt))throw Error('Invalid bid order.');
      const response=existing?await observe(services.Item.requestWatchedItems()):await searchMarket(marketCriteria(definitionId));
      const rows=existing?watchedItems(response):response.data?.items;
      if(!Array.isArray(rows))throw Error('EA auction status changed. Trading stopped.');
      let item=rows.find(row=>Number(row.definitionId)===definitionId&&String(auction(row)?.tradeId)===String(tradeId));
      if(!item)return {ok:true,phase:existing?'missing-watch':'missing-new'};
      const data=auction(item),balance=coinBalance();
      if(data.isWon?.()){
        const paid=Number(data.currentBid)||Number(payload.lastBid);
        if(!Number.isSafeInteger(paid)||paid<150)return {ok:true,phase:'won-unlisted',warning:'Won auction price could not be verified. Check Transfer Targets.'};
        try{
          if(!item.hasPriceLimits?.()&&typeof services.Item.requestMarketData==='function')await observe(services.Item.requestMarketData(item));
          const startingBid=previousPrice(sell);
          await observe(services.Item.list(item,startingBid,sell,3600));
          return {ok:true,phase:'listed',paid,sell,balance:coinBalance()};
        }catch(error){return {ok:true,phase:'won-unlisted',paid,warning:`Won the auction, but listing failed: ${error.message} Check New Items and Transfer Targets.`};}
      }
      if(data.isClosedTrade?.()||data.isExpired?.())return {ok:true,phase:'lost'};
      const seconds=data.getSecondsRemaining?.();
      if(data.isHighestBid?.())return {ok:true,phase:'highest',seconds,bid:Number(data.currentBid)||Number(payload.lastBid)};
      if(!Number.isFinite(seconds)||seconds<=0)return {ok:true,phase:'lost'};
      if(Date.now()-quoteAt>5*60_000)return {ok:true,phase:'quote-stale'};
      if(!Number.isSafeInteger(balance)||balance<150||typeof UTCurrencyInputControl==='undefined'||typeof UTCurrencyInputControl.getIncrementAboveVal!=='function')throw Error('EA cannot validate the next bid. Trading stopped.');
      const bid=data.currentBid>0?UTCurrencyInputControl.getIncrementAboveVal(data.currentBid):data.startingBid;
      const prices=comparables.filter(price=>Number.isSafeInteger(price)&&price>0).sort((a,b)=>a-b);
      const reference=prices[0];
      let checkedSell=Math.min(previousPrice(reference),floorPrice(futbinPrice));
      if(!existing){
        const currentPrices=rows.filter(row=>Number(row.definitionId)===definitionId&&String(auction(row)?.tradeId)!==String(tradeId)).map(row=>Number(auction(row)?.buyNowPrice)).filter(price=>Number.isSafeInteger(price)&&price>0).sort((a,b)=>a-b);
        if(currentPrices.length<5)return {ok:true,phase:'outbid-cap',warning:'EA no longer has five comparable listings.'};
        const freshReference=currentPrices[0];
        checkedSell=Math.min(checkedSell,previousPrice(freshReference));
      }
      const profit=Math.floor(sell*.95)-bid;
      const minimumProfit=Math.max(200,Math.ceil(bid*.08/50)*50);
      if(checkedSell<sell||!Number.isSafeInteger(bid)||bid<150||bid>balance||data.buyNowPrice>0&&bid>=data.buyNowPrice||profit<minimumProfit||!data.canBid?.(bid,balance))return {ok:true,phase:'outbid-cap',bid,profit};
      await observe(services.Item.bid(item,bid));
      return {ok:true,phase:'bid',bid,seconds,balance:coinBalance()};
    }
    if(['galleryIdentity','galleryOwnership','galleryBuyOne'].includes(action)){
      const persona=services.User.getUser().getSelectedPersona();
      if(!Number.isSafeInteger(Number(persona.id))||Number(persona.id)<1||typeof persona.sku!=='string'||!persona.sku)throw Error('EA could not identify your Gallery club.');
      const accountKey=`2027:${persona.id}:${persona.sku}`;
      const guard=()=>{
        const selected=services.User.getUser().getSelectedPersona();
        if(`2027:${selected.id}:${selected.sku}`!==accountKey||selected.getCurrentClub()!==club)throw Error('The selected EA club changed. Gallery collecting stopped.');
        if(payload.accountKey&&payload.accountKey!==accountKey)throw Error('This Gallery plan belongs to another EA club.');
      };
      guard();
      if(action==='galleryIdentity')return {ok:true,accountKey,balance:coinBalance()};
      const requested=action==='galleryOwnership'?payload.players:[payload.player];
      if(!Array.isArray(requested)||!requested.length||requested.length>100||requested.some(p=>!Number.isSafeInteger(p?.definitionId)||p.definitionId<1||!Number.isInteger(p.rating)||p.rating<1||p.rating>99||!Number.isInteger(p.rarity)||p.rarity<0))throw Error('Invalid Gallery card list.');
      const eligible=(item,player)=>Number(item?.definitionId)===player.definitionId&&Number(item.id)>0&&!item.concept&&Number(item.rating)===player.rating&&Number(item.rareflag)===player.rarity&&!(Number(item.loans)>=0)&&!item.isLimitedUse?.()&&!(Number(item.endTime)>0)&&!item.isEvolution?.();
      const owned=async()=>{
        const rows=[];let offset=0;
        for(let page=0;page<10;page++){
          guard();const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=requested.map(p=>p.definitionId);criteria.count=100;criteria.offset=offset;
          const result=await observe(services.Club.search(criteria),false,'gallery-club');guard();
          if(!Array.isArray(result.response?.items))throw Error('EA did not return Gallery club cards.');
          rows.push(...result.response.items);offset+=result.response.items.length;
          if(result.response.retrievedAll===true||result.response.retrievedAll===undefined&&result.response.items.length<criteria.count)return rows;
          if(!result.response.items.length)break;
        }
        throw Error('EA club results are incomplete. Gallery collecting stopped.');
      };
      const existing=await owned();
      if(action==='galleryOwnership')return {ok:true,accountKey,balance:coinBalance(),owned:requested.filter(p=>existing.some(item=>eligible(item,p))).map(p=>p.definitionId)};
      const player=payload.player,maxPrice=payload.maxPrice,remaining=payload.remaining;
      if(!Number.isSafeInteger(maxPrice)||maxPrice<150||!Number.isSafeInteger(remaining)||remaining<maxPrice)throw Error('Invalid Gallery spending limit.');
      if(existing.some(item=>eligible(item,player)))return {ok:true,phase:'owned',accountKey,definitionId:player.definitionId,balance:coinBalance()};
      if(typeof services.Item.bid!=='function'||typeof services.Item.move!=='function'||typeof ItemPile==='undefined')throw Error('EA Gallery buying is unavailable.');
      const balance=coinBalance();if(!Number.isSafeInteger(balance)||balance<maxPrice)return {ok:true,phase:'unavailable',reason:'The coin balance is below this card limit.',balance};
      const matches=[],criteria=marketCriteria(player.definitionId,Math.min(maxPrice,remaining,balance));
      for(let page=1;page<=2;page++){
        const result=await searchMarket(criteria,false,page,'gallery-market');guard();
        matches.push(...marketRows(result).filter(item=>eligible(item,player)&&auction(item)?.getSecondsRemaining?.()>0&&auction(item)?.canBuy?.(coinBalance())&&Number(auction(item)?.buyNowPrice)<=maxPrice));
        if(result.data.items.length<20)break;
      }
      matches.sort((a,b)=>Number(auction(a).buyNowPrice)-Number(auction(b).buyNowPrice));
      const item=matches[0];if(!item)return {ok:true,phase:'unavailable',reason:'No checked exact-card listing is within its price limit.',balance};
      const price=Number(auction(item).buyNowPrice),tradeId=String(auction(item).tradeId);
      guard();if(!Number.isSafeInteger(price)||price<150||price>remaining||price>coinBalance()||!auction(item).canBuy?.(coinBalance()))throw Error('The Gallery listing or balance changed.');
      let response;
      try{sbcPurchaseAttempted=true;response=await observe(services.Item.bid(item,price),false,'gallery-buy');}
      catch(error){return {ok:true,phase:'uncertain',price,tradeId,warning:`Purchase outcome unknown: ${error.message} Check EA New Items.`};}
      const won=[...(response.data?.items||[]),...(response.response?.items||[])].find(row=>eligible(row,player))||(auction(item)?.isWon?.()?item:null);
      if(!won||!(auction(item)?.isWon?.()||auction(won)?.isWon?.()||won.pile===ItemPile.PURCHASED))return {ok:true,phase:'uncertain',price,tradeId,warning:'EA has not confirmed the purchased Gallery card. Check New Items.'};
      try{
        guard();await observe(services.Item.move(won,ItemPile.CLUB),false,'gallery-move');guard();
        if(!(await owned()).some(row=>Number(row.id)===Number(won.id)&&eligible(row,player)))throw Error('The card is not yet visible in the club.');
        return {ok:true,phase:'in-club',definitionId:player.definitionId,price,tradeId,balance:coinBalance()};
      }catch(error){return {ok:true,phase:'purchased-unverified',price,tradeId,warning:`Card bought; club move unverified: ${error.message} Check New Items.`};}
    }
    if(action==='tradeExecute') {
      const {definitionId,tradeId,buy,sell,maxBuy}=payload;
      if(!Number.isSafeInteger(definitionId)||definitionId<1||!/^\d+$/.test(String(tradeId))||!Number.isSafeInteger(buy)||!Number.isSafeInteger(sell)||!Number.isSafeInteger(maxBuy)||buy<150||buy>maxBuy||sell<=buy) throw Error('Invalid trade order.');
      const balance=coinBalance();
      if(!Number.isSafeInteger(balance)||buy>balance) throw Error('Coin balance changed before purchase.');
      const exact=await searchMarket(marketCriteria(definitionId));
      const same=marketRows(exact).filter(row=>Number(row.definitionId)===definitionId);
      let item=same.find(row=>String(auction(row).tradeId)===String(tradeId));
      if(!item) {
        const priced=await searchMarket(marketCriteria(definitionId,buy));
        item=marketRows(priced).find(row=>Number(row.definitionId)===definitionId&&String(auction(row).tradeId)===String(tradeId));
      }
      if(!item||Number(auction(item).buyNowPrice)!==buy||auction(item).getSecondsRemaining?.()<=0||!auction(item).canBuy?.(balance)) throw Error('The listing changed or is no longer available.');
      const other=same.filter(row=>String(auction(row).tradeId)!==String(tradeId)).map(row=>Number(auction(row).buyNowPrice)).sort((a,b)=>a-b);
      if(other.length<5||other[3]<=sell||Math.floor(sell*0.95)-buy<Math.max(200,Math.ceil(buy*0.08/50)*50)) throw Error('Current comparable listings no longer support this trade.');
      if(typeof repositories!=='undefined'&&typeof ItemPile!=='undefined'&&typeof MAX_NEW_ITEMS!=='undefined'&&repositories.Item.numItemsInCache(ItemPile.PURCHASED)>=MAX_NEW_ITEMS) throw Error('New Items is full. Clear it before restarting.');
      if(typeof services.Item.requestTransferItems==='function'&&typeof repositories!=='undefined'&&typeof ItemPile!=='undefined') {
        const transfer=await observe(services.Item.requestTransferItems());
        const selling=transfer.response?.items?.filter(row=>auction(row)?.isSelling?.()).length;
        if(Number.isInteger(selling)&&selling>=repositories.Item.getPileSize(ItemPile.TRANSFER)) throw Error('Transfer List is full. Clear a slot before restarting.');
      }
      const purchased=await observe(services.Item.bid(item,buy));
      const won=(purchased.data?.items||[]).find(row=>Number(row.definitionId)===definitionId);
      if(!won||!(auction(item)?.isWon?.()||auction(won)?.isWon?.()||typeof ItemPile!=='undefined'&&won.pile===ItemPile.PURCHASED)) return {ok:true,purchased:false,listed:false,buy,sell,definitionId,warning:'EA accepted the bid, but a purchase could not be verified. Check New Items and Transfer Targets before restarting.'};
      try {
        if(!won.hasPriceLimits?.()&&typeof services.Item.requestMarketData==='function') await observe(services.Item.requestMarketData(won));
        const startingBid=previousPrice(sell);
        await observe(services.Item.list(won,startingBid,sell,3600));
        return {ok:true,purchased:true,listed:true,buy,sell,definitionId,balance:coinBalance()};
      } catch(error) {
        return {ok:true,purchased:true,listed:false,buy,sell,definitionId,warning:`Bought the card, but listing failed: ${error.message} Check New Items.`};
      }
    }
    if(action==='market') {
      if(!nav?.pushViewController || typeof UTMarketSearchResultsViewController==='undefined') throw Error('Open the Web App first.');
      const p=payload.player;
      if(!Number.isInteger(p?.definitionId)||p.definitionId<1) throw Error('Resolve the exact concept card before shopping.');
      const criteria=new UTSearchCriteriaDTO();
      criteria.type=SearchType.PLAYER; criteria.defId=[p.definitionId];
      services.Item.clearTransferMarketCache();
      const results=new UTMarketSearchResultsViewController(); results.initWithSearchCriteria(criteria);
      nav.pushViewController(results,true);
      return {ok:true};
    }
    const challenge=findChallenge();
    const squad=challenge.squad;
    const slots=squad.getNonBrickSlots().filter(s=>s.index<11);
    const snapshot=()=>({id:challenge.id,name:challenge.name,formation:squad.getFormation()?.displayName,slots:slots.map(s=>({index:s.index,position:s.generalPositionName,name:Number(s.item?.definitionId)>0?teamPlayerName(s.item):null,definitionId:Number(s.item?.definitionId)||0,rating:Number(s.item?.rating)||0,concept:!!s.item?.concept})),fingerprint:slots.map(s=>`${s.index}:${s.item?.id}:${s.item?.definitionId}:${!!s.item?.concept}`).join('|')});
    const matchesBaseCard=(item,baseId)=>{
      const definitionId=Number(item.definitionId);
      return Number.isSafeInteger(definitionId)&&definitionId>0&&(Number(item.assetId)===baseId||definitionId%0x1000000===baseId);
    };
    const positionIds={GK:0,RWB:2,RB:3,CB:5,LB:7,LWB:8,CDM:10,RM:12,CM:14,LM:16,CAM:18,CF:21,RW:23,ST:25,LW:27};
    const cardCoreMatches=(item,player,concept=true)=>!!item.concept===concept&&Number(item.rating)===player.rating&&Number(item.rareflag)===player.rarity&&matchesBaseCard(item,player.baseId);
    const cardIdentityMatches=(item,player,concept=true)=>{
      if(!cardCoreMatches(item,player,concept))return false;
      for(const [source,target] of [['clubId','teamId'],['leagueId','leagueId'],['nationId','nationId']]){
        if(Number.isSafeInteger(player[source])&&player[source]>0&&Number.isSafeInteger(Number(item[target]))&&Number(item[target])>0&&Number(item[target])!==player[source])return false;
      }
      if(Array.isArray(player.attributes)&&player.attributes.length===6&&Array.isArray(item.attributes)&&item.attributes.length===6&&item.attributes.every(Number.isInteger)&&item.attributes.some((value,index)=>value!==player.attributes[index]))return false;
      return true;
    };
    const resolvedCardMatches=(item,player,concept=true)=>cardIdentityMatches(item,player,concept)||Number(item.definitionId)===player.definitionId&&cardCoreMatches(item,player,concept);
    const conceptMatches=(rows,player)=>{
      const exact=rows.filter(item=>cardIdentityMatches(item,player));
      if(exact.length)return exact;
      // A transferred card can have stale club/league metadata on FUTBIN.
      // Only trust EA's base ID, rating and rarity when they identify one definition.
      const core=rows.filter(item=>cardCoreMatches(item,player));
      return new Set(core.map(item=>Number(item.definitionId))).size===1?core:[];
    };
    const cardMatchError=(rows,player,count)=>{
      const base=rows.filter(item=>!!item.concept&&matchesBaseCard(item,player.baseId));
      const rated=base.filter(item=>Number(item.rating)===player.rating);
      const sameRarity=rated.filter(item=>Number(item.rareflag)===player.rarity);
      const reason=!base.length?'EA returned no concept for this player ID.':!rated.length?'EA returned a different rating.':!sameRarity.length?'EA returned a different rarity.':count>1?'EA returned multiple card variants.':'FUTBIN and EA card details disagree.';
      const error=Error(`Could not uniquely match ${player.name} (${player.rating}): ${count} distinct EA cards found. ${reason} No squad changes were made.`);
      error.unmatchedPlayer=player;
      return error;
    };
    const conceptRows=async(players,idKey)=>{
      const query=async ids=>{
        const rows=[];
        for(let page=0;page<5;page++){
          const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=ids;criteria.count=100;criteria.offset=rows.length;
          const result=await observe(services.Item.searchConceptItems(criteria));
          if(!Array.isArray(result.response?.items))throw Error('EA concept results changed. No squad changes were made.');
          rows.push(...result.response.items);
          if(result.response.endOfList===true||result.response.endOfList===undefined&&result.response.items.length<criteria.count)return rows;
          if(!result.response.items.length)break;
        }
        throw Error('EA concept results are incomplete. No squad changes were made.');
      };
      const ids=[...new Set(players.map(player=>player[idKey]))];
      const rows=await query(ids);
      for(const player of players){
        const found=idKey==='definitionId'?rows.some(item=>Number(item.definitionId)===player.definitionId):conceptMatches(rows,player).length>0;
        if(!found)rows.push(...await query([player[idKey]]));
      }
      return rows;
    };
    const clubRows=async players=>{
      if(typeof services.Club?.search!=='function')throw Error('EA club search is unavailable. No squad changes were made.');
      const ids=[...new Set(players.map(player=>player.definitionId))];
      const rows=[];
      let offset=0;
      for(let page=0;page<10;page++){
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=ids;criteria.count=100;criteria.offset=offset;
        const result=await observe(services.Club.search(criteria));
        if(!Array.isArray(result.response?.items))throw Error('EA club results changed. No squad changes were made.');
        rows.push(...result.response.items);
        if(result.response.retrievedAll===true || result.response.retrievedAll===undefined&&result.response.items.length<criteria.count)return rows;
        if(!result.response.items.length)break;
        offset+=result.response.items.length;
      }
      throw Error('EA club search is incomplete. No squad changes were made.');
    };
    const ownedCopy=async player=>{
      const placed=slots.find(slot=>slot.item?.isValid?.()&&!slot.item.concept&&Number(slot.item.definitionId)===player.definitionId&&resolvedCardMatches(slot.item,player,false));
      if(placed)return placed.item;
      return (await clubRows([player])).find(item=>Number(item.id)>0&&Number(item.definitionId)===player.definitionId&&resolvedCardMatches(item,player,false));
    };
    const cheapestListing=async(player,maxBuy)=>{
      const criteria=marketCriteria(player.definitionId,maxBuy);
      const matches=[];
      for(let page=1;page<=2;page++){
        if(page>1)await new Promise(resolve=>setTimeout(resolve,1000));
        let result;
        try{result=await searchMarket(criteria,false,page);}
        catch(error){error.message=`Market page ${page} for ${player.name}: ${error.message}`;error.stage='sbc-price';error.page=page;throw error;}
        matches.push(...marketRows(result).filter(item=>Number(item.definitionId)===player.definitionId&&resolvedCardMatches(item,player,false)&&Number(auction(item)?.buyNowPrice)<=maxBuy&&Number(auction(item)?.getSecondsRemaining?.())>0&&auction(item)?.canBuy?.(coinBalance())));
        if(result.data.items.length<20)break;
      }
      matches.sort((a,b)=>Number(auction(a).buyNowPrice)-Number(auction(b).buyNowPrice)||Number(auction(b).getSecondsRemaining())-Number(auction(a).getSecondsRemaining()));
      return matches[0]||null;
    };
    const resolveCard=async player=>{
      const rows=await conceptRows([player],'baseId');
      let matches=conceptMatches(rows,player);
      if(matches.length>1){
        const expectedPosition=positionIds[String(player.position||'').toUpperCase()];
        if(Number.isInteger(expectedPosition)){
          const positioned=matches.filter(item=>Number(item.preferredPosition)===expectedPosition||item.basePossiblePositions?.some(value=>Number(value)===expectedPosition));
          if(positioned.length)matches=positioned;
        }
      }
      const definitions=new Set(matches.map(item=>Number(item.definitionId)));
      if(definitions.size!==1)throw cardMatchError(rows,player,definitions.size);
      return {...player,definitionId:[...definitions][0]};
    };
    if(action==='status') return {ok:true,challenge:snapshot()};
    if(challenge.id!==payload.challengeId || challenge.hasExpired() || challenge.isCompleted()) throw Error('The open challenge changed, expired, or is completed. Reconnect and compare again.');
    if(action==='sbcClubBuild'||action==='sbcHybridBuild'||action==='sbcRepairBuild'){
      const repair=action==='sbcRepairBuild',hybrid=repair||action==='sbcHybridBuild';
      const maxRating=payload.maxRating==null?99:Number(payload.maxRating);
      const excluded=new Set(payload.excludedDefinitionIds||[]);
      if(!Number.isInteger(maxRating)||maxRating<1||maxRating>99||excluded.size>528||[...excluded].some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Choose a maximum rating from 1 to 99 and valid card exclusions.');
      payload.sbcBuildDeadline=Date.now()+120000;
      const buildProgress=status=>{
        if(readCancelled())throw Error('SBC build stopped. Nothing was added.');
        if(Date.now()>=payload.sbcBuildDeadline)throw Error('SBC search reached its two-minute time limit. Nothing was added.');
        if(payload.sbcBuildToken)window.__futsbcSbcBuildProgress={id:payload.sbcBuildToken,status};
      };
      const buildRead=async(request,label,stage)=>{
        try{return await request();}
        catch(error){error.message=`${error.message} While ${label}.`;error.stage=stage;throw error;}
      };
      buildProgress('Reading your active squad…');
      const balance=hybrid?coinBalance():0;
      if(hybrid&&(!Number.isSafeInteger(balance)||balance<0))throw Error('EA could not read your coin balance. No squad changes were made.');
      const budget=balance,prices=new Map();
      const cost=item=>item.concept?(prices.get(Number(item.definitionId))??Infinity):0;
      if(snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed. Refresh before building from your club.');
      if(!Array.isArray(challenge.eligibilityRequirements)||typeof challenge.isRequirementMet!=='function')throw Error('EA requirement checks are unavailable. No squad changes were made.');
      if(typeof services.Squad?.requestSquadByType!=='function'||typeof services.Club?.search!=='function')throw Error('EA club protection checks are unavailable. No squad changes were made.');
      const active=await buildRead(()=>observe(services.Squad.requestSquadByType('active')), 'reading your active squad','sbc-build-active');
      const protectedSlots=active.data?.squad?.getPlayers?.();
      if(!Array.isArray(protectedSlots)||!protectedSlots.length)throw Error('EA could not identify your active squad. No club cards were selected.');
      const asset=item=>Number(item?.assetId)||Number(item?.definitionId)%0x1000000;
      const protectedAssets=new Set(protectedSlots.map(slot=>asset(slot.item)).filter(id=>id>0));
      const usable=item=>item&&!item.concept&&Number(item.id)>0&&Number(item.definitionId)>0&&item.isValid?.()===true&&
        !item.isLimitedUse?.()&&!item.isEnrolledInAcademy?.()&&!(Number(item.loans)>=0)&&!(Number(item.endTime)>0);
      const keyNames=['LEAGUE_ID','NATION_ID','CLUB_ID','TEAM_RATING','CHEMISTRY_POINTS','ALL_PLAYERS_CHEMISTRY_POINTS','PLAYER_QUALITY','PLAYER_LEVEL','PLAYER_RARITY','PLAYER_RARITY_GROUP','PLAYER_EXACT_OVR','PLAYER_MIN_OVR','PLAYER_MAX_OVR','LEAGUE_COUNT','NATION_COUNT','CLUB_COUNT','SAME_LEAGUE_COUNT','SAME_NATION_COUNT','SAME_CLUB_COUNT','FIRST_OWNER_PLAYERS_COUNT','PLAYER_TRADABILITY'];
      const keyName=rule=>typeof SBCEligibilityKey==='undefined'?null:keyNames.find(name=>SBCEligibilityKey[name]!==undefined&&rule.getFirstKey?.()===SBCEligibilityKey[name]);
      const values=rule=>{const raw=rule.getValue?.(rule.getFirstKey?.())??rule.getFirstValue?.(rule.getFirstKey?.());return (Array.isArray(raw)?raw:[raw]).map(Number).filter(Number.isFinite);};
      const rules=challenge.eligibilityRequirements;
      const requiredRating=Math.max(0,...rules.filter(rule=>keyName(rule)==='TEAM_RATING').flatMap(values));
      const requiredSpecial=item=>rules.some(rule=>['PLAYER_RARITY','PLAYER_RARITY_GROUP'].includes(keyName(rule))&&Number(rule.count)>0&&values(rule).some(value=>keyName(rule)==='PLAYER_RARITY'?value>1&&Number(item.rareflag)===value:item.belongsToGroup?.(value)===true));
      // Hybrid use is explicitly requested; basic high-rated fodder can be used.
      // Active squad, loans and evolutions remain protected. Specials are only
      // eligible when the challenge explicitly requires their rarity/group.
      const qualityAllowed=item=>typeof SBCEligibilityKey==='undefined'||typeof SBCEligibilityScope==='undefined'||typeof ItemRatingTier==='undefined'||typeof SBCEligibilityOperation!=='undefined'&&challenge.eligibilityOperation===SBCEligibilityOperation.OR||rules.filter(rule=>keyName(rule)==='PLAYER_QUALITY'&&!rule.isCombinedRequirement).every(rule=>{
        const tier=item.getTier?.()??(item.rating<=64?ItemRatingTier.BRONZE:item.rating<=74?ItemRatingTier.SILVER:ItemRatingTier.GOLD),target=values(rule)[0];
        if(!Number.isFinite(target))return true;
        return rule.scope===SBCEligibilityScope.GREATER?tier>=target:rule.scope===SBCEligibilityScope.LOWER?tier<=target:tier===target;
      });
      const automatic=item=>usable(item)&&qualityAllowed(item)&&([0,1].includes(Number(item.rareflag))||hybrid&&requiredSpecial(item))&&Number(item.rating)>=1&&Number(item.rating)<=Math.min(maxRating,hybrid?99:82)&&!excluded.has(Number(item.definitionId))&&!protectedAssets.has(asset(item));
      const original=slots.map(slot=>slot.item),fixed=new Map();
      for(const [index,item] of original.entries()){
        if(item?.isValid?.()&&!item.concept){
          if(!usable(item)){if(repair)continue;throw Error('An existing SBC card is not eligible for submission. No squad changes were made.');}
          if(!repair||!excluded.has(Number(item.definitionId)))fixed.set(index,item);
        }
      }
      if(!repair&&typeof SBCEligibilityScope!=='undefined'&&(typeof SBCEligibilityOperation==='undefined'||challenge.eligibilityOperation!==SBCEligibilityOperation.OR)){
        for(const rule of rules){
          const name=keyName(rule),target=values(rule)[0];
          if(rule.isCombinedRequirement||!['LEAGUE_COUNT','NATION_COUNT','CLUB_COUNT','SAME_LEAGUE_COUNT','SAME_NATION_COUNT','SAME_CLUB_COUNT'].includes(name)||!Number.isInteger(target)||(rule.scope!==SBCEligibilityScope.LOWER&&rule.scope!==SBCEligibilityScope.EXACT))continue;
          const field=name.includes('LEAGUE')?'leagueId':name.includes('NATION')?'nationId':'teamId',counts=new Map();
          for(const item of fixed.values()){const id=Number(item[field]);if(id>0)counts.set(id,(counts.get(id)||0)+1);}
          const actual=name.startsWith('SAME_')?Math.max(0,...counts.values()):counts.size;
          if(actual>target)throw Error(`Placed cards already exceed the ${name.toLowerCase().replaceAll('_',' ')} limit (${actual}/${target}). Use Finish my SBC to allow the fewest required replacements. No squad changes were made.`);
        }
      }
      const pool=new Map();let clubComplete=false;
      for(let page=0;page<30;page++){
        buildProgress(`Reading club cards · page ${page+1}/30…`);
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.count=100;criteria.offset=page*100;
        const response=await buildRead(()=>observe(services.Club.search(criteria)),`reading club cards (page ${page+1})`,'sbc-build-club');
        const rows=response.response?.items;
        if(!Array.isArray(rows))throw Error('EA club results changed. No squad changes were made.');
        for(const item of rows)if(automatic(item)){
          const key=Number(item.definitionId),existing=pool.get(key);
          if(!existing||Number(item.rating)<Number(existing.rating)||item.rating===existing.rating&&!item.tradable&&existing.tradable)pool.set(key,item);
        }
        if(response.response.retrievedAll===true||rows.length<criteria.count){clubComplete=true;break;}
      }
      if(findChallenge()!==challenge||snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed while reading your club. Nothing was added.');
      const collectMarket=async()=>{
        if(!clubComplete)throw Error('Your club scan is incomplete. No purchases were planned or squad changes made.');
        if(typeof services.Item?.searchConceptItems!=='function')throw Error('EA concept search is unavailable.');
        const baseFilter={ovrMax:maxRating};
        const quality=rules.find(rule=>keyName(rule)==='PLAYER_QUALITY'&&!rule.isCombinedRequirement&&(typeof SBCEligibilityOperation==='undefined'||challenge.eligibilityOperation!==SBCEligibilityOperation.OR));
        if(quality&&typeof ItemRatingTier!=='undefined'&&typeof SBCEligibilityScope!=='undefined'){
          const tier=values(quality)[0],range=tier===ItemRatingTier.BRONZE?[1,64]:tier===ItemRatingTier.SILVER?[65,74]:tier===ItemRatingTier.GOLD?[75,99]:null;
          if(range){
            if(quality.scope!==SBCEligibilityScope.LOWER)baseFilter.ovrMin=range[0];
            if(quality.scope!==SBCEligibilityScope.GREATER)baseFilter.ovrMax=range[1];
          }
        }
        const filters=repair?original.filter(item=>item?.concept&&!excluded.has(Number(item.definitionId))).map(item=>({defId:[Number(item.definitionId)]})):[];
        for(const rule of rules){
          const name=keyName(rule);
          for(const [key,field] of [['LEAGUE_ID','league'],['NATION_ID','nation'],['CLUB_ID','club']])if(name===key&&Number(rule.count)>0)
            for(const value of values(rule))if(Number.isInteger(value)&&value>0)filters.push({[field]:value});
          if(name==='PLAYER_RARITY'&&Number(rule.count)>0)for(const rarity of values(rule))filters.push({rarities:[rarity]});
          if(name==='PLAYER_RARITY_GROUP'&&Number(rule.count)>0&&typeof SearchLevel!=='undefined')filters.push({level:SearchLevel.SPECIAL});
          if(name==='PLAYER_MIN_OVR'||name==='PLAYER_EXACT_OVR')for(const rating of values(rule))if(rating>0&&rating<=99)filters.push({ovrMin:rating,ovrMax:name==='PLAYER_EXACT_OVR'?rating:99});
        }
        if(requiredRating>0)for(const rating of [...new Set([Math.max(1,requiredRating-2),requiredRating,Math.min(99,requiredRating+2)])])filters.push({ovrMin:rating,ovrMax:Math.min(99,rating+1)});
        const requiredFilters=filters.map(filter=>JSON.stringify({...baseFilter,...filter}));
        filters.push({});
        for(const [key,field] of [['leagueId','league'],['nationId','nation']]){
          const counts=new Map();for(const item of [...pool.values(),...fixed.values()]){const id=Number(item[key]);if(id>0)counts.set(id,(counts.get(id)||0)+1);}
          filters.push(...[...counts].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>({[field]:id})));
        }
        filters.push(...[...new Set(slots.map(slot=>slot.generalPositionName))].map(position=>({position})));
        const unique=[...new Map(filters.map(filter=>{const merged={...baseFilter,...filter};merged.ovrMax=Math.min(maxRating,merged.ovrMax??99);return [JSON.stringify(merged),merged];})).values()].slice(0,16);
        const market=new Map(),searchedFilters=[];let requests=0;
        const needsLinks=rules.some(rule=>['CHEMISTRY_POINTS','ALL_PLAYERS_CHEMISTRY_POINTS','LEAGUE_COUNT','NATION_COUNT','SAME_LEAGUE_COUNT','SAME_NATION_COUNT'].includes(keyName(rule)));
        // Give every price band a share of the request budget. Previously the
        // cheapest band exhausted it before high-rated/required cards were read.
        const ceilings=[...new Set([750,2500,10000,budget].map(value=>Math.min(value,budget)))].filter(value=>value>=150);
        const queryLimit=repair?24:48,perBand=Math.max(1,Math.floor(queryLimit/Math.max(1,ceilings.length)));
        for(const [band,ceiling] of ceilings.entries()){
          const priority=unique.filter(filter=>requiredFilters.includes(JSON.stringify(filter))).slice(0,Math.min(8,perBand));
          const adaptive=[];
          if(needsLinks&&market.size){
            const rows=[...pool.values(),...fixed.values(),...[...market.values()].map(row=>row.item)];
            const top=field=>{const counts=new Map();for(const item of rows){const id=Number(item[field]);if(id>0)counts.set(id,(counts.get(id)||0)+1);}return [...counts].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([id])=>id);};
            for(const league of top('leagueId'))adaptive.push({...baseFilter,league});
            for(const nation of top('nationId'))adaptive.push({...baseFilter,nation});
            for(const league of top('leagueId'))for(const nation of top('nationId'))adaptive.push({...baseFilter,league,nation});
          }
          const remaining=[...new Map([...adaptive,...unique.filter(filter=>!priority.includes(filter))].map(filter=>[JSON.stringify(filter),filter])).values()],capacity=perBand-priority.length;
          const rotated=remaining.length?Array.from({length:Math.min(capacity,remaining.length)},(_,index)=>remaining[(band*Math.max(1,capacity)+index)%remaining.length]):[];
          for(const filter of [...priority,...rotated]){
            if(requests>=queryLimit||Date.now()+18000>=payload.sbcBuildDeadline)break;
            if(requests++)await new Promise(resolve=>setTimeout(resolve,1000));
            if(findChallenge()!==challenge||snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed during market discovery. Nothing was added.');
            buildProgress(`Checking EA listings · search ${requests}/${queryLimit} · up to ${ceiling.toLocaleString()} coins · ${market.size} cards found…`);
            searchedFilters.push(filter);
            // Native search DTOs use position names (e.g. "GK"), whereas
            // preferredPosition and chemistry calculations use numeric IDs.
            // Sending 0 instead of "GK" causes EA's market to reject the query.
            if(filter.position&&!Object.hasOwn(positionIds,filter.position))throw Error('EA did not provide a supported search position. Nothing was added.');
            const criteria=Object.assign(marketCriteria(null,ceiling),filter);
            const result=await buildRead(()=>searchMarket(criteria,false,1,'sbc-build-market'),`searching EA listings${filter.position?` for ${filter.position}`:''} (search ${requests}, up to ${ceiling.toLocaleString()} coins)`,'sbc-build-market');
            for(const item of marketRows(result)){
              const price=Number(auction(item).buyNowPrice),id=Number(item.definitionId);
              if(!Number.isSafeInteger(price)||price<150||price>ceiling||!(Number(auction(item).getSecondsRemaining?.())>0)||!auction(item).canBuy?.(balance))continue;
              if(excluded.has(id)||Number(item.rating)>maxRating||pool.has(id)||market.has(id)&&market.get(id).price<=price)continue;
              market.set(id,{item,price});
            }
          }
        }
        // Preserve required rare/high-rated cards as well as cheap filler. A
        // global cheapest-only slice previously discarded the cards needed to pass.
        const discovered=[...market.values()].sort((a,b)=>a.price-b.price);
        const selectedMap=new Map();
        const keep=rows=>{for(const row of rows)selectedMap.set(Number(row.item.definitionId),row);};
        keep(discovered.slice(0,120));
        for(const rule of rules)if(keyName(rule)==='PLAYER_RARITY_GROUP')keep(discovered.filter(({item})=>values(rule).some(value=>item.belongsToGroup?.(value))).slice(0,12));
        for(const filter of [...unique,...searchedFilters]){
          const matching=discovered.filter(({item})=>
            (!filter.league||Number(item.leagueId)===filter.league)&&(!filter.nation||Number(item.nationId)===filter.nation)&&(!filter.club||Number(item.teamId)===filter.club)&&
            (!filter.ovrMin||Number(item.rating)>=filter.ovrMin)&&(!filter.ovrMax||Number(item.rating)<=filter.ovrMax)&&(!filter.rarities||filter.rarities.includes(Number(item.rareflag)))&&
            (!filter.position||Number(item.preferredPosition)===positionIds[filter.position]||[item.basePossiblePositions,item.possiblePositions].some(list=>list?.includes(positionIds[filter.position]))));
          keep(matching.slice(0,12));
        }
        const selected=[...selectedMap.values()];
        if(selected.length){
          const rows=[];
          // Resolve batches once; missing card versions must not trigger hundreds of serial retries.
          for(let offset=0;offset<selected.length;offset+=48){
            buildProgress(`Matching card versions · ${offset}/${selected.length}…`);
            const ids=selected.slice(offset,offset+48).map(({item})=>Number(item.definitionId));
            for(let page=0;page<3;page++){
              const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=ids;criteria.count=100;criteria.offset=page*100;
              const result=await buildRead(()=>observe(services.Item.searchConceptItems(criteria)),`matching market concepts (batch ${Math.floor(offset/48)+1}, page ${page+1})`,'sbc-build-concepts');
              if(!Array.isArray(result.response?.items))throw Error('EA concept results changed. Nothing was added.');
              rows.push(...result.response.items);
              if(result.response.endOfList===true||result.response.items.length<100)break;
            }
          }
          for(const {item,price} of selected){
            const match=rows.find(row=>row.concept&&Number(row.definitionId)===Number(item.definitionId)&&Number(row.rating)===Number(item.rating)&&Number(row.rareflag)===Number(item.rareflag));
            if(match){const projected=Object.assign(Object.create(Object.getPrototypeOf(match)),match,{tradable:true,owners:Math.max(2,Number(item.owners)||2)});pool.set(Number(match.definitionId),projected);prices.set(Number(match.definitionId),price);}
          }
        }
        if(findChallenge()!==challenge||snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed while matching market cards. Nothing was added.');
      };
      const fixedAssets=new Set([...fixed.values()].map(asset));
      if(!repair&&fixedAssets.size!==fixed.size)throw Error('The existing SBC contains duplicate players. No squad changes were made.');
      // A from-rules hybrid build replaces provisional concepts. Owned cards
      // stay fixed; club-only builds require an exact eligible owned concept copy.
      for(const [index,item] of original.entries())if(item?.concept&&Number(item.definitionId)>0){
        if(hybrid)continue;
        const owned=pool.get(Number(item.definitionId));
        if(!owned||Number(owned.definitionId)!==Number(item.definitionId)||fixedAssets.has(asset(owned)))throw Error(hybrid?'An existing concept has no eligible owned copy or checked affordable listing. No squad changes were made.':'An existing concept has no eligible owned copy. Remove it or use a FUTBIN solution.');
        fixed.set(index,owned);fixedAssets.add(asset(owned));
      }
      let candidates=[...pool.values()].filter(item=>!fixedAssets.has(asset(item))).sort((a,b)=>cost(a)-cost(b)||a.rating-b.rating||Number(a.tradable)-Number(b.tradable)||a.id-b.id);
      if(!repair&&!hybrid&&new Set(candidates.map(asset)).size<slots.length-fixed.size)throw Error(`Not enough eligible ${hybrid?'club and checked market':'club'} players: ${candidates.length} available for ${slots.length-fixed.size} slots. Active-squad players, loans, evolutions and unneeded specials are protected. No squad changes were made.`);
      const fits=(item,index)=>{const target=positionIds[slots[index].generalPositionName];return Number(item.preferredPosition)===target||[item.basePossiblePositions,item.possiblePositions].some(list=>Array.isArray(list)&&list.some(value=>Number(value)===target));};
      const themes=[{key:null,id:null},...(hybrid?[{minRating:75},{minRating:65},{highRating:true}]:[])];
      for(const key of ['leagueId','nationId','teamId']){
        const counts=new Map();for(const item of candidates){const id=Number(item[key]);if(id>0)counts.set(id,(counts.get(id)||0)+1);}
        themes.push(...[...counts].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([id])=>({key,id})));
      }
      const themeScore=(item,theme)=>theme.key?Number(Number(item[theme.key])===theme.id):theme.minRating?Number(item.rating>=theme.minRating):theme.highRating?Number(item.rating)/100:0;
      let previewActive=false;
      const apply=lineup=>{previewActive=true;lineup.forEach((item,index)=>squad.addItemToSlot(slots[index].index,item));};
      const restore=()=>{if(previewActive){original.forEach((item,index)=>squad.addItemToSlot(slots[index].index,item));previewActive=false;}};
      // Evaluate an isolated EA model: no observable notifications or UI redraws
      // during search, and no temporary changes to the user's displayed squad.
      const copyEntity=value=>Object.assign(Object.create(Object.getPrototypeOf(value)),value);
      if(!Array.isArray(squad._players)||!['updateChemistry','_calculateRating','_updateType'].every(key=>typeof squad[key]==='function'))throw Error('This EA client cannot safely evaluate SBC squads. No squad changes were made.');
      const evaluationSquad=copyEntity(squad);
      evaluationSquad._players=squad._players.map(copyEntity);
      if(squad._manager)evaluationSquad._manager=copyEntity(squad._manager);
      const evaluationChallenge=copyEntity(challenge);evaluationChallenge.squad=evaluationSquad;
      const evaluationSlots=evaluationSquad.getNonBrickSlots().filter(slot=>slot.index<11);
      if(evaluationSlots.length!==slots.length)throw Error('EA squad slots changed. Refresh the SBC.');
      let checks=0,best=null;let deadline=Math.min(Date.now()+15000,payload.sbcBuildDeadline-1000);
      let maxChecks=12000;const themeChecks=Math.max(120,Math.floor(maxChecks/themes.length));
      const partialCredit=()=>rules.reduce((sum,rule)=>{
        if(evaluationChallenge.isRequirementMet(rule))return sum+1;
        const name=keyName(rule),key=rule.getFirstKey?.();
        let actual=evaluationChallenge.getRequirementCounter?.(rule);
        if(rule.isCombinedRequirement&&typeof evaluationChallenge.getApplicableSlotsForCombinedReq==='function'){
          const counts=new Map();for(const index of evaluationChallenge.getApplicableSlotsForCombinedReq(rule))counts.set(index,(counts.get(index)||0)+1);
          actual=[...counts.values()].filter(count=>count===rule.keys().length).length;
        }
        if(name==='TEAM_RATING')actual=evaluationSquad.getRating?.();
        if(name==='CHEMISTRY_POINTS')actual=evaluationSquad.getChemistry?.();
        if(['SAME_LEAGUE_COUNT','SAME_NATION_COUNT','SAME_CLUB_COUNT','LEAGUE_COUNT','NATION_COUNT','CLUB_COUNT'].includes(name)){
          const field=name.includes('LEAGUE')?'leagueId':name.includes('NATION')?'nationId':'teamId',counts=new Map();
          for(const slot of evaluationSlots){const id=Number(slot.item[field]);if(id>0)counts.set(id,(counts.get(id)||0)+1);}
          actual=name.startsWith('SAME_')?Math.max(0,...counts.values()):counts.size;
        }
        if(['PLAYER_MIN_OVR','PLAYER_MAX_OVR','PLAYER_EXACT_OVR'].includes(name))actual=evaluationChallenge.getNumberOfPlayersByOVR?.(key,values(rule)[0]);
        const countKeys=['NATION_ID','LEAGUE_ID','CLUB_ID','PLAYER_LEVEL','PLAYER_RARITY','PLAYER_RARITY_GROUP','PLAYER_MIN_OVR','PLAYER_MAX_OVR','PLAYER_EXACT_OVR','PLAYER_TRADABILITY'];
        const target=rule.isCombinedRequirement||countKeys.includes(name)?Number(rule.count):values(rule)[0];
        if(!Number.isFinite(actual)||actual<0||!Number.isFinite(target))return sum;
        const scope=typeof SBCEligibilityScope==='undefined'?null:rule.scope===SBCEligibilityScope.GREATER?'min':rule.scope===SBCEligibilityScope.LOWER?'max':'exact';
        const gap=scope==='min'?Math.max(0,target-actual):scope==='max'?Math.max(0,actual-target):Math.abs(actual-target);
        return sum+Math.max(0,1-gap/Math.max(1,target,actual));
      },0);
      const changes=lineup=>lineup.reduce((count,item,index)=>count+(Number(original[index]?.definitionId)>0&&Number(original[index].definitionId)!==Number(item.definitionId)?1:0),0);
      const better=result=>!best||(repair&&result.changes!==best.changes?result.changes<best.changes:result.total<best.total);
      let lastYield=Date.now(),attempts=0;const evaluated=new Map();
      const score=async lineup=>{
        attempts++;
        if(attempts%16===1||Date.now()-lastYield>=40){
          buildProgress(`Checking SBC requirements · ${checks.toLocaleString()} combinations…`);
          await new Promise(resolve=>setTimeout(resolve,0));lastYield=Date.now();
          buildProgress(`Checking SBC requirements · ${checks.toLocaleString()} combinations…`);
          if(findChallenge()!==challenge||snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed during the club search. Nothing was added.');
        }
        const signature=lineup.map(item=>[Number(item.definitionId),Number(item.id)||0,!!item.concept].join('/')).join(':');
        if(evaluated.has(signature))return evaluated.get(signature);
        lineup.forEach((item,index)=>{evaluationSlots[index].item=item;});
        evaluationSquad.updateChemistry();evaluationSquad._calculateRating();evaluationSquad._updateType();
        checks++;
        const total=lineup.reduce((sum,item)=>sum+cost(item),0);
        const valid=!!evaluationChallenge.meetsRequirements()&&(hybrid||typeof evaluationSquad.isSBCSquadEligible!=='function'||evaluationSquad.isSBCSquadEligible())&&(!hybrid||total<=budget);
        const met=partialCredit();
        const chemistry=Number(evaluationSquad.getChemistry?.())||0;
        const ratingCost=lineup.reduce((sum,item)=>sum+Number(item.rating||0),0);
        // EA decides validity; chemistry is only a search heuristic.
        const result={valid,total,changes:changes(lineup),value:hybrid&&valid?1000000-(repair?changes(lineup)*10000:0)-total/(budget+1):met*1000+chemistry-ratingCost/10000-(hybrid?total/(budget+1):0),lineup:[...lineup]};
        evaluated.set(signature,result);return result;
      };
      const solve=async(maxReleased=null)=>{
        const baseline=new Map(fixed),indexes=[...baseline.keys()];
        const subsets=function*(count,start=0,selected=[]){
          if(!count){yield selected;return;}
          for(let i=start;i<=indexes.length-count;i++)yield*subsets(count-1,i+1,[...selected,indexes[i]]);
        };
        for(let stage=0;stage<=(repair?maxReleased??indexes.length:0);stage++){
          for(const released of subsets(stage)){
            fixed.clear();for(const [index,item] of baseline)if(!released.includes(index))fixed.set(index,item);
            fixedAssets.clear();for(const item of fixed.values())fixedAssets.add(asset(item));
            if(fixedAssets.size!==fixed.size)continue;
            candidates=[...pool.values()].filter(item=>!fixedAssets.has(asset(item))).sort((a,b)=>cost(a)-cost(b)||a.rating-b.rating);
            if(new Set(candidates.map(asset)).size<slots.length-fixed.size)continue;
            // A small repair checks combinations directly instead of hoping a
            // theme heuristic chooses the one card needed to finish the rules.
            const gaps=slots.map((_,index)=>index).filter(index=>!fixed.has(index));
            if(gaps.length<=3){
              const lineup=Array(slots.length),used=new Set(fixedAssets);
              for(const [index,item] of fixed)lineup[index]=item;
              const forced=original.filter(item=>Number(item?.definitionId)>0&&excluded.has(Number(item.definitionId))).length;
              const visit=async(depth,total)=>{
                if(Date.now()>deadline||checks>=maxChecks||best?.total===0&&best.changes===forced)return;
                if(depth===gaps.length){const result=await score(lineup);if(result.valid&&better(result))best=result;return;}
                const index=gaps[depth];
                for(const item of candidates){
                  if(used.has(asset(item))||total+cost(item)>budget)continue;
                  lineup[index]=item;used.add(asset(item));await visit(depth+1,total+cost(item));used.delete(asset(item));
                  if(Date.now()>deadline||checks>=maxChecks||best?.total===0&&best.changes===forced)break;
                }
              };
              await visit(0,[...fixed.values()].reduce((sum,item)=>sum+cost(item),0));
              if(Date.now()>deadline||checks>=maxChecks)break;
              continue;
            }
            // Cardinality puzzles need coordinated league/nation choices. Prune
            // impossible partial squads before spending an EA validation on them.
            const countRules=rules.flatMap(rule=>{
              if(rule.isCombinedRequirement||typeof SBCEligibilityScope==='undefined'||typeof SBCEligibilityOperation!=='undefined'&&challenge.eligibilityOperation===SBCEligibilityOperation.OR)return [];
              const name=keyName(rule),target=values(rule)[0];
              if(!['LEAGUE_COUNT','NATION_COUNT','CLUB_COUNT','SAME_LEAGUE_COUNT','SAME_NATION_COUNT','SAME_CLUB_COUNT'].includes(name)||!Number.isInteger(target)||target<1)return [];
              const scope=rule.scope===SBCEligibilityScope.GREATER?'min':rule.scope===SBCEligibilityScope.LOWER?'max':rule.scope===SBCEligibilityScope.EXACT?'exact':null;
              return scope?[{field:name.includes('LEAGUE')?'leagueId':name.includes('NATION')?'nationId':'teamId',same:name.startsWith('SAME_'),target,scope}]:[];
            });
            if(countRules.length&&!best){
              const lineup=Array(slots.length),used=new Set(fixedAssets);for(const [index,item] of fixed)lineup[index]=item;
              const order=[...gaps].sort((a,b)=>candidates.filter(item=>fits(item,a)).length-candidates.filter(item=>fits(item,b)).length);
              const ordinal=new Map(candidates.map((item,index)=>[Number(item.definitionId),index]));
              const symmetric=rules.every(rule=>keyName(rule)&&!rule.isCombinedRequirement);
              const viable=remaining=>countRules.every(rule=>{
                const counts=new Map();for(const item of lineup)if(item){const id=Number(item[rule.field]);if(id>0)counts.set(id,(counts.get(id)||0)+1);}
                const actual=rule.same?Math.max(0,...counts.values()):counts.size;
                return (rule.scope==='min'||actual<=rule.target)&&(rule.scope==='max'||actual+remaining>=rule.target);
              });
              const pools=new Map(order.map(index=>{
                const ranked=[...candidates].sort((a,b)=>Number(fits(b,index))-Number(fits(a,index))||cost(a)-cost(b)||a.rating-b.rating);
                const keep=new Map(ranked.slice(0,24).map(item=>[Number(item.definitionId),item]));
                for(const field of [...new Set(countRules.map(rule=>rule.field))]){const groups=new Map();for(const item of ranked){const id=Number(item[field]);const rows=groups.get(id)||[];if(rows.length<4){rows.push(item);groups.set(id,rows);}}for(const rows of groups.values())for(const item of rows)keep.set(Number(item.definitionId),item);}
                if(requiredRating)for(const item of [...ranked].sort((a,b)=>Math.abs(a.rating-requiredRating)-Math.abs(b.rating-requiredRating)||cost(a)-cost(b)).slice(0,8))keep.set(Number(item.definitionId),item);
                return [index,[...keep.values()]];
              }));
              let nodes=0;const until=Math.min(deadline,Date.now()+2500),limit=Math.min(maxChecks,checks+2000);
              const visit=async(depth,total)=>{
                if(best||nodes>=18000||checks>=limit||Date.now()>until)return;
                if(++nodes%128===0){await new Promise(resolve=>setTimeout(resolve,0));buildProgress(`Checking league and nation combinations · ${checks.toLocaleString()} EA checks…`);if(findChallenge()!==challenge||snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed during the club search. Nothing was added.');}
                if(!viable(order.length-depth))return;
                if(depth===order.length){const result=await score(lineup);if(result.valid&&better(result))best=result;return;}
                const index=order[depth],prior=symmetric?order.slice(0,depth).reverse().find(other=>slots[other].generalPositionName===slots[index].generalPositionName):undefined;
                for(const item of pools.get(index)){
                  if(used.has(asset(item))||total+cost(item)>budget||prior!==undefined&&ordinal.get(Number(item.definitionId))<=ordinal.get(Number(lineup[prior].definitionId)))continue;
                  lineup[index]=item;used.add(asset(item));await visit(depth+1,total+cost(item));used.delete(asset(item));lineup[index]=undefined;
                  if(best||nodes>=18000||checks>=limit||Date.now()>until)break;
                }
              };
              await visit(0,[...fixed.values()].reduce((sum,item)=>sum+cost(item),0));
              if(best&&best.total===0)break;
            }
            for(const theme of themes){
              buildProgress(`Checking SBC requirements · ${checks.toLocaleString()} combinations…`);
              if(Date.now()>deadline||checks>=maxChecks)break;
              const themeStart=checks,themeAttempts=attempts;
              const singleChecks=Math.max(32,Math.floor(themeChecks*.55));
              const used=new Set(fixedAssets),lineup=Array(slots.length);
              for(const [index,item] of fixed)lineup[index]=item;
              const order=slots.map((_,index)=>index).filter(index=>!fixed.has(index)).sort((a,b)=>candidates.filter(item=>fits(item,a)).length-candidates.filter(item=>fits(item,b)).length);
              for(const index of order){
                const eligible=candidates.filter(item=>!used.has(asset(item)));
                eligible.sort((a,b)=>Number(fits(b,index))-Number(fits(a,index))||themeScore(b,theme)-themeScore(a,theme)||cost(a)-cost(b)||a.rating-b.rating||a.id-b.id);
                lineup[index]=eligible[0];used.add(asset(eligible[0]));
              }
              let currentScore=await score(lineup);
              if(currentScore.valid&&better(currentScore))best=currentScore;
              if(best&&(!hybrid||best.total===0&&(!repair||best.changes===stage)))break;
              for(let pass=0;pass<3&&(!best||hybrid);pass++){
                let improved=false;
                for(const index of order){
                  const available=candidates.filter(item=>!lineup.some((other,otherIndex)=>otherIndex!==index&&asset(other)===asset(item)));
                  available.sort((a,b)=>Number(fits(b,index))-Number(fits(a,index))||themeScore(b,theme)-themeScore(a,theme)||cost(a)-cost(b)||a.rating-b.rating);
                  let chosen=currentScore;
                  const shortlist=new Map(available.slice(0,16).map(item=>[Number(item.definitionId),item]));
                  const reserve=list=>list.slice(0,6).forEach(item=>shortlist.set(Number(item.definitionId),item));
                  if(requiredRating>0)reserve([...available].sort((a,b)=>Math.abs(a.rating-requiredRating)-Math.abs(b.rating-requiredRating)||cost(a)-cost(b)));
                  for(const rule of rules){
                    const name=keyName(rule),wanted=values(rule);
                    if(['NATION_ID','LEAGUE_ID','CLUB_ID','PLAYER_RARITY','PLAYER_RARITY_GROUP','PLAYER_MIN_OVR','PLAYER_EXACT_OVR'].includes(name))reserve(available.filter(item=>
                      name==='NATION_ID'?wanted.includes(Number(item.nationId)):name==='LEAGUE_ID'?wanted.includes(Number(item.leagueId)):name==='CLUB_ID'?wanted.includes(Number(item.teamId)):
                      name==='PLAYER_RARITY'?wanted.includes(Number(item.rareflag)):name==='PLAYER_RARITY_GROUP'?wanted.some(value=>item.belongsToGroup?.(value)):
                      name==='PLAYER_EXACT_OVR'?wanted.includes(Number(item.rating)):wanted.some(value=>Number(item.rating)>=value)));
                  }
                  for(const item of shortlist.values()){
                    if(Date.now()>deadline||checks>=maxChecks||checks-themeStart>=singleChecks||attempts-themeAttempts>=themeChecks*3)break;
                    const next=[...lineup];next[index]=item;const result=await score(next);
                    if(result.valid&&better(result))best=result;
                    if(best&&!hybrid)break;
                    if(result.value>chosen.value)chosen=result;
                  }
                  if(best&&(!hybrid||best.total===0&&(!repair||best.changes===stage)))break;
                  if(chosen.value>currentScore.value){lineup.splice(0,lineup.length,...chosen.lineup);currentScore=chosen;improved=true;}
                }
                if(!improved||Date.now()>deadline||checks>=maxChecks||checks-themeStart>=singleChecks||attempts-themeAttempts>=themeChecks*3)break;
              }
              // Escape one-card local optima: an existing player can move to a
              // better slot, and two replacements can cross a chemistry/rule cliff.
              if(!best||hybrid&&best.total>0){
                for(let pass=0;pass<2;pass++){
                  let chosen=currentScore;
                  pairs:for(let a=0;a<order.length;a++)for(let b=a+1;b<order.length;b++){
                    if(Date.now()>deadline||checks>=maxChecks||checks-themeStart>=themeChecks||attempts-themeAttempts>=themeChecks*5)break;
                    const left=order[a],right=order[b],usedElsewhere=new Set(lineup.filter((_,index)=>index!==left&&index!==right).map(asset));
                    const available=candidates.filter(item=>!usedElsewhere.has(asset(item)));
                    const pairPool=index=>{
                      const ranked=[...available].sort((a,b)=>Number(fits(b,index))-Number(fits(a,index))||themeScore(b,theme)-themeScore(a,theme)||cost(a)-cost(b)||a.rating-b.rating);
                      const selected=new Map([lineup[left],lineup[right],...ranked.slice(0,4)].map(item=>[Number(item.definitionId),item]));
                      if(requiredRating)for(const item of [...available].sort((a,b)=>Math.abs(a.rating-requiredRating)-Math.abs(b.rating-requiredRating)||cost(a)-cost(b)).slice(0,2))selected.set(Number(item.definitionId),item);
                      return [...selected.values()];
                    };
                    for(const first of pairPool(left))for(const second of pairPool(right)){
                      if(asset(first)===asset(second))continue;
                      if(Date.now()>deadline||checks>=maxChecks||checks-themeStart>=themeChecks||attempts-themeAttempts>=themeChecks*5)break;
                      const next=[...lineup];next[left]=first;next[right]=second;
                      if(next.reduce((sum,item)=>sum+cost(item),0)>budget)continue;
                      const result=await score(next);if(result.valid&&better(result))best=result;
                      if(result.value>chosen.value)chosen=result;
                    }
                    if(best)break pairs;
                  }
                  if(chosen.value<=currentScore.value||best)break;
                  lineup.splice(0,lineup.length,...chosen.lineup);currentScore=chosen;
                }
              }
              restore();
              if(best&&(!hybrid||best.total===0&&(!repair||best.changes===stage)))break;
              // Yield only after restoring the original squad, then detect user edits.
              await new Promise(resolve=>setTimeout(resolve,0));
              if(findChallenge()!==challenge||snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed during the club search. Nothing was added.');
            }
          if(Date.now()>deadline||checks>=maxChecks)break;
          }
          if(best||Date.now()>deadline||checks>=maxChecks)break;
        }
        fixed.clear();for(const [index,item] of baseline)fixed.set(index,item);
      };
      try{
        if(repair)for(const [index,item] of original.entries())if(item?.concept&&!excluded.has(Number(item.definitionId))&&pool.has(Number(item.definitionId)))fixed.set(index,pool.get(Number(item.definitionId)));
        const unpricedConcept=repair&&original.some(item=>item?.concept&&!excluded.has(Number(item.definitionId))&&!pool.has(Number(item.definitionId)));
        if(!unpricedConcept)await solve(repair?(original.every(usable)&&!excluded.size?1:0):null);
        if(hybrid&&!best){
          buildProgress(repair?'No club-only completion found · checking cheapest EA listings…':'No club solution found · checking linked EA listings…');
          await collectMarket();
          deadline=Math.min(Date.now()+15000,payload.sbcBuildDeadline-1000);maxChecks=checks+12000;
          for(const key of ['leagueId','nationId','teamId']){
            const counts=new Map();for(const item of pool.values()){const id=Number(item[key]);if(id>0)counts.set(id,(counts.get(id)||0)+1);}
            for(const [id] of [...counts].sort((a,b)=>b[1]-a[1]).slice(0,12))if(!themes.some(theme=>theme.key===key&&theme.id===id))themes.push({key,id});
          }
          // Keep an existing concept when its exact owned/market card is available.
          if(repair)for(const [index,item] of original.entries())if(item?.concept&&!excluded.has(Number(item.definitionId))&&pool.has(Number(item.definitionId)))fixed.set(index,pool.get(Number(item.definitionId)));
          await solve();
        }
      }finally{restore();}
      await new Promise(resolve=>setTimeout(resolve,0));
      buildProgress('Finishing SBC requirement checks…');
      if(findChallenge()!==challenge||snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed during the club search. Nothing was added.');
      if(!best)throw Error(`No valid ${hybrid?'hybrid':'club'} squad found in ${checks} checked combinations${clubComplete?'':' (club scan capped)'}. This is a bounded search${hybrid?' of eligible owned cards and checked listings within your balance':', not proof your club cannot solve it'}. No squad changes were made.`);
      if(findChallenge()!==challenge||snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed before adding players. Nothing was added.');
      buildProgress('Preparing the verified squad…');
      if(hybrid&&(!Number.isSafeInteger(coinBalance())||coinBalance()<best.total))throw Error('Your coin balance changed and no longer covers this plan. Nothing was added.');
      const output=best.lineup.map((item,index)=>({name:teamPlayerName(item),baseId:asset(item),definitionId:Number(item.definitionId),ownedId:item.concept?undefined:Number(item.id),owned:!item.concept,rating:Number(item.rating),rarity:Number(item.rareflag),price:cost(item),position:slots[index].generalPositionName,slotPosition:slots[index].generalPositionName,futbinSlot:slots[index].index,slotIndex:slots[index].index,kept:Number(original[index]?.definitionId)>0&&Number(original[index].definitionId)===Number(item.definitionId)}));
      try{
        buildProgress('Saving the verified squad…');payload.sbcBuildSaving=true;
        apply(best.lineup);
        if(!challenge.meetsRequirements()||(!hybrid&&typeof squad.isSBCSquadEligible==='function'&&!squad.isSBCSquadEligible()))throw Error('EA did not confirm this squad.');
        await observe(services.SBC.saveChallenge(challenge),false,'sbc-club-save');
      }catch(error){restore();error.message=`${error.message} Reopen the SBC to verify its saved state. No submission was attempted.`;throw error;}
      return {ok:true,challenge:snapshot(),players:output,checks,clubComplete,total:best.total,budget,changes:best.changes,kept:output.filter(player=>player.kept).length,filled:original.filter(item=>!(Number(item?.definitionId)>0)).length,maxRating,excludedDefinitionIds:[...excluded]};
    }
    if(action==='sbcOwnership'){
      if(snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed. Refresh it before checking missing cards.');
      const players=payload.players;
      if(!Array.isArray(players)||players.length!==slots.length||players.some(player=>!Number.isSafeInteger(player.definitionId)||player.definitionId<1))throw Error('The SBC card list is invalid.');
      const placed=player=>slots.find(slot=>slot.item?.isValid?.()&&!slot.item.concept&&Number(slot.item.definitionId)===player.definitionId&&resolvedCardMatches(slot.item,player,false))?.item;
      const unfilled=players.filter(player=>!placed(player));
      const rows=unfilled.length?await clubRows(unfilled):[];
      if(findChallenge()!==challenge||snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed while reading your club. Refresh it before buying.');
      return {ok:true,balance:coinBalance(),owned:players.filter(player=>placed(player)||rows.some(item=>Number(item.id)>0&&Number(item.definitionId)===player.definitionId&&resolvedCardMatches(item,player,false))).map(player=>player.definitionId)};
    }
    if(action==='sbcQuote'){
      const player=payload.player,balance=coinBalance();
      if(!Number.isSafeInteger(player?.definitionId)||player.definitionId<1||!Number.isSafeInteger(balance)||balance<0)throw Error('EA cannot check this card or the current coin balance.');
      if(await ownedCopy(player))return {ok:true,phase:'owned',definitionId:player.definitionId,balance};
      if(balance<150)return {ok:true,phase:'unavailable',definitionId:player.definitionId,balance};
      const item=await cheapestListing(player,balance);
      if(!item)return {ok:true,phase:'unavailable',definitionId:player.definitionId,balance};
      return {ok:true,phase:'quoted',definitionId:player.definitionId,price:Number(auction(item).buyNowPrice),tradeId:String(auction(item).tradeId),balance};
    }
    if(action==='sbcBuyOne'){
      const player=payload.player,maxPrice=Number(payload.maxPrice),remaining=Number(payload.remaining),balance=coinBalance();
      if(!Number.isSafeInteger(player?.definitionId)||player.definitionId<1||!Number.isSafeInteger(maxPrice)||maxPrice<0||!Number.isSafeInteger(remaining)||remaining<maxPrice)throw Error('The approved SBC price limit is invalid.');
      if(await ownedCopy(player))return {ok:true,phase:'owned',definitionId:player.definitionId,balance};
      if(maxPrice<150)return {ok:true,phase:'unavailable',definitionId:player.definitionId,balance};
      if(!Number.isSafeInteger(balance)||balance<150)return {ok:true,phase:'unavailable',definitionId:player.definitionId,balance};
      if(typeof services.Item?.bid!=='function'||typeof services.Item?.move!=='function'||typeof ItemPile==='undefined')throw Error('EA buying or send-to-club is unavailable in this client version.');
      const item=await cheapestListing(player,Math.min(maxPrice,remaining,balance));
      if(!item)return {ok:true,phase:'unavailable',definitionId:player.definitionId,balance};
      const price=Number(auction(item).buyNowPrice),tradeId=String(auction(item).tradeId);
      if(!Number.isSafeInteger(price)||price<150||price>maxPrice||price>remaining||price>balance||!auction(item).canBuy?.(balance))return {ok:true,phase:'unavailable',definitionId:player.definitionId,balance};
      let response;
      try{sbcPurchaseAttempted=true;response=await observe(services.Item.bid(item,price));}
      catch(error){return {ok:true,phase:'uncertain',definitionId:player.definitionId,price,tradeId,warning:`EA did not confirm the purchase of ${player.name}: ${error.message} Check New Items before restarting.`};}
      const won=[...(response.data?.items||[]),...(response.response?.items||[])].find(row=>Number(row.definitionId)===player.definitionId&&Number(row.id)>0)||(auction(item)?.isWon?.()?item:null);
      if(!won||!(auction(item)?.isWon?.()||auction(won)?.isWon?.()||won.pile===ItemPile.PURCHASED))return {ok:true,phase:'uncertain',definitionId:player.definitionId,price,tradeId,warning:`EA accepted the purchase request for ${player.name}, but the won card was not confirmed. Check New Items before restarting.`};
      try{
        await observe(services.Item.move(won,ItemPile.CLUB));
        let stored;
        for(let attempt=0;attempt<2;attempt++){
          stored=(await clubRows([player])).find(row=>Number(row.id)===Number(won.id)&&resolvedCardMatches(row,player,false));
          if(stored)break;
          if(!attempt)await new Promise(resolve=>setTimeout(resolve,500));
        }
        if(!stored)return {ok:true,phase:'purchased-unverified',definitionId:player.definitionId,price,tradeId,itemId:Number(won.id),balance:coinBalance(),warning:`Bought ${player.name}, but EA has not shown it in your club. Check New Items and your club before restarting.`};
        return {ok:true,phase:'in-club',definitionId:player.definitionId,price,tradeId,itemId:Number(won.id),balance:coinBalance()};
      }catch(error){return {ok:true,phase:'purchased-unverified',definitionId:player.definitionId,price,tradeId,itemId:Number(won.id),balance:coinBalance(),warning:`Bought ${player.name}, but sending it to your club was not confirmed: ${error.message} Check New Items before restarting.`};}
    }
    if(action==='sbcSwapCheck'||action==='sbcSwapApply'){
      if(snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed. Refresh it before swapping.');
      const slot=slots.find(entry=>entry.index===payload.slotIndex);
      if(!slot)throw Error('The selected SBC slot no longer exists.');
      const player=await resolveCard(payload.player);
      if(slots.some(entry=>entry.index!==slot.index&&entry.item?.isValid?.()&&Number(entry.item.definitionId)===player.definitionId))throw Error(`${player.name} is already in another SBC slot.`);
      const owned=await ownedCopy(player);
      const rows=owned?[]:await conceptRows([player],'definitionId');
      const item=owned||rows.find(row=>Number(row.definitionId)===player.definitionId&&resolvedCardMatches(row,player));
      if(!item)throw Error(`EA could not load ${player.name} for the swap.`);
      if(snapshot().fingerprint!==payload.fingerprint)throw Error('The SBC changed while checking the swap.');
      const previous=slot.item;
      let valid=false;
      try{
        squad.addItemToSlot(slot.index,item);
        valid=!!challenge.meetsRequirements();
        if(!valid||action==='sbcSwapCheck')squad.addItemToSlot(slot.index,previous);
        else await observe(services.SBC.saveChallenge(challenge));
      }catch(error){squad.addItemToSlot(slot.index,previous);throw Error(`${error.message} The local squad was restored; reopen the SBC to verify the server state.`);}
      if(action==='sbcSwapCheck'){
        if(snapshot().fingerprint!==payload.fingerprint)throw Error('EA could not restore the squad after the swap check. Reopen the SBC.');
        return {ok:true,valid,player:{...player,owned:!!owned}};
      }
      if(!valid)throw Error(`${player.name} does not meet this SBC's requirements.`);
      return {ok:true,player:{...player,owned:!!owned},challenge:snapshot()};
    }
    if(action==='resolve') {
      const resolved=[];
      const rows=await conceptRows(payload.players,'baseId');
      for(const p of payload.players) {
        let matches=conceptMatches(rows,p);
        if(matches.length>1){
          const expectedPosition=positionIds[String(p.position||'').toUpperCase()];
          if(Number.isInteger(expectedPosition)){
            const positioned=matches.filter(item=>Number(item.preferredPosition)===expectedPosition||item.basePossiblePositions?.some(value=>Number(value)===expectedPosition));
            if(positioned.length)matches=positioned;
          }
        }
        const definitions=new Set(matches.map(item=>Number(item.definitionId)));
        if(definitions.size!==1)throw cardMatchError(rows,p,definitions.size);
        resolved.push({...p,definitionId:[...definitions][0]});
      }
      return {ok:true,players:resolved,challenge:snapshot()};
    }
    if(action==='concepts') {
      if(snapshot().fingerprint!==payload.fingerprint) throw Error('Your squad changed after review. Reconnect before inserting concepts.');
      if(payload.players.length!==slots.length || new Set(payload.mapping).size!==slots.length || payload.mapping.some(i=>!slots.some(s=>s.index===i))) throw Error('Invalid squad slot mapping.');
      const items=[];
      const used=new Set();
      for(let index=0;index<payload.players.length;index++){
        const player=payload.players[index],slot=slots.find(s=>s.index===payload.mapping[index]);
        const existing=slot.item?.isValid?.()&&!slot.item.concept?slot.item:null;
        if(existing && (Number(existing.definitionId)!==player.definitionId||!resolvedCardMatches(existing,player,false)))throw Error(`An existing player in slot ${slot.index+1} does not match ${player.name}. No squad changes were made.`);
        if(existing){
          if(used.has(Number(existing.id)))throw Error('The same owned card appears in multiple slots. No squad changes were made.');
          items[index]=existing;used.add(Number(existing.id));
        }
      }
      const unfilled=payload.players.filter((_,index)=>!items[index]);
      const owned=unfilled.length?await clubRows(unfilled):[];
      const missing=[];
      for(let index=0;index<payload.players.length;index++){
        if(items[index])continue;
        const player=payload.players[index];
        const item=owned.find(row=>Number(row.id)>0&&!used.has(Number(row.id))&&Number(row.definitionId)===player.definitionId&&resolvedCardMatches(row,player,false));
        if(item){items[index]=item;used.add(Number(item.id));}
        else missing.push(player);
      }
      if(missing.length){
        const rows=await conceptRows(missing,'definitionId');
        for(let index=0;index<payload.players.length;index++){
          if(items[index])continue;
          const player=payload.players[index];
          const item=rows.find(row=>Number(row.definitionId)===player.definitionId&&resolvedCardMatches(row,player));
          if(!item)throw Error(`Concept card unavailable for ${player.name}.`);
          items[index]=item;
        }
      }
      if(findChallenge()!==challenge || snapshot().fingerprint!==payload.fingerprint) throw Error('The SBC changed during loading. Reconnect.');
      const previous=slots.map(s=>({index:s.index,item:s.item}));
      try {
        items.forEach((item,i)=>squad.addItemToSlot(payload.mapping[i],item));
        if(!challenge.meetsRequirements()) throw Error('This arrangement does not meet the SBC requirements. Adjust the slot assignments and try again.');
        await observe(services.SBC.saveChallenge(challenge));
      } catch(error) {
        previous.forEach(s=>squad.addItemToSlot(s.index,s.item));
        throw Error(error.message+' The local squad was restored; reopen the SBC to verify the server state.');
      }
      return {ok:true,challenge:snapshot(),players:payload.players.map((player,index)=>({...player,owned:!items[index].concept}))};
    }
    throw Error('Unsupported operation.');
  } catch(error) { return {ok:false,...(['sbcBuyOne','galleryBuyOne'].includes(action)?{purchaseAttempted:sbcPurchaseAttempted}:{}),error:error.message,status:error.status??null,stage:error.stage??null,page:error.page??null,unmatchedPlayer:error.unmatchedPlayer??null}; }
}
