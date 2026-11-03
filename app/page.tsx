import Link from 'next/link';
import {requireAdmin} from '@/lib/db';
import type {Trace} from '@/lib/runner';
import {edit,logout,run} from './actions';
import {Form} from './form';

export const maxDuration = 180;

type Chain = {id:string; name:string; description:string; revision:number};
type Model = {id:string; name:string; supports_images:boolean};
type Step = {id:string; position:number; name:string; instruction:string; model_id:string};

function Context({chain,operation,step}:{chain:Chain; operation?:string; step?:Step}) {
  return <>
    <input type="hidden" name="chain" value={chain.id}/>
    <input type="hidden" name="revision" value={chain.revision}/>
    {operation && <input type="hidden" name="operation" value={operation}/>}
    {step && <input type="hidden" name="step" value={step.id}/>}
  </>;
}

function ChainFields({chain}:{chain?:Chain}) {
  return <>
    <label>Chain name<input name="name" required maxLength={100} defaultValue={chain?.name}/></label>
    <label>Description<textarea name="description" rows={2} maxLength={1000} defaultValue={chain?.description}/></label>
  </>;
}

function StepFields({models,step}:{models:Model[]; step?:Step}) {
  return <>
    <label>Step name<input name="name" required maxLength={100} defaultValue={step?.name}/></label>
    <label>Instruction<textarea name="instruction" rows={3} required maxLength={2000} defaultValue={step?.instruction}/></label>
    <label>Model<select name="model" required defaultValue={step?.model_id ?? models[0]?.id ?? ''}>
      <option value="" disabled>Select a model</option>
      {step && !models.some(model=>model.id===step.model_id) && <option value={step.model_id} disabled>Current model unavailable</option>}
      {models.map(model=><option key={model.id} value={model.id}>{model.name}{model.supports_images?' · vision':''}</option>)}
    </select></label>
  </>;
}

function Remove({chain,step}:{chain:Chain; step?:Step}) {
  return <details className="remove">
    <summary>Delete {step?'step':'chain'}</summary>
    <Form action={edit} label={step?'Delete step permanently':'Delete chain permanently'} kind="danger">
      <Context chain={chain} step={step} operation={step?'delete_step':'delete_chain'}/>
      <p>{step?'Saved run history will still show past outputs.':'This also deletes the chain’s steps and generated media history.'}</p>
      <label>Type DELETE<input name="confirm" required autoComplete="off"/></label>
    </Form>
  </details>;
}

export default async function Lab({searchParams}:{searchParams:Promise<{chain?:string}>}) {
  const {client} = await requireAdmin();
  const {chain:requested} = await searchParams;
  const [chains,modelResult] = await Promise.all([
    client.from('lab_chains').select('id,name,description,revision').order('name'),
    client.from('llm_models').select('id,name,supports_images,llm_providers!inner(enabled,api_family)')
      .eq('enabled',true).eq('llm_providers.enabled',true).eq('llm_providers.api_family','gemini').order('name'),
  ]);
  if (chains.error || modelResult.error) throw new Error('Could not load the workspace.');
  const models = modelResult.data;
  const active = chains.data.find(chain=>chain.id===requested) ?? chains.data[0];
  const [steps,runs] = active ? await Promise.all([
    client.from('lab_steps').select('id,position,name,instruction,model_id').eq('chain_id',active.id).order('position'),
    client.from('lab_runs').select('id,created_at,status,output,trace,revision').eq('chain_id',active.id).order('created_at',{ascending:false}).limit(25),
  ]) : [null,null];
  if (steps?.error || runs?.error) throw new Error('Could not load the selected chain.');
  const ordered = steps?.data ?? [];
  const history = runs?.data ?? [];
  return <main className="workspace">
    <section className="intro"><div>
      <p className="kicker">WEEK 08 · SUPERADMIN WORKSPACE</p>
      <h1>Prompt Chain Lab</h1>
      <p>Build ordered prompts, run them on text or a photo, and see what each step produces.</p>
    </div><form action={logout}><button className="quiet">Sign out</button></form></section>
    <div className="grid">
      <aside className="card">
        <h2>Chains</h2>
        <nav aria-label="Prompt chains">{chains.data.map(chain=>
          <Link key={chain.id} href={'/?chain='+chain.id} aria-current={chain.id===active?.id?'page':undefined}>{chain.name}</Link>
        )}</nav>
        <details open={!active}><summary>New chain</summary>
          <Form action={edit} label="Create chain">
            <input type="hidden" name="operation" value="create"/><ChainFields/>
          </Form>
        </details>
      </aside>
      {active ? <div key={active.id} className="stack">
        <section className="card">
          <p className="kicker">CHAIN SETTINGS · REVISION {active.revision}</p>
          <h2>{active.name}</h2>
          {active.description && <p>{active.description}</p>}
          <details><summary>Edit chain</summary>
            <Form action={edit} label="Save chain"><Context chain={active} operation="save_chain"/><ChainFields key={active.revision} chain={active}/></Form>
          </details>
          <Remove chain={active}/>
        </section>
        <section className="card">
          <p className="kicker">01 · BUILD</p>
          <h2>Ordered steps <small>{ordered.length}/6</small></h2>
          <p>Step 1 takes your input. Each later step takes the previous step’s output.</p>
          {ordered.length===0 && <p>Add a step to get started.</p>}
          <ol className="steps">{ordered.map(step=><li key={step.id}>
            <h3>{step.name}</h3><p className="preserve">{step.instruction}</p>
            <div className="row">
              {ordered.length>1 && <Form action={edit} label="Move step" kind="quiet">
                <Context chain={active} step={step} operation="move_step"/>
                <label>Move to position<select name="position" key={step.position} defaultValue={step.position}>
                  {ordered.map(item=><option key={item.id} value={item.position}>{item.position}</option>)}
                </select></label>
              </Form>}
              <details><summary>Edit step</summary>
                <Form action={edit} label="Save step"><Context chain={active} step={step} operation="save_step"/><StepFields key={active.revision} models={models} step={step}/></Form>
              </details>
              <Remove chain={active} step={step}/>
            </div>
          </li>)}</ol>
          {ordered.length<6 && <details open={!ordered.length}><summary>Add a step</summary>
            <Form action={edit} label="Add step" disabled={!models.length}>
              <Context chain={active} operation="add_step"/><StepFields models={models}/>
            </Form>
            {!models.length && <p className="error">Enable a Gemini model in the Foodfolio admin area.</p>}
          </details>}
        </section>
        <section className="card">
          <p className="kicker">02 · GENERATE</p><h2>Run this chain</h2>
          <p>Give the first step text, a photo, or both. The resulting text is saved below.</p>
          <Form action={run} label="Generate media" busy="Running chain… This can take a moment." disabled={!ordered.length}>
            <Context chain={active}/>
            <label>Input text<textarea name="input" maxLength={4000} rows={4} placeholder="A stack of pancakes with a single blueberry on top…"/></label>
            <label>Optional photo · JPEG, PNG, WebP · up to 3 MB<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"/></label>
          </Form>
        </section>
        <section className="card">
          <p className="kicker">03 · REVIEW</p><h2>Generated media</h2>
          <p>Most recent 25 runs for {active.name}.</p>
          {!history.length && <p>No runs yet. Generate media to see it here.</p>}
          {history.map(item=><article className="run" key={item.id}>
            <div className="run-meta"><strong>{item.status==='succeeded'?'Generated text':'Run failed'}</strong>
              <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-US',{timeZone:'America/New_York'})} ET</time>
              <small>Revision {item.revision}</small></div>
            <p className="preserve">{item.output}</p>
            {(item.trace as Trace[]).length>0 && <details><summary>View step outputs</summary><ol>
              {(item.trace as Trace[]).map((step,index)=><li key={index}>
                <strong>{step.name}</strong> <small>{step.model} · {step.duration} ms</small><p className="preserve">{step.text}</p>
              </li>)}</ol></details>}
          </article>)}
        </section>
      </div> : <section className="card"><h2>Create your first chain</h2><p>Add a chain, write a step, and generate media.</p></section>}
    </div>
  </main>;
}
