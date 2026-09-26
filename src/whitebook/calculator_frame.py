"""Fixed calculator bridge, served in an opaque-origin sandbox, not the PDF realm."""

BRIDGE = r"""
let calculator;
const checks = {scriptLoaded:false,constructorAvailable:false,instanceCreated:false,stateReadable:false,usableSize:false};
const send = (type, payload) => parent.postMessage({whitebookCalculator:true,type,payload}, '*');
window.addEventListener('message', async (event) => {
  if (event.source !== parent || event.data?.type !== 'initialize' || calculator) return;
  const {scriptUrl,options,state} = event.data;
  if (!/^https:\/\/www\.desmos\.com\/api\/v1\.12\/calculator\.js\?apiKey=[A-Za-z0-9%_.~-]+$/.test(scriptUrl)) return;
  try {
    await new Promise((resolve,reject) => {
      const script=document.createElement('script');
      const timeout=setTimeout(()=>reject(new Error('timeout')),20000);
      script.onload=()=>{clearTimeout(timeout);resolve()};
      script.onerror=()=>{clearTimeout(timeout);reject(new Error('load'))};
      script.src=scriptUrl;document.head.append(script);
    });
    checks.scriptLoaded=true;
    checks.constructorAvailable=typeof Desmos?.GraphingCalculator === 'function';
    calculator=Desmos.GraphingCalculator(document.getElementById('calculator'),options);
    checks.instanceCreated=!!calculator;
    if (state) calculator.setState(state);
    checks.stateReadable=!!calculator.getState();
    const rect=document.getElementById('calculator').getBoundingClientRect();
    checks.usableSize=rect.width>=480 && rect.height>=280;
    calculator.observeEvent('change',()=>send('state',calculator.getState()));
    send('ready', checks);
    send('state', calculator.getState());
  } catch {send('ready', checks);}
});
"""


def frame_html(nonce: str) -> str:
    return f'<!doctype html><html><head><meta charset="utf-8"><style>html,body,#calculator{{margin:0;width:100%;height:100%;overflow:hidden}}</style></head><body><div id="calculator"></div><script nonce="{nonce}">{BRIDGE}</script></body></html>'
