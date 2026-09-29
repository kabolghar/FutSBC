// Link searches supplement the general meta pool; a shared badge is not quality evidence.
export function teamLinkPages(budget,anchors=[]){
  const filters=new Map();
  for(const anchor of anchors)for(const [field,param] of [['nationId','nation'],['leagueId','league'],['clubId','club']]){
    const id=Number(anchor[field]);if(Number.isSafeInteger(id)&&id>0)filters.set(`${param}:${id}`,{param,id});
  }
  return [...filters.values()].slice(0,9).flatMap(({param,id})=>[1,2].map(page=>`https://www.futbin.com/27/players?${param}=${id}&ps_price=0-${budget}&page=${page}`));
}
export function teamCandidatePool(general,linked=[],limit=48){
  const quality=linked.filter(card=>card.rating>=80&&card.futbinRating>=80).sort((a,b)=>b.futbinRating-a.futbinRating||b.rating-a.rating||a.price-b.price);
  const result=new Map();
  const merit=card=>card.source==='FUT.GG'?100/(1+(card.metaRank-1)/40):Number(card.futbinRating)||0;
  const ranked=[...general].sort((a,b)=>merit(b)-merit(a)||b.rating-a.rating);
  for(const card of [...quality.slice(0,16),...ranked,...quality]){
    const key=card.definitionId||card.assetId;
    if(!result.has(key))result.set(key,card);
    if(result.size>=limit)break;
  }
  return [...result.values()];
}

export function linkedTeamOptions(options,anchors,limit=48){
  const score=card=>anchors.reduce((sum,anchor)=>sum+['leagueId','nationId','clubId'].filter(key=>Number(anchor[key])>0&&Number(card[key])===Number(anchor[key])).length,0);
  const quality=card=>card.rating>=80&&(card.futbinRating>=80||card.source==='FUT.GG'&&card.metaRank>=1&&card.metaRank<=120);
  const linked=options.filter(card=>quality(card)&&score(card)>0).sort((a,b)=>score(b)-score(a)||b.rating-a.rating);
  return [...new Map([...linked.slice(0,16),...options].map(card=>[card.definitionId,card])).values()].slice(0,limit);
}
