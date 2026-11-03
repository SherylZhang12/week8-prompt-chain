import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {db} from '@/lib/db';
import {logout} from '../actions';

async function login() {
  'use server';
  const client = await db();
  const request = await headers();
  const host = request.get('host');
  const protocol = request.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  if (!host) redirect('/login?error=1');
  const {data,error} = await client.auth.signInWithOAuth({
    provider:'google',options:{redirectTo:`${protocol}://${host}/auth/callback`},
  });
  if (error || !data.url) redirect('/login?error=1');
  redirect(data.url);
}

export default async function Login({searchParams}:{searchParams:Promise<{denied?:string;error?:string}>}) {
  const {denied,error} = await searchParams;
  return <main className="login card">
    <p className="kicker">WEEK 08 · SUPERADMIN WORKSPACE</p>
    <h1>Prompt Chain Lab</h1>
    <p>Build ordered prompts, run them on text or a photo, and inspect what each step produces.</p>
    {denied && <p className="error" role="alert">This Google account does not have Foodfolio superadmin access.</p>}
    {error && <p className="error" role="alert">Sign-in could not be completed. Please try again.</p>}
    <form action={login}><button>Continue with Google</button></form>
    {denied && <form action={logout}><button className="quiet">Sign out to switch accounts</button></form>}
  </main>;
}
