import Link from 'next/link';
import {requireAdmin} from '@/lib/db';
import type {Trace} from '@/lib/runner';
import {edit,logout,run} from './actions';
import {Form} from './form';
import {ResultView} from './result-view';
import {ChainFields,WorkflowFields} from './workflow-fields';
import {activateWorkflow,runWorkflowPreview} from './workflow-actions';

export const maxDuration = 180;

type Chain = {id:string; name:string; description:string; revision:number; persona:string|null; module:string};
type Model = {id:string; name:string; supports_images:boolean};
type Step = {id:string; position:number; name:string; instruction:string; model_id:string};

function Context({chain,operation,step}:{chain:Chain; operation?:string; step?:Step}) {
  return <>
    <input type="hidden" name="chain" value={chain.id}/>
    <input type="hidden" name="module" value={chain.module}/>
    <input type="hidden" name="revision" value={chain.revision}/>
    {operation && <input type="hidden" name="operation" value={operation}/>}
    {step && <input type="hidden" name="step" value={step.id}/>}
  </>;
}

function StepFields({models,step}:{models:Model[]; step?:Step}) {
  return <>
    <label>Step name<input name="name" required maxLength={100} defaultValue={step?.name}/></label>
    <label>Instruction<textarea name="instruction" rows={3} required maxLength={2000} defaultValue={step?.instruction}/></label>
    <label>Model<select name="model" required defaultValue={step?.model_id ?? models.find(model=>model.name.includes('3.5'))?.id ?? models[0]?.id ?? ''}>
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
  const [chains,modelResult,routes] = await Promise.all([
    client.from('prompt_chains').select('id,name,description,revision:version,persona,module').order('name'),
    client.from('llm_models').select('id,name,supports_images,llm_providers!inner(enabled,api_family)')
      .eq('enabled',true).eq('llm_providers.enabled',true).eq('llm_providers.api_family','gemini').order('name'),
    client.from('prompt_workflow_routes').select('module,chain_id'),
  ]);
  if (chains.error || modelResult.error || routes.error) throw new Error('Could not load the workspace.');
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
      <p className="kicker">FOODFOLIO · SUPERADMIN WORKSPACE</p>
      <h1>Prompt Chain Lab<span>.</span></h1>
      <p>Manage the AI workflows behind Food reactions, Daily Meal Coach and Group Ordering. Test every step before choosing a live chain.</p>
    </div><div className="top-tools"><span className="badge">Superadmin access</span><form action={logout}><button className="quiet">Sign out</button></form></div></section>
    <div className="grid">
      <aside className="card chain-sidebar">
        <h2>Food reactions</h2>
        <nav aria-label="Prompt chains">{['Gordon Ramsay','Cat','Dog'].map(persona=><div className="nav-group" key={persona}>
          <h3>{persona}</h3>
          {chains.data.filter(chain=>chain.persona===persona).map(chain=>
            <Link key={chain.id} href={'/?chain='+chain.id} aria-current={chain.id===active?.id?'page':undefined}>
              {chain.name.startsWith(persona+' · ')?chain.name.slice(persona.length+3):chain.name}
            </Link>
          )}
        </div>)}</nav>
        {['meal-coach','group-order'].map(module=><div className="nav-group" key={module}><h2>{module==='meal-coach'?'Daily Meal Coach':'Group Ordering'}</h2><nav aria-label={module+' chains'}>{chains.data.filter(chain=>chain.module===module).map(chain=><Link key={chain.id} href={'/?chain='+chain.id} aria-current={chain.id===active?.id?'page':undefined}>{chain.name}{routes.data.some(route=>route.chain_id===chain.id)?' · Live':''}</Link>)}</nav></div>)}
        <details open={!active}><summary>New chain</summary>
          <Form action={edit} label="Create chain">
            <input type="hidden" name="operation" value="create"/><ChainFields/>
          </Form>
        </details>
        <a className="studio-link" href="https://foodfolio-admin.vercel.app/admin/chains">Manage live mix in Studio →</a>
      </aside>
      {active ? <div key={active.id} className="stack">
        <section className="card">
          <p className="kicker">CHAIN SETTINGS · REVISION {active.revision}</p>
          <h2>{active.name}</h2><p>{active.module==='caption'?'Character · '+active.persona:active.module==='meal-coach'?'Daily Meal Coach':'Group Ordering'}</p>
          {active.module!=='caption' && (routes.data.some(route=>route.chain_id===active.id)?<p className="badge">Live in the public application</p>:<Form action={activateWorkflow} label="Use this chain in the app"><Context chain={active}/><p>Activating this chain replaces the current chain for this module. Further edits to the live chain apply to new requests.</p></Form>)}
          {active.description && <p>{active.description}</p>}
          <details><summary>Edit chain</summary>
            <Form action={edit} label="Save chain"><Context chain={active} operation="save_chain"/><ChainFields key={active.revision} chain={active}/></Form>
          </details>
          <Remove chain={active}/>
        </section>
        <section className="card">
          <p className="kicker">01 · BUILD</p>
          <h2>Ordered steps <small>{ordered.length}/6</small></h2>
          <p>Step 1 takes the original input and any photos. Later steps receive the original text context and the previous step’s output. The final step returns the module’s complete result.</p>
          {ordered.length===0 && <p>Add a step to get started.</p>}
          <ol className="steps">{ordered.map(step=><li key={step.id}>
            <h3>{step.name}</h3><small>{step.position===ordered.length?'Final result':'Intermediate working output'}</small><p className="preserve">{step.instruction}</p>
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
          <p>Run this module with test input. Results and intermediate outputs are saved below without publishing a post.</p>
          <Form action={active.module==='caption'?run:runWorkflowPreview} keepFields label="Generate media" busy="Running chain… This can take a moment." disabled={!ordered.length}>
            <Context chain={active}/>
            {active.module==='caption'?<><label>Dish name<input name="dish" maxLength={80} required/></label>
            <label>Reaction<select name="reaction"><option value="Roast">Roast me</option><option value="Hype">Hype me</option><option value="Roast then hype">Roast then praise</option></select></label>
            <label>Food story<textarea name="input" maxLength={2000} rows={3}/></label>
            <label>Food photo · JPEG, PNG, WebP · up to 3 MB<input name="photo" type="file" required accept="image/jpeg,image/png,image/webp"/></label></>:<WorkflowFields module={active.module}/>}
          </Form>
        </section>
        <section className="card">
          <p className="kicker">03 · REVIEW</p><h2>Generated media</h2>
          <h3>Lab previews</h3><p>Most recent 25 previews for {active.name}.</p>
          {!history.length && <p>No runs yet. Generate media to see it here.</p>}
          {history.map(item=><article className="run" key={item.id}>
            <div className="run-meta"><strong>{item.status==='succeeded'?(active.module==='caption'?'Foodfolio caption':active.module==='meal-coach'?'Meal plan':'Ordering suggestions'):'Run failed'}</strong>
              <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-US',{timeZone:'America/New_York'})} ET</time>
              <small>Revision {item.revision}</small></div>
            <ResultView output={item.output}/>
            {(item.trace as Trace[]).length>0 && <details><summary>View step outputs</summary><ol>
              {(item.trace as Trace[]).map((step,index)=><li key={index}>
                <strong>{step.name}</strong> <small>{step.model} · {step.duration} ms</small><ResultView output={step.text}/>{step.instruction&&<details><summary>Instruction used for this run</summary><p>{step.instruction}</p></details>}
              </li>)}</ol></details>}
          </article>)}
          {active.module==='caption'&&<><h3>Kitchen captions</h3>
          <p>Captions generated with this chain in Foodfolio Kitchen.</p>
          {!liveCaptions.length && <p>No Kitchen captions recorded for this chain yet.</p>}
          {liveCaptions.map(item=><article className="run" key={item.id}>
            <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-US',{timeZone:'America/New_York'})} ET</time>
            <p className="preserve">{item.caption}</p>
          </article>)}</>}
          {active.module!=='caption'&&<p>Public-app plans remain private to the current request. Lab previews use the same chain and validators; only explicitly submitted Lab test results are saved here.</p>}
        </section>
      </div> : <section className="card"><h2>Create your first chain</h2><p>Add a chain, write a step, and generate media.</p></section>}
    </div>
  </main>;
}
