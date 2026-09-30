import { currentSession, failure, json, noStore, type AccountEnv } from "./accounts";

type MathToolsEnv = AccountEnv & {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DESMOS_API_KEY?: string;
};

const REFERENCE_ASSET_PATH = "/assets/reference-sheet.png";
const REFERENCE_API_PATH = "/api/math/reference-sheet.png";
const CALCULATOR_CONFIG_PATH = "/api/math/calculator-config";
const CALCULATOR_FRAME_PATH = "/app/calculator-frame";

const BRIDGE = `
let calculator;
const checks={scriptLoaded:false,constructorAvailable:false,instanceCreated:false,stateReadable:false,usableSize:false};
const send=(type,payload)=>parent.postMessage({whitebookCalculator:true,type,payload},'*');
window.addEventListener('message',async(event)=>{
  if(event.source!==parent||event.data?.type!=='initialize'||calculator)return;
  const {scriptUrl,options,state}=event.data;
  const scriptPrefix='https://www.desmos.com/api/v1.12/calculator.js?apiKey=';
  if(typeof scriptUrl!=='string'||!scriptUrl.startsWith(scriptPrefix)||!/^[A-Za-z0-9%_.~-]+$/.test(scriptUrl.slice(scriptPrefix.length)))return;
  try{
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timeout=setTimeout(()=>reject(new Error('timeout')),20000);
      script.onload=()=>{clearTimeout(timeout);resolve()};
      script.onerror=()=>{clearTimeout(timeout);reject(new Error('load'))};
      script.src=scriptUrl;document.head.append(script);
    });
    checks.scriptLoaded=true;
    checks.constructorAvailable=typeof Desmos?.GraphingCalculator==='function';
    calculator=Desmos.GraphingCalculator(document.getElementById('calculator'),options);
    checks.instanceCreated=!!calculator;
    if(state)calculator.setState(state);
    checks.stateReadable=!!calculator.getState();
    const rect=document.getElementById('calculator').getBoundingClientRect();
    checks.usableSize=rect.width>=240&&rect.height>=200;
    calculator.observeEvent('change',()=>send('state',calculator.getState()));
    send('ready',checks);send('state',calculator.getState());
  }catch{send('ready',checks)}
});`;

function privateHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(noStore);
  new Headers(extra).forEach((value, name) => headers.set(name, value));
  return headers;
}

function calculatorFrame(): Response {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#calculator{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="calculator"></div><script nonce="${nonce}">${BRIDGE}</script></body></html>`;
  const headers = privateHeaders({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' https://www.desmos.com; style-src 'unsafe-inline' https://www.desmos.com; connect-src https://*.desmos.com wss://*.desmos.com; img-src 'self' data: blob: https://*.desmos.com; font-src 'self' data: https://*.desmos.com; frame-src https://*.desmos.com; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
  });
  return new Response(html, { status: 200, headers });
}

async function calculatorConfig(request: Request, env: MathToolsEnv): Promise<Response> {
  if (!(await currentSession(request, env)))
    return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const key = env.DESMOS_API_KEY?.trim();
  if (!key) return json({ configured: false, scriptUrl: null });
  return json({ configured: true,
    scriptUrl: `https://www.desmos.com/api/v1.12/calculator.js?apiKey=${encodeURIComponent(key)}` });
}

async function referenceSheet(request: Request, env: MathToolsEnv): Promise<Response> {
  if (!(await currentSession(request, env)))
    return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const asset = await env.ASSETS.fetch(new Request(new URL(REFERENCE_ASSET_PATH, request.url), { method: "GET" }));
  if (!asset.ok) return failure(503, "math_resource_unavailable", "The Math Reference Sheet is unavailable. Try again.");
  return new Response(asset.body, {
    status: 200,
    headers: privateHeaders({ "Content-Type": "image/png", "Cross-Origin-Resource-Policy": "same-origin" }),
  });
}

export function mathToolsRoute(request: Request, env: MathToolsEnv): Promise<Response> | null {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === CALCULATOR_FRAME_PATH) return Promise.resolve(calculatorFrame());
  if (request.method === "GET" && pathname === CALCULATOR_CONFIG_PATH) return calculatorConfig(request, env);
  if (request.method === "GET" && pathname === REFERENCE_API_PATH) return referenceSheet(request, env);
  return null;
}
