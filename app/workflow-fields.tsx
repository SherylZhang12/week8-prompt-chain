'use client';
import {useState} from 'react';
import {ACTIVITIES,MEAL_GOALS,MEAL_CUISINES,MEALS} from '@/lib/meal-coach';
export const MODULES=[['caption','Food reactions'],['meal-coach','Daily Meal Coach'],['group-order','Group Ordering']] as const;
export function ChainFields({chain}:{chain?:{name:string;description:string;module:string;persona:string|null}}) {
 const [module,setModule]=useState(chain?.module??'caption');
 return <>
  <label>Chain name<input name="name" required maxLength={100} defaultValue={chain?.name}/></label>
  <label>Product module<select name={chain?undefined:'module'} value={module} disabled={!!chain} onChange={event=>setModule(event.target.value)}>{MODULES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  {chain&&<input type="hidden" name="module" value={module}/>}
  {module==='caption'&&<label>Foodfolio character<select name="persona" defaultValue={chain?.persona??'Gordon Ramsay'}><option>Gordon Ramsay</option><option>Cat</option><option>Dog</option></select></label>}
  <label>Description<textarea name="description" rows={2} maxLength={1000} defaultValue={chain?.description}/></label>
 </>;
}
export function WorkflowFields({module}:{module:string}) {
 const [diners,setDiners]=useState(2);
 return <>
 {module==='meal-coach'?<>
  <p>Use a fictional adult profile and food-only test photos. The same meal-slot rules and output checks are used by the public Meal Coach.</p>
  <label>Age<input name="age" type="number" min={18} max={100} required defaultValue={25}/></label>
  <label>Height in cm (optional)<input name="height" type="number" min={80} max={250}/></label>
  <label>Weight in kg (optional)<input name="weight" type="number" min={25} max={350} step="0.1"/></label>
  <label>Sex<select name="sex"><option>Prefer not to say</option><option>Female</option><option>Male</option></select></label>
  <label>Activity<select name="activity">{ACTIVITIES.map(x=><option key={x}>{x}</option>)}</select></label>
  <label>Food goal<select name="goal">{MEAL_GOALS.map(x=><option key={x}>{x}</option>)}</select></label>
  <label>Cuisine<select name="cuisine">{MEAL_CUISINES.map(x=><option key={x}>{x}</option>)}</select></label>
  <label>Preferences<textarea name="preferences" maxLength={500} rows={2}/></label>
  <label>Dietary restrictions<textarea name="restrictions" maxLength={500} rows={2}/></label>
  {MEALS.map(meal=><fieldset key={meal}><legend>{meal}</legend><label>Photo (optional, up to 1 MB)<input name={'photo_'+meal} type="file" accept="image/jpeg,image/png,image/webp"/></label><label>Self-reported portions and ingredients<textarea name={'notes_'+meal} rows={2} maxLength={500}/></label></fieldset>)}
  <p>Attach at least one meal photo. Breakfast → lunch/dinner; lunch → dinner; dinner → tomorrow’s meals.</p>
 </>:<>
  <p>Use anonymous test diners. Restaurant/menu text is supplied by you; this preview does not verify a live menu or search for restaurants.</p>
  <label>Restaurant name<input name="restaurant" required maxLength={120}/></label>
  <label>Restaurant cuisine<input name="cuisine" required maxLength={300}/></label>
  <label>Menu text (optional)<textarea name="menu" maxLength={4000} rows={5}/></label>
  <input type="hidden" name="diner_count" value={diners}/>
  {Array.from({length:diners},(_,i)=><fieldset key={i}><legend>Diner {i+1}</legend>{[['wants','Wants'],['avoids','Avoids'],['restrictions','Dietary restrictions'],['notes','Budget, spice and other notes']].map(([key,label])=><label key={key}>{label}<input name={`diner_${i}_${key}`} maxLength={200}/></label>)}</fieldset>)}
  <div className="row"><button type="button" className="quiet" disabled={diners>=12} onClick={()=>setDiners(diners+1)}>Add diner</button><button type="button" className="quiet" disabled={diners<=1} onClick={()=>setDiners(diners-1)}>Remove last diner</button></div>
 </>}
 <label className="check-label"><input name="consent" type="checkbox" value="yes" required/>Send this test input to Google Gemini and save the generated result and step outputs in superadmin Lab history. Use fictional, non-sensitive test data. Input photos are not saved.</label>
 </>;
}
