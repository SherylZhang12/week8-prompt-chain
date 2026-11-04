'use client';
import {startTransition,useActionState,type ReactNode} from 'react';
import type {Result} from './actions';

export function Form({action,children,label,busy='Saving…',kind,disabled,keepFields}:{
  action:(state:Result,form:FormData)=>Promise<Result>;
  children:ReactNode; label:string; busy?:string; kind?:string; disabled?:boolean; keepFields?:boolean;
}) {
  const [state,submit,pending] = useActionState(action,{});
  return <form action={submit} onSubmit={keepFields ? event => {
    event.preventDefault();
    if (pending || disabled) return;
    const values = new FormData(event.currentTarget);
    startTransition(() => submit(values));
  } : undefined}>
    {children}
    <button type="submit" className={kind} disabled={disabled||pending}>{pending?busy:label}</button>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.message && <p className="success" role="status">{state.message}</p>}
  </form>;
}
