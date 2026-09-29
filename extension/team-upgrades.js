export function rankTeamUpgrades(options,signals={}){
  return (options||[]).filter(item=>Number.isFinite(item.chemistryChange)&&item.chemistryChange>=0&&Number.isFinite(item.slotChemistryChange)&&item.slotChemistryChange>=0&&item.rating>=75&&(Number.isFinite(item.futbinRating)&&item.futbinRating>=75||item.source==='FUT.GG'&&Number.isInteger(item.metaRank)&&item.metaRank>=1&&item.metaRank<=30))
    .map(item=>{
      const signal=signals[item.assetId]||{};
      const votes=Number(signal.positive)+Number(signal.negative);
      const approval=Number.isSafeInteger(signal.positive)&&Number.isSafeInteger(signal.negative)&&votes>=10?Math.round(100*signal.positive/votes):null;
      const games=Number.isSafeInteger(signal.games)?signal.games:null;
      const fit=item.source==='FUT.GG'?100-(item.metaRank-1)*1.25:item.futbinRating;
      const score=fit*10+item.chemistryChange*30+item.slotChemistryChange*20+(approval===null?0:(approval-50)*.25)+Math.log10(1+(games||0))*2-Math.log10(Math.max(500,item.estimatedPrice||item.price))*8;
      return {...item,approval,votes:approval===null?null:votes,games,score:Math.round(score)};
    }).sort((a,b)=>Number(b.source==='FUT.GG')-Number(a.source==='FUT.GG')||b.score-a.score||a.price-b.price);
}
