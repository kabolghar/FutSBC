import {readFutbin} from './futbin.js';
const pathKey=value=>decodeURI(new URL(value).pathname).replace(/\/$/,'');
export async function readFutbinTab(api,tabId,expectedURL,lookupId=null,{attempts=75,partialChecks=5,delay=()=>new Promise(resolve=>setTimeout(resolve,400))}={}) {
  let reason='The page did not reach the requested FUTBIN address.';
  let incompleteChecks=0;
  let verificationPending=false;
  for(let attempt=0;attempt<attempts;attempt++) {
    const tab=await api.tabs.get(tabId);
    if(tab.url && new URL(tab.url).origin==='https://www.futbin.com' && pathKey(tab.url)===pathKey(expectedURL)) {
      // FUTBIN's ads can keep the tab loading after the squad is already usable.
      // Inspect the DOM regardless of Chrome's complete/loading flag.
      let result;
      try {
        const entries=await api.scripting.executeScript({target:{tabId},func:readFutbin,args:[lookupId,expectedURL]});
        result=entries[0]?.result;
      } catch(error) {
        reason=`The page changed while it was being read: ${error.message}`;
      }
      if(result?.kind) return result;
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
