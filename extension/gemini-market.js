export function normalizeGeminiKey(value){
  const key=String(value??'').trim();
  if(!key)return '';
  if(key.length>2048||/[\s\x00-\x1f\x7f]/.test(key)||/^https?:\/\//i.test(key)){
    throw Error('Paste only the Google AI Studio API key, without a URL or spaces.');
  }
  return key;
}

export function geminiRequestError(status){
  if(status===400)return 'Google rejected the Gemini request (400). Check that this is a Google AI Studio key and the model is available.';
  if(status===401||status===403)return 'Google rejected this API key. Check that it belongs to Google AI Studio and has Gemini API access.';
  if(status===404)return 'This Gemini model is unavailable for the key or project. Try again after checking model access.';
  if(status===429)return 'Gemini has reached its current quota. Try again after the quota resets.';
  if(status>=500)return 'Gemini is temporarily unavailable. Try again later.';
  return `Gemini request failed (${status}). Try again later.`;
}
