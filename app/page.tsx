import Link from 'next/link';
import {requireAdmin} from '@/lib/db';
import type {Trace} from '@/lib/runner';
import {edit,logout,run} from './actions';
import {Form} from './form';

export const maxDuration = 180;

type Chain = {id:string; name:string; description:string; revision:number; persona:string};
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
    <label>Foodfolio character<select name="persona" defaultValue={chain?.persona ?? 'Gordon Ramsay'}>
      <option>Gordon Ramsay</option><option>Cat</option><option>Dog</option>
    </select></label>
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
    <Form action={edit} label={step?'Archive step':'Archive chain'} kind="danger">
      <Context chain={chain} step={step} operation={step?'delete_step':'delete_chain'}/>
      <p>{step?'Saved run history will still show past outputs.':'This removes the chain from active use and keeps historical runs.'}</p>
      <label>Type DELETE<input name="confirm" required autoComplete="off"/></label>
    </Form>
  </details>;
}

export default async function Lab({searchParams}:{searchParams:Promise<{chain?:string}>}) {
  const {client} = await requireAdmin();
  const {chain:requested} = await searchParams;
  const [chains,modelResult] = await Promise.all([
    client.from('prompt_chains').select('id,name,description,revision:version,persona').order('name'),
    client.from('llm_models').select('id,name,supports_images,llm_providers!inner(enabled,api_family)')
      .eq('enabled',true).eq('llm_providers.enabled',true).eq('llm_providers.api_family','gemini').order('name'),
  ]);
  if (chains.error || modelResult.error) throw new Error('Could not load the workspace.');
  const models = modelResult.data;
  const active = chains.data.find(chain=>chain.id===requested) ?? chains.data[0];
  const [steps,runs,live] = active ? await Promise.all([
    client.from('prompt_chain_steps').select('id,position,name,instruction,model_id:llm_model_id').eq('prompt_chain_id',active.id).order('position'),
    client.from('prompt_chain_previews').select('id,created_at,status,output,trace,revision').eq('chain_id',active.id).order('created_at',{ascending:false}).limit(25),
    client.rpc('foodfolio_chain_captions',{p_chain:active.id}),
  ]) : [null,null,null];
  if (steps?.error || runs?.error || live?.error) throw new Error('Could not load the selected chain.');
  const ordered = steps?.data ?? [];
  const history = runs?.data ?? [];
  const liveCaptions = (live?.data ?? []) as {id:string;created_at:string;caption:string}[];
  return <main className="workspace">
    <section className="intro"><div>
      <p className="kicker">WEEK 08 · SUPERADMIN WORKSPACE</p>
      <h1>Prompt Chain Lab</h1>
      <p>Manage the same caption chains used by Foodfolio Kitchen and Studio. New chains stay out of live traffic until enabled in Studio.</p>
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
          <h2>{active.name}</h2><p>Character · {active.persona}</p>
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
          <p>Preview the Kitchen caption workflow for this character. Previews are saved below without publishing a post.</p>
          <Form action={run} label="Generate media" busy="Running chain… This can take a moment." disabled={!ordered.length}>
            <Context chain={active}/>
            <label>Dish name<input name="dish" maxLength={80} required/></label>
            <label>Reaction<select name="reaction"><option>Roast</option><option>Hype</option><option>Roast then hype</option></select></label>
            <label>Food story<textarea name="input" maxLength={2000} rows={3}/></label>
            <label>Food photo · JPEG, PNG, WebP · up to 3 MB<input name="photo" type="file" required accept="image/jpeg,image/png,image/webp"/></label>
          </Form>
        </section>
        <section className="card">
          <p className="kicker">03 · REVIEW</p><h2>Generated media</h2>
          <h3>Lab previews</h3><p>Most recent 25 previews for {active.name}.</p>
          {!history.length && <p>No runs yet. Generate media to see it here.</p>}
          {history.map(item=><article className="run" key={item.id}>
            <div className="run-meta"><strong>{item.status==='succeeded'?'Foodfolio caption':'Run failed'}</strong>
              <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-US',{timeZone:'America/New_York'})} ET</time>
              <small>Revision {item.revision}</small></div>
            <p className="preserve">{item.output}</p>
            {(item.trace as Trace[]).length>0 && <details><summary>View step outputs</summary><ol>
              {(item.trace as Trace[]).map((step,index)=><li key={index}>
                <strong>{step.name}</strong> <small>{step.model} · {step.duration} ms</small><p className="preserve">{step.text}</p>
              </li>)}</ol></details>}
          </article>)}
          <h3>Kitchen captions</h3>
          <p>Captions generated with this chain in Foodfolio Kitchen.</p>
          {!liveCaptions.length && <p>No Kitchen captions recorded for this chain yet.</p>}
          {liveCaptions.map(item=><article className="run" key={item.id}>
            <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-US',{timeZone:'America/New_York'})} ET</time>
            <p className="preserve">{item.caption}</p>
          </article>)}
        </section>
      </div> : <section className="card"><h2>Create your first chain</h2><p>Add a chain, write a step, and generate media.</p></section>}
    </div>
  </main>;
}
