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

import assert from 'node:assert/strict';
async function call(path,body,method=body===undefined?'GET':'POST',expected=path==='/api/attempts'&&method==='POST'?201:200){
 const response=await worker.fetch(new Request(origin+path,{method,headers:{Cookie:`__Host-wb_session=${token}; __Host-wb_csrf=${csrf}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
 if(response.status!==expected) throw new Error(`${method} ${path}: ${response.status}: ${await response.text()}`);
 return response.headers.get('content-type')?.includes('json')?response.json():response.arrayBuffer();
}
let visuals=0, typed=0;
const packages=(await call('/api/library')).packages;
assert.equal(packages.length,5);
for(const pkg of packages){
 const rows=db.prepare('SELECT * FROM publication_questions WHERE revision_id=? ORDER BY ordinal').all(pkg.revisionId);
 const section=rows[0].section;
 for(const kind of ['practice','section_exam']){
  let a=await call('/api/attempts',kind==='practice'?{revisionId:pkg.revisionId,section,modules:[...new Set(rows.map(r=>r.module))],count:2,ordering:'source',timing:{mode:'custom',durationSeconds:600}}:{revisionId:pkg.revisionId,section,kind});
  const id=a.attemptId;
  for(const q of a.questions){
   const p=(await call(`/api/library/${pkg.revisionId}/questions/${q.questionId}`)).presentation;
   for(const b of [...p.stimulus,...p.stem,...p.choices.flatMap(c=>c.content)]){
    if(b.kind==='image_asset'){await call(`/content/${pkg.revisionId}/${q.questionId}/${b.assetId}.png`);visuals++;}
    if(b.kind==='asset'){await call(b.src);visuals++;}
   }
  }
  a=await call(`/api/attempts/${id}/start`,{});let editor=a.editorToken;const deadline=a.deadlineAt;
  async function action(name,extra={}){a=await call(`/api/attempts/${id}/${name}`,{editorToken:editor,expectedStateVersion:a.stateVersion,...extra});}
  const q=a.questions[0], response=q.responseType==='student_produced_response'?'2':q.choiceIds[0];
  await action('write',{change:{type:'response',questionId:q.questionId,response}});
  await action('write',{change:{type:'mark',questionId:q.questionId,marked:true}});
  if(q.responseType==='multiple_choice')await action('write',{change:{type:'elimination',questionId:q.questionId,choiceId:q.choiceIds[1],eliminated:true}});
  if(section==='Reading and Writing')await action('write',{change:{type:'highlights',questionId:q.questionId,highlights:[{kind:'region',block:'stem:0',x:.1,y:.1,width:.3,height:.2}]}});
  await action('write',{change:{type:'navigation',questionId:a.questions[1].questionId}});
  const saved=await call(`/api/attempts/${id}`);
  assert.equal(saved.attemptId,id);assert.equal(saved.state.responses[q.questionId],response);assert(saved.state.markedQuestionIds.includes(q.questionId));assert.equal(saved.state.currentQuestionId,a.questions[1].questionId);assert.equal(saved.deadlineAt,deadline);
  if(section==='Reading and Writing')assert.equal(saved.state.highlights[q.questionId].length,1);
  // Reacquisition after an expired lease keeps the same state and clock.
  db.prepare('UPDATE learner_attempts SET editor_lease_expires_at_ms=? WHERE id=?').run(Date.now()-1,id);
  assert.equal((await call(`/api/attempts/${id}`)).lease.held,false);
  a=await call(`/api/attempts/${id}/takeover`,{});editor=a.editorToken;assert.equal(a.deadlineAt,deadline);assert.equal(a.state.responses[q.questionId],response);
  if(kind==='section_exam'){
   await action('pause');assert.equal(a.state.phase,'paused');a=await call(`/api/attempts/${id}`);
   await action('resume');assert.equal(a.state.phase,'module');assert.equal(a.state.responses[q.questionId],response);
   a=await call(`/api/attempts/${id}/assisted`,{});assert.equal(a.assisted,true);
   await action('finish-module');assert.equal(a.state.phase,'transition');await action('continue');assert.equal(a.state.activeModule,2);await action('finish-module');
  }else await action('submit');
  assert.equal(a.status,'completed');assert.equal((await call(`/api/attempts/${id}/results`)).attemptId,id);
  const list=(await call('/api/attempts')).attempts;assert.equal(list.filter(x=>x.attemptId===id).length,1);
  await call(`/api/attempts/${id}`,undefined,'DELETE');await call(`/api/attempts/${id}`,undefined,'GET',404);
  console.log(`${pkg.title}: ${kind}, protected visuals, same-Attempt resume, expired lease, answers/marks/navigation, submit/results/delete PASS`);
 }
 const tq=rows.find(q=>q.response_type==='student_produced_response');
 if(tq){
  const p=await call(`/api/library/${pkg.revisionId}/questions/${tq.question_id}`);assert.equal(p.responseType,'student_produced_response');typed++;
 }
}
await call('/api/math/reference-sheet.png');await call('/api/math/calculator-config');
console.log(JSON.stringify({packages:packages.length,journeys:10,protectedVisuals:visuals,packagesWithTypedResponse:typed,remainingAttempts:db.prepare('SELECT COUNT(*) AS n FROM learner_attempts').get().n}));

