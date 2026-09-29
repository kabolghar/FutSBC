// Self-contained for chrome.scripting.executeScript in Arc and other browsers
// without Chrome's native sidePanel API.
export function openOverlay({initiallyOpen=true,replace=true}={}) {
  const id='futsbc-companion-panel';
  const previous=document.getElementById(id);
  // A previous iframe may have a dead runtime after an extension reload.
  if(previous&&!replace)return;
  if(previous){previous.dispatchEvent(new Event('futsbc-dispose'));previous.remove();}

  const host=document.createElement('div');
  host.id=id;
  host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');
  style.textContent=`
    :host{all:initial}
    *{box-sizing:border-box}
    [hidden]{display:none!important}
    button{font-family:system-ui,sans-serif;cursor:pointer}
    button:focus-visible{outline:2px solid oklch(81% .12 58);outline-offset:2px}
    .launcher{position:fixed;right:12px;bottom:12px;width:42px;height:42px;border:1px solid oklch(81% .12 58);border-radius:6px;background:oklch(81% .12 58);color:oklch(20% .025 166);box-shadow:0 5px 16px oklch(7% .005 115 / .42);font-size:23px;font-weight:900;pointer-events:auto}
    .launcher:hover{background:oklch(87% .095 58)}
    .backdrop{position:fixed;inset:0;background:oklch(7% .015 166 / .65);pointer-events:auto}
    .modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 24px));height:390px;max-height:calc(100dvh - 24px);overflow:hidden;border:1px solid oklch(37% .022 166);border-radius:12px;background:oklch(20% .025 166);box-shadow:0 16px 48px oklch(7% .005 115 / .55);pointer-events:auto}
    .modal[data-view="lineup"]{width:min(760px,calc(100vw - 40px))}
    .modal[data-view="trader"]{width:min(600px,calc(100vw - 40px))}
    .modal[data-view="market"]{width:min(820px,calc(100vw - 40px))}
    .modal[data-view="team"]{width:min(820px,calc(100vw - 40px))}
    .modal:focus{outline:none}
    .close{position:absolute;top:23px;right:12px;z-index:1;width:36px;height:36px;border:1px solid oklch(34% .014 115);border-radius:8px;background:oklch(25% .024 166);color:oklch(92% .012 105);font-size:20px;line-height:1}
    .close:hover{border-color:oklch(81% .12 58)}
    iframe{display:block;width:100%;height:100%;border:0;background:oklch(20% .025 166)}
    @media(max-width:480px){.modal,.modal[data-view="lineup"],.modal[data-view="trader"],.modal[data-view="market"],.modal[data-view="team"]{width:calc(100vw - 12px);max-height:calc(100dvh - 12px)}}
  `;

  const launcher=document.createElement('button');
  launcher.className='launcher';
  launcher.type='button';
  launcher.textContent='F';
  launcher.title='Open FutSBC';
  launcher.setAttribute('aria-label','Open FutSBC menu');

  const backdrop=document.createElement('div');
  backdrop.className='backdrop';
  backdrop.setAttribute('aria-hidden','true');

  const modal=document.createElement('div');
  modal.className='modal';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label','FutSBC menu');
  modal.tabIndex=-1;
  const close=document.createElement('button');
  close.className='close';
  close.type='button';
  close.textContent='×';
  close.setAttribute('aria-label','Collapse FutSBC to icon');
  const frame=document.createElement('iframe');
  frame.src=chrome.runtime.getURL('panel.html');
  frame.title='FutSBC companion menu';
  modal.append(frame,close);
  shadow.append(style,launcher,backdrop,modal);
  document.body.append(host);

  function setOpen(open,focus=true){
    launcher.hidden=open;
    backdrop.hidden=!open;
    modal.hidden=!open;
    if(focus){if(open)modal.focus();else launcher.focus();}
  }
  launcher.addEventListener('click',()=>setOpen(true));
  close.addEventListener('click',()=>setOpen(false));
  backdrop.addEventListener('click',()=>setOpen(false));
  const onKeyDown=event=>{if(event.key==='Escape'&&!modal.hidden)setOpen(false);};
  const panelOrigin=new URL(frame.src).origin;
  const onSize=event=>{
    if(event.source!==frame.contentWindow||event.origin!==panelOrigin||event.data?.type!=='futsbc-panel-size')return;
    modal.dataset.view=['menu','lineup','trader','market','team'].includes(event.data.view)?event.data.view:event.data.hasResult?'lineup':'menu';
    modal.setAttribute('aria-label',modal.dataset.view==='trader'?'FutSBC auto trader':modal.dataset.view==='market'?'FutSBC market brief':modal.dataset.view==='team'?'FutSBC team upgrades':'FutSBC menu');
    const height=Number(event.data.height);
    if(Number.isFinite(height))modal.style.height=`${Math.max(220,Math.min(Math.ceil(height),window.innerHeight-24))}px`;
  };
  document.addEventListener('keydown',onKeyDown);
  window.addEventListener('message',onSize);
  host.addEventListener('futsbc-dispose',()=>{document.removeEventListener('keydown',onKeyDown);window.removeEventListener('message',onSize);});
  setOpen(initiallyOpen,initiallyOpen);
}
