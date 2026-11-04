import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {requestGemini, type GeminiPart} from './gemini';
export type WorkflowModule = 'meal-coach' | 'group-order';
export type WorkflowOptions = {client:SupabaseClient; chainId?:string; revision?:number};
export type WorkflowStep = {id:string;name:string;instruction:string;position:number;model_id:string;temperature:number;max_output_tokens:number};
export type WorkflowChain = {id:string;name:string;version:number;module:WorkflowModule;steps:WorkflowStep[]};
export type WorkflowTrace = {name:string;instruction:string;model:string;duration:number;text:string};
export class WorkflowFailure extends Error {
  constructor(message:string, public trace:WorkflowTrace[], public chain:WorkflowChain) {super(message);}
}
export async function runWorkflow<T>(options:WorkflowOptions,module:WorkflowModule,system:string,parts:GeminiPart[],schema:Record<string,unknown>,validate:(text:string)=>T) {
  const {data,error} = await options.client.rpc('foodfolio_workflow_snapshot',{p_module:module,p_chain:options.chainId??null,p_revision:options.revision??null});
  if(error || !data) throw new Error(error?.code==='40001'?'This chain changed. Refresh and retry.':'The workflow chain is unavailable. Check its active route and enabled models.');
  return executeWorkflow(data as WorkflowChain,system,parts,schema,validate);
}
const intermediateSchema={type:'object',properties:{analysis:{type:'string'}},required:['analysis'],additionalProperties:false};
// No user photos, health profiles, prompts or generated plans are persisted here.
// Only explicitly requested superadmin Lab previews are saved by the Lab action.
export async function executeWorkflow<T>(chain:WorkflowChain,system:string,parts:GeminiPart[],schema:Record<string,unknown>,validate:(text:string)=>T,generate=requestGemini) {
  const steps=[...chain.steps].sort((a,b)=>a.position-b.position);
  if(!steps.length || steps.length>6) throw new Error('A workflow needs one to six steps.');
  const context=parts.filter(part=>'text' in part);
  const trace:WorkflowTrace[]=[];
  let previous='';
  const deadline=Date.now()+145000;
  for(const [index,step] of steps.entries()) {
    const final=index===steps.length-1;
    const started=Date.now();
    try {
      const prompt=system+'\n\nCURRENT CHAIN STEP: '+step.instruction+'\n'+(final?'This is the final step. Return the complete final result in the supplied output schema.':'This is an intermediate working step. Return only {"analysis":"your concise working notes for the next step"}. Do not produce the final output schema yet.');
      const input:GeminiPart[]=[...(index===0?parts:context),{text:JSON.stringify({step:step.name,previous_step_output:previous||null})}];
      const result=await generate(prompt,input,final?schema:intermediateSchema,Math.min(step.max_output_tokens,final?7000:2000),Number(step.temperature),step.model_id,deadline);
      if(!result.text || result.text.length>(final?64000:16000)) throw new Error('The step returned an empty or oversized result.');
      let value:T|undefined;
      if(final) value=validate(result.text);
      else {
        const parsed=JSON.parse(result.text) as {analysis?:unknown};
        if(typeof parsed.analysis!=='string' || !parsed.analysis.trim() || parsed.analysis.length>6000) throw new Error('The step returned invalid working notes.');
      }
      previous=result.text;
      trace.push({name:step.name,instruction:step.instruction,model:result.model,duration:Date.now()-started,text:result.text});
      if(final) return {value:value as T,output:result.text,trace,chain};
    } catch(error) {
      throw new WorkflowFailure(`Step ${step.position} · ${step.name}: ${error instanceof Error?error.message:'Generation failed.'}`,trace,chain);
    }
  }
  throw new Error('The workflow returned no result.');
}
