import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const loaded={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/ai/workflow.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:loaded,exports:loaded.exports,require:name=>name==='server-only'?{}:{requestGemini:()=>{throw Error('Unexpected real model call')}},Date,Error,JSON});
const {executeWorkflow,runWorkflow}=loaded.exports;
const chain={id:'chain',name:'Workflow',module:'meal-coach',version:3,steps:[4,2,1,3].map(position=>({id:'step-'+position,position,name:'Stage '+position,instruction:'Task '+position,model_id:'configured-model-'+position,temperature:0.4,max_output_tokens:7000}))};
test('four stages follow stored order, transfer working output, keep text context and send photos only once',async()=>{
 const calls=[];const original=[{text:'Original restrictions and meal labels'},{inlineData:{mimeType:'image/jpeg',data:'test-image'}}];
 const result=await executeWorkflow(chain,'CORE RULES',original,{type:'object',properties:{summary:{type:'string'}}},text=>{const p=JSON.parse(text);assert.equal(p.summary,'Final');return p;},async(system,parts,schema,tokens,temp,model,deadline)=>{
  calls.push({system,parts,schema,model,deadline});return {text:JSON.stringify(calls.length===4?{summary:'Final'}:{analysis:'Working '+calls.length}),model};
 });
 assert.equal(calls.length,4);assert.equal(result.trace.length,4);assert.equal(result.value.summary,'Final');
 assert.equal(calls[0].parts.filter(p=>p.inlineData).length,1);
 for(let i=0;i<4;i++) {assert.equal(calls[i].model,'configured-model-'+(i+1));assert.match(calls[i].system,/CORE RULES/);assert.equal(calls[i].parts[0].text,original[0].text);if(i>0){assert.equal(calls[i].parts.filter(p=>p.inlineData).length,0);assert.equal(JSON.parse(calls[i].parts.at(-1).text).previous_step_output,JSON.stringify({analysis:'Working '+i}));}}
 assert.equal(calls[0].schema.required[0],'analysis');assert.ok(calls[3].schema.properties.summary);assert.equal(result.trace[0].instruction,'Task 1');
});
test('a failed middle step stops later model calls and preserves only real completed outputs',async()=>{
 let calls=0;await assert.rejects(executeWorkflow(chain,'core',[{text:'context'}],{},JSON.parse,async()=>{if(++calls===2)throw Error('HTTP 503');return {text:'{"analysis":"Observed food"}',model:'actual-model'};}),error=>{assert.match(error.message,/Step 2.*HTTP 503/);assert.equal(error.trace.length,1);assert.equal(error.trace[0].model,'actual-model');return true;});assert.equal(calls,2);
});
test('invalid intermediate output and invalid final domain result fail instead of showing success',async()=>{
 await assert.rejects(executeWorkflow(chain,'core',[],{},JSON.parse,async()=>({text:'{"analysis":""}',model:'test'})),/invalid working notes/);
 const single={...chain,steps:[chain.steps[0]]};await assert.rejects(executeWorkflow(single,'core',[],{},()=>{throw Error('Missing diner')},async()=>({text:'{"summary":"Incomplete"}',model:'test'})),/Missing diner/);
});
test('unavailable or stale database snapshots stop before generation, without storing sensitive input',async()=>{
 const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});return {error:{code:'40001'}}},from:()=>{throw Error('Must not store health details')}};
 await assert.rejects(runWorkflow({client,chainId:'draft',revision:1},'meal-coach','core',[{text:'private profile'}],{},JSON.parse),/Refresh/);
 assert.equal(calls.length,1);assert.equal(JSON.stringify(calls).includes('private profile'),false);assert.equal(calls[0].name,'foodfolio_workflow_snapshot');
});
