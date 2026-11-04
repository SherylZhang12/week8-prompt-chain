import type {ReactNode} from 'react';
type Obj=Record<string,unknown>;
const object=(value:unknown):value is Obj=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown)=>typeof value==='string'?value:'';
function List({items}:{items:unknown}) {return Array.isArray(items)?<ul>{items.filter(x=>typeof x==='string').map((x,i)=><li key={i}>{x}</li>)}</ul>:null;}
export function ResultView({output}:{output:string}):ReactNode {
 let value:unknown;try{value=JSON.parse(output);}catch{return <p className="preserve">{output}</p>;}
 if(!object(value))return <p className="preserve">{output}</p>;
 if(typeof value.analysis==='string')return <p className="preserve">{value.analysis}</p>;
 if(typeof value.caption==='string')return <p className="preserve">{value.caption}</p>;
 return <div className="workflow-result">
 <p className="preserve">{text(value.summary)}</p>
 {Array.isArray(value.observations)&&<><h4>Uploaded meals</h4>{value.observations.filter(object).map((item,i)=><div key={i}><strong>{text(item.meal)}</strong><p>{text(item.observation)}</p><p><em>{text(item.uncertainty)}</em></p></div>)}</>}
 {Array.isArray(value.suggestions)&&<><h4>Next meals</h4>{value.suggestions.filter(object).map((item,i)=><div key={i}><strong>{text(item.meal)} · {text(item.dish)}</strong><p>{text(item.idea)}</p><p>{text(item.why)}</p><p>Alternative: {text(item.swap)}</p></div>)}</>}
 {Array.isArray(value.diners)&&<><h4>Individual ordering ideas</h4>{value.diners.filter(object).map((item,i)=><div key={i}><strong>Diner {i+1}</strong><List items={item.ideas}/><p>Adjustments: {text(item.adjustments)}</p><p>{text(item.reason)}</p></div>)}</>}
 {([['improvements','Practical improvements'],['questions','Follow-up questions'],['sharing','Sharing ideas'],['checks','Check with the restaurant']] as const).map(([key,label])=>Array.isArray(value[key])?<div key={key}><h4>{label}</h4><List items={value[key]}/></div>:null)}
 </div>;
}
