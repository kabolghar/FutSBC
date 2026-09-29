import {openOverlay} from './panel-overlay.js';
import {isEaWebAppURL} from './ea-url.js';
async function launch(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id&&!tab.url) throw Error('Allow FutSBC access to this EA site in Chrome extension settings, refresh the page, then try again.');
  if(!tab?.id||!isEaWebAppURL(tab.url)) throw Error('Open the FC 27 Web App tab, then click FutSBC again.');
  await chrome.scripting.executeScript({target:{tabId:tab.id},func:openOverlay});
  window.close();
}
const retry=document.getElementById('retry');
retry.onclick=()=>launch().catch(showError);
function showError(error){document.getElementById('status').textContent=error.message;retry.hidden=false;}
launch().catch(showError);
