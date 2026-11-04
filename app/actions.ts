'use server';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {db, requireAdmin} from '@/lib/db';
import {runChain} from '@/lib/runner';
import {generate} from '@/lib/gemini';

export type Result = {error?:string; message?:string};
const field = (form:FormData,key:string) => String(form.get(key) ?? '').trim();
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function logout() {
  const client = await db();
  await client.auth.signOut();
  redirect('/login');
}

export async function edit(_:Result, form:FormData):Promise<Result> {
  const {client} = await requireAdmin();
  const op = field(form,'operation');
  const id = field(form,'chain');
  const revision = Number(field(form,'revision'));
  const name = field(form,'name');
  const description = field(form,'description');
  const step = field(form,'step');
  const instruction = field(form,'instruction');
  const model = field(form,'model');
  const position = Number(field(form,'position'));
  if (['create','save_chain','add_step','save_step'].includes(op) && (!name || name.length>100)) return {error:'Enter a name up to 100 characters.'};
  if (description.length>1000) return {error:'Description is limited to 1,000 characters.'};
  const persona = field(form,'persona');
  const module = field(form,'module') || 'caption';
  if (!['caption','meal-coach','group-order'].includes(module)) return {error:'Select a valid product module.'};
  if (['create','save_chain'].includes(op) && module==='caption' && !['Gordon Ramsay','Cat','Dog'].includes(persona)) return {error:'Select a Foodfolio character.'};
  if (op!=='create' && (!uuid.test(id) || !Number.isInteger(revision) || revision<1)) return {error:'Select a valid chain.'};
  if (op.startsWith('delete_') && field(form,'confirm')!=='DELETE') return {error:'Type DELETE to confirm.'};
  if (['save_step','move_step','delete_step'].includes(op) && !uuid.test(step)) return {error:'Select a valid step.'};
  if (['add_step','save_step'].includes(op) && (!instruction || instruction.length>2000 || !uuid.test(model))) return {error:'Enter an instruction up to 2,000 characters and select a model.'};
  const {data,error} = await client.rpc('foodfolio_edit_chain',{p_chain:id||null,p_revision:revision,p_operation:op,p_values:{name,description,persona,module,step:step||null,instruction,model,position}});
  if (error) return {error:error.code==='23514'?error.message:error.code==='23505'?'A chain with this name already exists.':error.code==='40001'?'This chain changed. Refresh and retry.':'Could not save this change. Check the fields and try again.'};
  revalidatePath('/');
  if (op==='create') redirect('/?chain='+data);
  if (op==='delete_chain') redirect('/');
  return {message: op==='move_step'?'Step moved.':op==='delete_step'?'Step deleted.':'Saved.'};
}

export async function run(_:Result,form:FormData):Promise<Result> {
  const {client} = await requireAdmin();
  const id = field(form,'chain');
  if (!uuid.test(id)) return {error:'Select a valid chain.'};
  const dish = field(form,'dish');
  const context = field(form,'input');
  const reaction = field(form,'reaction');
  const file = form.get('photo');
  const photo = file instanceof File && file.size>0 ? file : null;
  if (!dish || dish.length>80 || !photo) return {error:'Enter a dish name and attach a food photo.'};
  if (!['Roast','Hype','Roast then hype'].includes(reaction)) return {error:'Choose a Foodfolio reaction.'};
  if (context.length>2000) return {error:'Input text is limited to 2,000 characters.'};
  if (photo && (photo.size>3_000_000 || !['image/jpeg','image/png','image/webp'].includes(photo.type))) {
    return {error:'Choose a JPEG, PNG or WebP under 3 MB.'};
  }
  if (!process.env.GEMINI_API_KEY) return {error:'The server needs GEMINI_API_KEY before it can run a chain.'};
  const {data:chain,error} = await client.from('prompt_chains')
    .select('revision:version,name,persona,prompt_chain_steps(id,name,instruction,position,temperature,max_output_tokens,llm_models!inner(model_id,enabled,supports_images,llm_providers!inner(enabled,api_family)))')
    .eq('id',id).single();
  if (error || !chain) return {error:'Could not load this chain.'};
  if (chain.revision!==Number(field(form,'revision'))) return {error:'This chain changed. Refresh before running it.'};
  type Provider = {enabled:boolean; api_family:string};
  type Model = {model_id:string; enabled:boolean; supports_images:boolean; llm_providers:Provider};
  type ChainStep = {id:string; name:string; instruction:string; position:number; temperature:number; max_output_tokens:number; llm_models:Model};
  const steps = (chain.prompt_chain_steps as unknown as ChainStep[]).sort((a,b)=>a.position-b.position);
  if (!steps.length) return {error:'Add at least one step before running the chain.'};
  if (steps.some(({llm_models:model})=>!model?.enabled || !model.llm_providers?.enabled || model.llm_providers.api_family!=='gemini')) {
    return {error:'Every step needs an enabled Gemini model and provider.'};
  }
  if (photo && !steps[0].llm_models.supports_images) return {error:'The first step needs a model that supports images.'};
  const image = photo ? {mimeType:photo.type,data:Buffer.from(await photo.arrayBuffer()).toString('base64')} : null;
  const [terms,examples] = await Promise.all([
    client.from('terms').select('term,definition,example').eq('enabled',true).order('term').limit(5),
    client.from('ai_generation_examples').select('input:input_text,output:output_text').eq('enabled',true)
      .or('prompt_chain_id.eq.'+id+',prompt_chain_id.is.null').order('created_at',{ascending:false}).limit(2),
  ]);
  if (terms.error || examples.error) return {error:'Could not load Foodfolio prompt context.'};
  const input = {food:dish,dish,context,persona:chain.persona,reaction,language:'English'};
  const deadline = Date.now() + 145000;
  const result = await runChain(steps.map(({llm_models,...step})=>({...step,model:llm_models.model_id})), '', image, (step,previous,attachment) => generate(step,JSON.stringify({
    ...input, chain_name:chain.name,step:step.position,previous_draft:previous||undefined,
    glossary:terms.data,examples:examples.data,
  }),attachment,deadline,step.position===steps[steps.length-1].position));
  const {error:saveError} = await client.from('prompt_chain_previews').insert({chain_id:id,revision:chain.revision,...result});
  if (saveError) return {error:'The run finished but could not be saved. Check that the chain still exists.'};
  revalidatePath('/');
  return result.status==='succeeded'?{message:'Foodfolio caption saved in this chain’s preview history.'}:{error:result.output};
}
