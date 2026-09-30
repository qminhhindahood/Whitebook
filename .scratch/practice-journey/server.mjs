import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { build } from '../../hosted/node_modules/esbuild/lib/main.js';
const root = resolve(import.meta.dirname, '../..');
await build({ entryPoints: [resolve(root,'hosted/src/worker.ts')], outfile: resolve(import.meta.dirname,'worker.mjs'), bundle:true, platform:'node', format:'esm', logLevel:'error' });
const {default:worker} = await import('./worker.mjs');
const db = new DatabaseSync(':memory:');
for (const file of readdirSync(resolve(root,'hosted/migrations')).sort()) db.exec(readFileSync(resolve(root,'hosted/migrations',file),'utf8'));
db.exec('PRAGMA foreign_keys=ON');
const privateRoot = 'D:/Notion/worktrees/whitebook-ticket-04/hosted/.publication';
db.exec(readFileSync(resolve(privateRoot,'prepared/publication.sql'),'utf8'));
if(existsSync(resolve(privateRoot,'deck-import.sql'))) db.exec(readFileSync(resolve(privateRoot,'deck-import.sql'),'utf8'));
const token=randomBytes(32).toString('hex'), csrf=randomBytes(32).toString('hex');
const hash=s=>createHash('sha256').update(s).digest('hex');
db.prepare("INSERT INTO learner_accounts (id,provider,provider_subject,email,display_name,created_at) VALUES ('journey','google','local-journey','journey@example.invalid','Local Verification',0)").run();
db.prepare('INSERT INTO learner_sessions VALUES (?,?,?,?,0)').run(hash(token),'journey',hash(csrf),Math.floor(Date.now()/1000)+86400);
const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return {results:db.prepare(sql).all(...args),meta:{rows_read:0,rows_written:0}}},async run(){const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes),rows_read:0,rows_written:Number(r.changes)}}}}},async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}};
const origin='http://localhost:8799';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.ttf':'font/ttf','.woff2':'font/woff2'};
const env={DB,APP_ORIGIN:origin,AI_RELEASE_ENABLED:'true',ASSETS:{async fetch(req){let path=new URL(req.url).pathname;if(path==='/app')path='/app.html';const file=resolve(import.meta.dirname,'dist','.'+path);if(!file.startsWith(resolve(import.meta.dirname,'dist'))||!existsSync(file))return new Response(null,{status:404});return new Response(readFileSync(file),{headers:{'Content-Type':types[extname(file)]??'application/octet-stream'}})}}};
createServer(async(req,res)=>{try{
 if(req.url==='/__local_test_login'){res.writeHead(302,{'Location':'/dashboard','Set-Cookie':[`__Host-wb_session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax`,`__Host-wb_csrf=${csrf}; Path=/; Secure; SameSite=Lax`]});res.end();return;}
 const parts=[];for await(const p of req)parts.push(p);const body=Buffer.concat(parts);
 const response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:req.headers,...(body.length?{body}: {})}),env);
 if(req.url.startsWith('/api/attempts')) console.log(req.method,req.url,response.status);
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(e){console.error(e.message);res.writeHead(500);res.end('Local harness error')}}).listen(8799,'127.0.0.1',()=>console.log('Local isolated learner ready at http://localhost:8799/__local_test_login'));

