import {readFutbin} from './futbin.js';
const pathKey=value=>decodeURI(new URL(value).pathname).replace(/\/$/,'');
export async function readFutbinTab(api,tabId,expectedURL,lookupId=null,{attempts=75,partialChecks=25,delay=()=>new Promise(resolve=>setTimeout(resolve,400))}={}) {
  let reason='The page did not reach the requested FUTBIN address.';
  let incompleteChecks=0,blankChecks=0,reloaded=false;
  let verificationPending=false;
  for(let attempt=0;attempt<attempts;attempt++) {
    const tab=await api.tabs.get(tabId);
    const actual=tab.url?new URL(tab.url):null;
    // The EA lookup endpoint may redirect to the SBC group. Allow only the
    // same-season discovery pages; the parser still matches the exact EA ID.
    const lookupRedirect=lookupId!==null&&actual?.origin==='https://www.futbin.com'&&(
      /^\/27\/squad-building-challenge\/\d+\/?$/.test(actual.pathname)||
      new RegExp(`^/27/squad-building-challenges/[^/]+/${lookupId}/[^/]+/?$`).test(actual.pathname));
    if(actual?.origin==='https://www.futbin.com' && (pathKey(tab.url)===pathKey(expectedURL)||lookupRedirect)) {
      // FUTBIN's ads can keep the tab loading after the squad is already usable.
      // Inspect the DOM regardless of Chrome's complete/loading flag.
      let result;
      try {
        const entries=await api.scripting.executeScript({target:{tabId},func:readFutbin,args:[lookupId,lookupRedirect?tab.url:expectedURL]});
        result=entries[0]?.result;
      } catch(error) {
        reason=`The page changed while it was being read: ${error.message}`;
      }
      if(result?.pageUnavailable){const error=Error(result.error);error.pageUnavailable=true;throw error;}
      if(result?.blankPage){
        if(++blankChecks>=8){
          if(!reloaded){reloaded=true;blankChecks=0;await api.tabs.update(tabId,{url:expectedURL});}
          else {const error=Error('FUTBIN returned an empty document after retrying.');error.pageUnavailable=true;throw error;}
        }
      }else blankChecks=0;
      if(result?.kind&&!(result.kind==='comparison'&&result.unpricedCount>0)) return result;
      if(result?.kind==='comparison') reason=`Waiting for console prices for ${result.unpricedCount} listed squads.`;
      if(result?.verification||result?.blocked&&/verification|checking this browser/i.test(result.error||'')){
        // A normal browser navigation may complete FUTBIN's automatic check.
        // Keep the temporary tab in the background; never interact with a challenge.
        verificationPending=true;
        reason='FUTBIN is checking this browser.';
      }else{
        verificationPending=false;
        if(result?.error) reason=result.error;
        if(result?.blocked)throw Error(result.error||'FUTBIN blocked this page.');
      }
      if(result?.incompleteSquad){
        if(++incompleteChecks>=partialChecks){
          const error=Error(`Incomplete FUTBIN squad: ${result.error}`);
          error.incompleteSquad=true;
          throw error;
        }
      }else{
        incompleteChecks=0;
      }
    }
    if(attempt<attempts-1)await delay();
  }
  if(verificationPending){
    const error=Error('FUTBIN blocked access to this page. No squad changes were made. Try again later.');
    error.verificationBlocked=true;
    error.pageURL=expectedURL;
    throw error;
  }
  throw Error(`Could not read FUTBIN: ${reason} Page: ${expectedURL}`);
}
