import {openOverlay} from './panel-overlay.js';
const EA='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
async function launch(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!tab.url?.startsWith(EA)) throw Error('Open the FC 27 Web App tab, then click FutSBC again.');
  await chrome.scripting.executeScript({target:{tabId:tab.id},func:openOverlay});
  window.close();
}
const retry=document.getElementById('retry');
retry.onclick=()=>launch().catch(showError);
function showError(error){document.getElementById('status').textContent=error.message;retry.hidden=false;}
launch().catch(showError);
