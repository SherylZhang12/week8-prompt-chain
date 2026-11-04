'use server';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/db';
import {generateMealPlan,type CoachPhoto} from '@/lib/ai/meal-coach';
import {generateGroupOrder} from '@/lib/ai/group-order';
import {WorkflowFailure} from '@/lib/ai/workflow';
import {MEALS,readMealProfile} from '@/lib/meal-coach';
import {readDiners} from '@/lib/group-dining';
import {imageMime} from '@/lib/food-photo';
import type {Result} from './actions';
const field=(form:FormData,key:string)=>String(form.get(key)??'').trim();
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export async function activateWorkflow(_:Result,form:FormData):Promise<Result> {
 const {client}=await requireAdmin();
 const id=field(form,'chain'),revision=Number(field(form,'revision'));
 if(!uuid.test(id)||!Number.isInteger(revision))return {error:'Select a valid chain.'};
 const {error}=await client.rpc('foodfolio_activate_workflow',{p_chain:id,p_revision:revision});
 if(error)return {error:error.code==='40001'?'This chain changed. Refresh and retry.':'A live workflow needs an enabled chain, model, provider and at least one runnable step.'};
 revalidatePath('/');return {message:'This chain is now used for new requests in the public application.'};
}
export async function runWorkflowPreview(_:Result,form:FormData):Promise<Result> {
 const {client}=await requireAdmin();
 const id=field(form,'chain'),revision=Number(field(form,'revision'));
 if(!uuid.test(id)||!Number.isInteger(revision))return {error:'Select a valid chain.'};
 if(field(form,'consent')!=='yes')return {error:'Confirm use of test data and saving this Lab preview.'};
 const {data:chain,error}=await client.from('prompt_chains').select('module,version').eq('id',id).single();
 if(error||!chain)return {error:'Could not load this chain.'};
 if(chain.version!==revision)return {error:'This chain changed. Refresh and retry.'};
 const options={client,chainId:id,revision};
 let result:{output:string;trace:unknown[];status:string};
 try {
  if(chain.module==='meal-coach') {
   const {profile,error}=readMealProfile(form);if(error||!profile)return {error:error??'Check the profile.'};
   const photos:CoachPhoto[]=[];
   for(const meal of MEALS) {
    const file=form.get('photo_'+meal),notes=field(form,'notes_'+meal);
    if(notes.length>500)return {error:'Keep notes under 500 characters per meal.'};
    if(!(file instanceof File)||!file.size)continue;
    if(file.size>1_000_000)return {error:'Each photo must be under 1 MB.'};
    const bytes=new Uint8Array(await file.arrayBuffer()),mimeType=imageMime(bytes);
    if(!mimeType)return {error:'Use JPEG, PNG or WebP food photos.'};
    photos.push({meal,bytes,mimeType,notes});
   }
   if(!photos.length)return {error:'Attach at least one meal photo.'};
   const generated=await generateMealPlan(profile,photos,options);
   result={output:JSON.stringify(generated.plan,null,2),trace:generated.run.trace,status:'succeeded'};
  } else if(chain.module==='group-order') {
   const count=Number(field(form,'diner_count'));
   if(!Number.isInteger(count)||count<1||count>12)return {error:'Add 1 to 12 diners.'};
   const diners=readDiners(JSON.stringify(Array.from({length:count},(_,i)=>({id:`diner-${i+1}`,name:`Diner ${i+1}`,wants:field(form,`diner_${i}_wants`),avoids:field(form,`diner_${i}_avoids`),restrictions:field(form,`diner_${i}_restrictions`),notes:field(form,`diner_${i}_notes`)}))));
   const name=field(form,'restaurant'),cuisine=field(form,'cuisine'),menu=field(form,'menu');
   if(!name||name.length>120||!cuisine||cuisine.length>300||menu.length>4000)return {error:'Check restaurant details and keep menu text under 4,000 characters.'};
   const generated=await generateGroupOrder(diners,{name,cuisine},menu,options);
   result={output:JSON.stringify(generated.plan,null,2),trace:generated.run.trace,status:'succeeded'};
  } else return {error:'Use the Food reactions test form for this chain.'};
 } catch(error) {
  if(!(error instanceof WorkflowFailure))return {error:error instanceof Error?error.message:'Generation failed.'};
  result={status:'failed',output:error.message,trace:error.trace};
 }
 if(result.output.length>64000)return {error:'The generated result is too large to save. Shorten the step instructions.'};
 const {error:saveError}=await client.from('prompt_chain_previews').insert({chain_id:id,revision,...result});
 if(saveError)return {error:'The run finished but could not be saved.'};
 revalidatePath('/');return result.status==='succeeded'?{message:'Result and step outputs saved below.'}:{error:result.output};
}
