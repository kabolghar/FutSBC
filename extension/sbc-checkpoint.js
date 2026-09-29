import {validatePlan} from './core.js';

// Only failed comparisons are resumed. Re-read the listing and retain a squad
// only while its original price check is fresh; never advance its timestamp.
export function resumeComparison(checkpoint,challengeId,solutions,slots,now=Date.now()) {
  const entries=[],plans=[],urls=new Set();
  if(checkpoint?.challengeId!==challengeId)return {entries,plans,urls};
  const listed=new Map(solutions.map(solution=>[solution.url,solution]));
  for(const entry of checkpoint.entries||[]){
    try{
      const solution=listed.get(entry.url),plan=validatePlan(entry.plan,now);
      if(!solution||solution.consolePrice!==entry.consolePrice||urls.has(entry.url))continue;
      if(plan.challengeId!==challengeId||plan.url!==entry.url)continue;
      if(slots?.length&&(plan.players.length!==slots.length||new Set(plan.players.map(player=>player.futbinSlot)).size!==slots.length))continue;
      entries.push(entry);plans.push(plan);urls.add(entry.url);
    }catch{/* Invalid or expired entries must be read again. */}
  }
  return {entries,plans,urls};
}
