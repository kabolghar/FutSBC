export const MAX_AGE = 5 * 60 * 1000;
export function coins(value) {
  const match = String(value ?? '').trim().replaceAll(',', '').match(/^(\d+(?:\.\d+)?)\s*([km])?$/i);
  if (!match) return null;
  const n = Number(match[1]) * ({k: 1000, m: 1000000}[match[2]?.toLowerCase()] || 1);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
export function futbinURL(value, kind = 'any') {
  const u = new URL(value);
  if (u.origin !== 'https://www.futbin.com' || u.username || u.password) throw Error('Use a https://www.futbin.com FC 27 link.');
  const pattern = kind === 'solution' ? /^\/27\/squad\/\d+\/sbc\/?$/ : /^\/27\/squad-building-challenges\/[^/]+\/\d+\/[^/]+\/?$/;
  if (!pattern.test(u.pathname)) throw Error(kind === 'solution' ? 'Use an FC 27 SBC solution link.' : 'Open an SBC on FUTBIN, click Completed Challenges, and paste that link.');
  return u.href;
}
export function rankSolutions(solutions) {
  return solutions.filter(s => Number.isSafeInteger(s.consolePrice) && s.consolePrice > 0).sort((a,b) => a.consolePrice-b.consolePrice || a.url.localeCompare(b.url));
}
export function validatePlan(plan, now = Date.now()) {
  validateSavedPlan(plan);
  if (!Number.isFinite(plan.checkedAt) || now-plan.checkedAt > MAX_AGE || plan.checkedAt > now+1000) throw Error('Prices are stale. Compare again before continuing.');
  return plan;
}
// Saved identities can be reused when the next action obtains fresh EA prices
// or revalidates the squad. This does not refresh the original price timestamp.
export function validateSavedPlan(plan) {
  if (!plan || plan.year !== 27 || plan.market !== 'console') throw Error('An FC 27 console squad is required.');
  if (!Number.isInteger(plan.challengeId) || plan.challengeId < 1) throw Error('Missing challenge ID.');
  if(!['club','hybrid'].includes(plan.source))futbinURL(plan.url, 'solution');
  if (!Array.isArray(plan.players) || !plan.players.length || plan.players.length > 11) throw Error('Invalid squad size.');
  const ids = new Set();
  for (const p of plan.players) {
    if(plan.source==='hybrid'&&(!Number.isSafeInteger(p.definitionId)||p.definitionId<1||typeof p.owned!=='boolean'))throw Error('Hybrid card identity or ownership is missing.');
    if (!Number.isSafeInteger(p.baseId) || p.baseId < 1 || !Number.isInteger(p.rating) || p.rating < 1 || p.rating > 99 || !Number.isInteger(p.rarity) || p.rarity < 0 || !Number.isSafeInteger(p.price) || ((plan.source==='club'||plan.source==='hybrid'&&p.owned===true)?p.price!==0||p.owned!==true||!Number.isSafeInteger(p.ownedId)||p.ownedId<1||!Number.isSafeInteger(p.definitionId)||p.definitionId<1:p.price<=0) || !p.name || ids.has(p.baseId)) throw Error('A player identity or console price could not be verified.');
    ids.add(p.baseId);
  }
  if (plan.total !== plan.players.reduce((sum,p)=>sum+p.price,0)) throw Error('Squad total does not match player prices.');
  return plan;
}
export function validateMapping(players, slots, mapping) {
  if (players.length !== slots.length || mapping.length !== players.length || new Set(mapping).size !== mapping.length || mapping.some(i=>!slots.some(s=>s.index===i))) throw Error('Assign each player to one unique SBC slot.');
  return mapping;
}

export function suggestMapping(players, slots) {
  if(!Array.isArray(players)||!Array.isArray(slots)||players.length!==slots.length) throw Error('The FUTBIN squad and EA SBC have different slot counts.');
  const available=[...slots].sort((a,b)=>a.index-b.index);
  const ordered=[...players].sort((a,b)=>a.futbinSlot-b.futbinSlot);
  if(ordered.every((p,i)=>p.slotPosition && p.slotPosition===available[i].position)) {
    const bySlot=new Map(ordered.map((p,i)=>[p.futbinSlot,available[i].index]));
    return players.map(p=>bySlot.get(p.futbinSlot));
  }
  return players.map(player=>{
    const expected=player.slotPosition||player.position;
    const matching=available.findIndex(slot=>slot.position===expected);
    const [slot]=available.splice(matching<0?0:matching,1);
    return slot.index;
  });
}

export function comparisonCandidates(solutions, mode = 'quick') {
  const unique = [...new Map(rankSolutions(solutions).map(s => [s.url, s])).values()];
  return mode === 'full' ? unique : unique.slice(0, 5);
}
export function challengeLookupURL(challenge) {
  if (!Number.isSafeInteger(challenge?.id) || challenge.id < 1 || !challenge.name) throw Error('Connect to an open EA SBC first, or paste a FUTBIN link.');
  return `https://www.futbin.com/27/squad-building-challenge/ea/${challenge.id}/${encodeURIComponent(challenge.name)}`;
}
