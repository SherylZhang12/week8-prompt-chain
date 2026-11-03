'use client';
import {useActionState,type ReactNode} from 'react';
import type {Result} from './actions';

export function Form({action,children,label,busy='Saving…',kind,disabled}:{
  action:(state:Result,form:FormData)=>Promise<Result>;
  children:ReactNode; label:string; busy?:string; kind?:string; disabled?:boolean;
}) {
  const [state,submit,pending] = useActionState(action,{});
  return <form action={submit}>
    {children}
    <button type="submit" className={kind} disabled={disabled||pending}>{pending?busy:label}</button>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.message && <p className="success" role="status">{state.message}</p>}
  </form>;
}
