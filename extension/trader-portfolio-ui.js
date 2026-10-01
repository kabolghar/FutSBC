const fmt=value=>new Intl.NumberFormat('en-US').format(value);
const signed=value=>`${value>0?'+':''}${fmt(value)}`;
export function renderPortfolio(root,portfolio){
 if(!root)return;
 const expanded=root.querySelector('details')?.open||false;
 root.replaceChildren();
 const data=portfolio||{activity:[]};
 const node=(tag,text,className='')=>{const element=document.createElement(tag);element.textContent=text;element.className=className;return element;};
 const details=node('details',''),summary=node('summary',`Trade history · ${data.sales||0} sold`);
 details.open=expanded;
 details.append(summary);
 const metrics=node('div','','portfolio-facts');
 for(const [label,value] of [['In cards',fmt(data.inventoryCost||0)],['Confirmed net',signed(data.realized||0)],['Largest drawdown',fmt(data.maxDrawdown||0)],['Observed sale time',data.averageSellMinutes===null||data.averageSellMinutes===undefined?'No sales yet':`~${data.averageSellMinutes} min`]]){
  const fact=node('div','');fact.append(node('span',label),node('strong',value));metrics.append(fact);
 }
 details.append(metrics);
 const list=node('ul','','portfolio-activity');list.setAttribute('aria-label','Automatic trade outcomes');
 for(const record of data.activity||[]){
  const row=node('li',''),identity=node('div','');identity.append(node('strong',record.name||'Player'),node('small',`Bought ${fmt(record.buy)}${record.soldAt?` · sold ${fmt(record.sale)}`:` · listed ${fmt(record.sell)}`}`));
  const state=record.soldAt?signed(record.profit):record.state==='expired'?'Unsold':record.state==='unverified'?'Unverified':'Listed';
  row.append(identity,node('span',state,record.soldAt&&record.profit<0?'portfolio-loss':''));list.append(row);
 }
 if(!list.children.length)details.append(node('p','Confirmed sales will appear here.','field-note'));else details.append(list);
 details.append(node('p',`${data.pending||0} pending · ${data.expired||0} unsold · ${data.unverified||0} unverified`,'field-note'));
 root.append(details);
}
