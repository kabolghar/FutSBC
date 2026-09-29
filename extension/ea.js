// Inspected against EA FC 27 public client build 11321. No raw EA endpoints or credentials.
// Called only by chrome.scripting from our trusted extension service worker.
export async function eaOperation(action, payload = {}) {
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
    const readCancelled=()=>payload.readToken&&window.__futsbcCancelledTeamRead===payload.readToken&&['teamSnapshot','teamEvaluate','teamQuote','teamPlan'].includes(action);
    if(readCancelled())throw Error('Background recommendations stopped.');
    const observe=(observable,allowRejection=false,stage=null)=>new Promise((resolve,reject)=>{
      const owner={};
      const timer=setTimeout(()=>{observable.unobserve(owner);reject(Error('EA did not respond. Check the Web App connection before retrying.'));},20000);
      observable.observe(owner,(sender,result)=>{clearTimeout(timer);sender.unobserve(owner);if(readCancelled()){reject(Error('Background recommendations stopped.'));return;}if(result.success||allowRejection)resolve(result);else{const unauthorized=Number(result.status)===401;const error=Error(unauthorized?'EA could not authenticate this request (401). Reload the EA Web App and sign in again if prompted, then reopen your squad and retry.':`EA rejected the request (${result.status ?? 'unknown'}).`);error.status=result.status;error.stage=stage;reject(error);}});
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
    const hasTeamCard=item=>Number(item?.definitionId)>0&&(item?.isValid?.()||item?.concept===true);
    const teamPlayerName=item=>{
      if(!hasTeamCard(item))return 'Open position';
      const data=item.getStaticData?.()||item._staticData||{};
      const display=String(data.commonName||data.name||[data.firstName,data.lastName].filter(Boolean).join(' ')||item.commonName||item.name||item.lastName||'').trim();
      return display||`Player ${Number(item.rating)||''}`.trim();
    };
    const teamFingerprint=players=>players.map(slot=>`${slot.index}:${slot.item?.definitionId||0}:${slot.item?.id||0}:${!!slot.item?.concept}:${slot.generalPositionName||''}`).join('|');
    if(action==='teamSnapshot'){
      const {team,players}=activeTeam();
      const balance=coinBalance();
      if(!Number.isSafeInteger(balance)||balance<0)throw Error('EA did not provide your coin balance.');
      return {ok:true,id:team.getId?.(),name:String(team.getName?.()||'Current squad'),formation:team.getFormation()?.displayName||'',chemistry:Number(team.getChemistry?.())||0,balance,fingerprint:teamFingerprint(players),players:players.map(slot=>({index:slot.index,position:String(slot.generalPositionName||''),name:teamPlayerName(slot.item),rating:hasTeamCard(slot.item)?Number(slot.item.rating)||0:0,assetId:hasTeamCard(slot.item)?Number(slot.item.assetId)||Number(slot.item.definitionId)%0x1000000:0,definitionId:hasTeamCard(slot.item)?Number(slot.item.definitionId)||0:0,itemId:hasTeamCard(slot.item)?Number(slot.item.id)||0:0,concept:!!slot.item?.concept,leagueId:Number(slot.item?.leagueId)||0,nationId:Number(slot.item?.nationId??slot.item?.nationalityId)||0,clubId:Number(slot.item?.teamId)||0,chemistry:Number(slot.chemistry)||0}))};
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
        const response=await observe(services.Item.searchConceptItems(criteria),false,'team-concept-search');
        if(!Array.isArray(response.response?.items))throw Error('EA concept search changed. No upgrades were suggested.');
        addConceptRows(response.response.items,batch);
      }
      const missing=wanted.filter(card=>['FUT.GG','User','Menu'].includes(card.source)&&!(byId.get(card.assetId)||[]).some(item=>Number(item.definitionId)===card.definitionId));
      for(let offset=0;offset<missing.length;offset+=12){
        const batch=missing.slice(offset,offset+12);
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=[...new Set(batch.map(card=>card.assetId))];criteria.count=100;criteria.offset=0;
        const response=await observe(services.Item.searchConceptItems(criteria),false,'team-concept-search');
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
    const searchMarket=(criteria,allowRejection=false,page=1)=>{
      if(typeof services.Item?.clearTransferMarketCache!=='function') throw Error('EA market search cache API changed. Trading stopped.');
      // EA's own search results controller selects the market module before searching.
      services.Module?.set?.(3355443200);
      if(page===1)services.Item.clearTransferMarketCache();
      return observe(services.Item.searchTransferMarket(criteria,page),allowRejection);
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
    const quote=(rows,definitionId,tradeId,futbinPrice,buy)=>{
      const prices=rows.filter(row=>Number(row.definitionId)===definitionId&&String(auction(row)?.tradeId)!==String(tradeId)).map(row=>Number(auction(row)?.buyNowPrice)).filter(price=>Number.isSafeInteger(price)&&price>0).sort((a,b)=>a-b);
      if(prices.length<5)return null;
      const reference=prices[0],sell=Math.min(previousPrice(reference),floorPrice(futbinPrice));
      const minimumProfit=Math.max(200,Math.ceil(buy*.08/50)*50);
      const profit=Math.floor(sell*.95)-buy;
      return sell>buy&&profit>=minimumProfit?{sell,reference,profit,minimumProfit,comparables:prices.slice(0,5)}:null;
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
      for(let start=0;start<ids.length;start+=12){
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=ids.slice(start,start+12);criteria.count=100;criteria.offset=0;
        const found=await observe(services.Item.searchConceptItems(criteria));
        if(!Array.isArray(found.response?.items))throw Error('EA concept search changed.');
        for(const item of found.response.items)if(item?.concept&&ids.includes(Number(item.definitionId)))concepts.set(Number(item.definitionId),item);
      }
      const missing=ids.filter(id=>!concepts.has(id));
      for(let start=0;start<missing.length;start+=12){
        const batch=missing.slice(start,start+12);
        const criteria=new UTSearchCriteriaDTO();criteria.type=SearchType.PLAYER;criteria.defId=[...new Set(batch.map(id=>id%0x1000000))];criteria.count=100;criteria.offset=0;
        const found=await observe(services.Item.searchConceptItems(criteria));
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
      const compare=(a,b)=>(b.coverage||0)-(a.coverage||0)||(b.anchorChemistry||0)-(a.anchorChemistry||0)||b.chemistry-a.chemistry||(b.anchorTotal||0)-(a.anchorTotal||0)||b.meta-a.meta||(b.fallbackMeta||0)-(a.fallbackMeta||0)||a.cost-b.cost;
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
          const candidate={chosen,used,cost,meta,anchorChemistry:anchorScore(chem),anchorTotal:anchorScore(chem,3),linkSupport:linkSupport(chosen),fallbackMeta,metaEvidence,coverage,canComplete,chemistry:Number(chem.chemistry)};
          if(step===bySlot.length-1){
            checked++;
            // An explicit build-around choice may require chemistry trade-offs.
            // Keep the best complete alternative, without relaxing identity or cost.
            if(action==='teamPlan'&&payload.allowChemistryFallback===true&&completeXI&&coverage===bySlot.length){
              const slotChemistry=Object.fromEntries(players.map(row=>[row.index,Number(chem.getSlotChemistry?.(row.index)?.points)]));
              if(Object.values(slotChemistry).every(points=>Number.isFinite(points)&&points>=0&&points<=3)){
                const fallback={anchorChemistry:anchorScore(chem),anchorTotal:anchorScore(chem,3),meta,fallbackMeta,metaEvidence,score:meta,cost,coverage,selectedCount:bySlot.length,unfilledSlots:[],chemistry:candidate.chemistry,slotChemistry,chemistryTradeoff:true,targetChemistry:minimumChemistry,baselineChemistry:Number(baseline.chemistry),choices:[...chosen].map(([slotIndex,value])=>({...value.option,slotIndex,slotChemistry:slotChemistry[slotIndex]})).sort((a,b)=>a.slotIndex-b.slotIndex)};
                if(!chemistryFallback||compare(fallback,chemistryFallback)<0)chemistryFallback=fallback;
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
              const found={anchorChemistry:anchorScore(chem),anchorTotal:anchorScore(chem,3),meta,fallbackMeta,metaEvidence,score:meta,cost,coverage,selectedCount:bySlot.length,unfilledSlots:bySlot.filter(group=>chosen.get(group.slot.index)?.option.retained).map(group=>group.slot.index),chemistry:candidate.chemistry,slotChemistry:Object.fromEntries(players.map(row=>[row.index,points(row.index)||0])),choices:[...chosen].filter(([,value])=>!value.option.retained).map(([slotIndex,value])=>({...value.option,slotIndex,slotChemistry:points(slotIndex)})).sort((a,b)=>a.slotIndex-b.slotIndex)};
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
      if(chemistryFallback&&(!best||best.choices.length<bySlot.length))best=chemistryFallback;
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
      let pages=0;
      for(let page=1;page<=AUCTION_PAGES_PER_PASS;page++){
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
        if(result.data.items.length<20||!added)break;
      }
      const rows=[...all.values()],candidates=[];
      for(const item of rows){
        const data=auction(item),base=Number(item.assetId)||Number(item.definitionId)%0x1000000;
        const seconds=Number(data?.getSecondsRemaining?.());
        const bid=Number(data?.currentBid)>0?UTCurrencyInputControl.getIncrementAboveVal(Number(data.currentBid)):Number(data?.startingBid);
        if(!item?.isPlayer?.()||base!==card.assetId||Number(item.rareflag??0)>1||known.has(String(data?.tradeId))||!Number.isFinite(seconds)||seconds<8||seconds>180||!Number.isSafeInteger(bid)||bid<150||bid>balance||bid>=card.consolePrice*.9||Number.isSafeInteger(card.researchBidCeiling)&&bid>card.researchBidCeiling||data?.buyNowPrice>0&&bid>=data.buyNowPrice||!data?.canBid?.(bid,balance))continue;
        const offer=quote(rows,Number(item.definitionId),data.tradeId,card.consolePrice,bid);
        if(offer)candidates.push({item,bid,seconds,offer});
      }
      candidates.sort((a,b)=>b.offer.profit-a.offer.profit||a.seconds-b.seconds);
      const bids=[];
      let uncertain=null;
      for(const candidate of candidates){
        if(bids.length>=capacity)break;
        const {item,bid,seconds,offer}=candidate,data=auction(item),available=Math.min(coinBalance(),uncommitted);
        if(!Number.isSafeInteger(available)||bid>available||!data?.canBid?.(bid,available))continue;
        const order={name:String(item.name||item.commonName||item.lastName||card.name||`Card ${item.definitionId}`),definitionId:Number(item.definitionId),tradeId:String(data.tradeId),sell:offer.sell,reference:offer.reference,futbinPrice:card.consolePrice,futbinURL:card.url,quoteAt:Date.now(),lastBid:bid,seconds,misses:0,researchBidCeiling:card.researchBidCeiling};
        try{await observe(services.Item.target(item));known.add(order.tradeId);}
        catch(error){continue;}
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
      return {ok:true,balance:coinBalance(),bids,checked:1,pages,auctions:rows.length,candidates:candidates.length,uncertain};
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
        const data=auction(item),seconds=Number(data?.getSecondsRemaining?.()),paid=Number(data?.currentBid)||Number(order.lastBid);
        if(data?.isWon?.()){
          if(!Number.isSafeInteger(paid)||paid<150){updates.push({tradeId:order.tradeId,phase:'won-unlisted',warning:`Won ${order.name}, but the paid price could not be verified. Check New Items.`});continue;}
          try{
            let result=fresh.get(order.definitionId);
            if(!result){result=await searchMarket(marketCriteria(order.definitionId));fresh.set(order.definitionId,result);}
            const offer=quote(result.data?.items||[],order.definitionId,order.tradeId,order.futbinPrice,paid);
            if(!offer){updates.push({tradeId:order.tradeId,phase:'won-unlisted',paid,warning:`Won ${order.name}, but no current profitable sale price was verified. Check New Items.`});continue;}
            if(!item.hasPriceLimits?.()&&typeof services.Item.requestMarketData==='function')await observe(services.Item.requestMarketData(item));
            await observe(services.Item.list(item,previousPrice(offer.sell),offer.sell,3600));
            updates.push({tradeId:order.tradeId,phase:'listed',paid,sell:offer.sell});
          }catch(error){updates.push({tradeId:order.tradeId,phase:'won-unlisted',paid,warning:`Won ${order.name}, but listing failed: ${error.message} Check New Items.`});}
          continue;
        }
        if(data?.isClosedTrade?.()||data?.isExpired?.()){updates.push({tradeId:order.tradeId,phase:'lost'});continue;}
        if(data?.isHighestBid?.()){updates.push({tradeId:order.tradeId,phase:'highest',bid:paid,seconds,misses:0});continue;}
        if(!Number.isFinite(seconds)||seconds<=0){updates.push({tradeId:order.tradeId,phase:'pending',misses:0});continue;}
        if(Number(data?.currentBid)<=Number(order.lastBid)){updates.push({tradeId:order.tradeId,phase:'pending',misses:0});continue;}
        const nextBid=Number(data?.currentBid)>0?UTCurrencyInputControl.getIncrementAboveVal(Number(data.currentBid)):Number(data?.startingBid);
        let result=fresh.get(order.definitionId);
        try{
          if(!result){result=await searchMarket(marketCriteria(order.definitionId));fresh.set(order.definitionId,result);}
          const offer=quote(result.data?.items||[],order.definitionId,order.tradeId,order.futbinPrice,nextBid);
          const available=coinBalance();
          if(!offer||!Number.isSafeInteger(nextBid)||nextBid<150||nextBid>available||Number.isSafeInteger(order.researchBidCeiling)&&nextBid>order.researchBidCeiling||!data?.canBid?.(nextBid,available))updates.push({tradeId:order.tradeId,phase:'outbid-cap'});
          else{await observe(services.Item.bid(item,nextBid));updates.push({tradeId:order.tradeId,phase:'bid',bid:nextBid,sell:offer.sell,reference:offer.reference,seconds,quoteAt:Date.now(),misses:0});}
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
    const snapshot=()=>({id:challenge.id,name:challenge.name,formation:squad.getFormation()?.displayName,slots:slots.map(s=>({index:s.index,position:s.generalPositionName,name:s.item?.isValid?.()?String(s.item.definitionId):null,concept:!!s.item?.concept})),fingerprint:slots.map(s=>`${s.index}:${s.item?.id}:${s.item?.definitionId}:${!!s.item?.concept}`).join('|')});
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
      try{response=await observe(services.Item.bid(item,price));}
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
  } catch(error) { return {ok:false,error:error.message,status:error.status??null,stage:error.stage??null,page:error.page??null,unmatchedPlayer:error.unmatchedPlayer??null}; }
}
