export const MARKET_TAX_RATE=0.05;

export function coins(value,{allowZero=false}={}) {
  const raw=String(value??'').trim().replace(/[ ,]/g,'');
  if(!/^\d+$/.test(raw))throw Error('Enter whole coin amounts.');
  const amount=Number(raw);
  if(!Number.isSafeInteger(amount)||amount<(allowZero?0:1))throw Error('Enter a valid coin amount.');
  return amount;
}

export function tradeMath(buyPrice,sellPrice,minimumProfit=0) {
  const buy=coins(buyPrice);
  const sell=coins(sellPrice);
  const target=coins(minimumProfit,{allowZero:true});
  const netSale=Number(BigInt(sell)*95n/100n);
  const profit=netSale-buy;
  return {
    buy,sell,target,
    tax:sell-netSale,
    netSale,
    profit,
    maxBuy:Math.max(0,netSale-target),
    breakEvenSale:Number((BigInt(buy)*100n+94n)/95n),
    meetsTarget:profit>=target&&profit>0
  };
}

export function rankQuotes(quotes) {
  return quotes.map(quote=>({...quote,math:tradeMath(quote.buy,quote.sell,quote.target)}))
    .sort((a,b)=>Number(b.math.meetsTarget)-Number(a.math.meetsTarget)||b.math.profit-a.math.profit||a.name.localeCompare(b.name));
}

function csvFields(line) {
  const fields=[];
  let field='',quoted=false;
  for(let index=0;index<line.length;index++){
    const char=line[index];
    if(char==='"'){
      if(quoted&&line[index+1]==='"'){field+='"';index++;}
      else quoted=!quoted;
    }else if(char===','&&!quoted){fields.push(field.trim());field='';}
    else field+=char;
  }
  if(quoted)throw Error('A quote is not closed.');
  fields.push(field.trim());
  return fields;
}

export function parseQuotes(text,minimumProfit=0) {
  const target=coins(minimumProfit,{allowZero:true});
  const quotes=[];
  for(const [index,raw] of String(text).split(/\r?\n/).entries()){
    if(!raw.trim())continue;
    const fields=csvFields(raw);
    if(index===0&&/^(player|name)$/i.test(fields[0])&&/^buy$/i.test(fields[1])&&/^sell$/i.test(fields[2]))continue;
    if(fields.length!==3||!fields[0])throw Error(`Line ${index+1}: use player, buy, sell.`);
    try{
      const buy=coins(fields[1]),sell=coins(fields[2]);
      quotes.push({name:fields[0].slice(0,80),buy,sell,target});
    }catch(error){throw Error(`Line ${index+1}: ${error.message}`);}
  }
  if(!quotes.length)throw Error('Paste at least one player, buy, sell row.');
  return quotes;
}
