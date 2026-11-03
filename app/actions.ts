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
  if (op==='create') {
    const {data,error} = await client.from('lab_chains').insert({name,description}).select('id').single();
    if (error) return {error:error.code==='23505'?'A chain with this name already exists.':'Could not create the chain.'};
    revalidatePath('/');
    redirect('/?chain='+data.id);
  }
  if (!uuid.test(id) || !Number.isInteger(revision) || revision<1) return {error:'Select a valid chain.'};
  if (op.startsWith('delete_') && field(form,'confirm')!=='DELETE') return {error:'Type DELETE to confirm.'};
  if (['save_step','move_step','delete_step'].includes(op) && !uuid.test(step)) return {error:'Select a valid step.'};
  if (['add_step','save_step'].includes(op) && (!instruction || instruction.length>2000 || !uuid.test(model))) return {error:'Enter an instruction up to 2,000 characters and select a model.'};
  const {error} = await client.rpc('lab_edit',{p_chain:id,p_revision:revision,p_operation:op,p_values:{name,description,step:step||null,instruction,model,position}});
  if (error) return {error:error.code==='23505'?'A chain with this name already exists.':error.code==='40001'?'This chain changed. Refresh and retry.':'Could not save this change. Check the fields and try again.'};
  revalidatePath('/');
  if (op==='delete_chain') redirect('/');
  return {message: op==='move_step'?'Step moved.':op==='delete_step'?'Step deleted.':'Saved.'};
}

export async function run(_:Result,form:FormData):Promise<Result> {
  const {client} = await requireAdmin();
  const id = field(form,'chain');
  if (!uuid.test(id)) return {error:'Select a valid chain.'};
  const input = field(form,'input');
  const file = form.get('photo');
  const photo = file instanceof File && file.size>0 ? file : null;
  if (!input && !photo) return {error:'Enter text or attach a photo.'};
  if (input.length>4000) return {error:'Input text is limited to 4,000 characters.'};
  if (photo && (photo.size>3_000_000 || !['image/jpeg','image/png','image/webp'].includes(photo.type))) {
    return {error:'Choose a JPEG, PNG or WebP under 3 MB.'};
  }
  if (!process.env.GEMINI_API_KEY) return {error:'The server needs GEMINI_API_KEY before it can run a chain.'};
  const {data:chain,error} = await client.from('lab_chains')
    .select('revision,lab_steps(id,name,instruction,position,llm_models!inner(model_id,enabled,supports_images,llm_providers!inner(enabled,api_family)))')
    .eq('id',id).single();
  if (error || !chain) return {error:'Could not load this chain.'};
  if (chain.revision!==Number(field(form,'revision'))) return {error:'This chain changed. Refresh before running it.'};
  type Provider = {enabled:boolean; api_family:string};
  type Model = {model_id:string; enabled:boolean; supports_images:boolean; llm_providers:Provider};
  type ChainStep = {id:string; name:string; instruction:string; position:number; llm_models:Model};
  const steps = (chain.lab_steps as unknown as ChainStep[]).sort((a,b)=>a.position-b.position);
  if (!steps.length) return {error:'Add at least one step before running the chain.'};
  if (steps.some(({llm_models:model})=>!model?.enabled || !model.llm_providers?.enabled || model.llm_providers.api_family!=='gemini')) {
    return {error:'Every step needs an enabled Gemini model and provider.'};
  }
  if (photo && !steps[0].llm_models.supports_images) return {error:'The first step needs a model that supports images.'};
  const image = photo ? {mimeType:photo.type,data:Buffer.from(await photo.arrayBuffer()).toString('base64')} : null;
  const result = await runChain(steps.map(({llm_models,...step})=>({...step,model:llm_models.model_id})),input,image,generate);
  const {error:saveError} = await client.from('lab_runs').insert({chain_id:id,revision:chain.revision,...result});
  if (saveError) return {error:'The run finished but could not be saved. Check that the chain still exists.'};
  revalidatePath('/');
  return result.status==='succeeded'?{message:'Generated text saved in this chain’s media history.'}:{error:result.output};
}
