import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function db() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => jar.getAll(), setAll: values => { try { values.forEach(({name,value,options}) => jar.set(name,value,options)); } catch {} } }
  });
}
export async function requireAdmin() {
  const client = await db();
  const {data:{user},error} = await client.auth.getUser();
  if (error || !user) redirect('/login');
  const {data:allowed,error:denied} = await client.rpc('foodfolio_is_admin');
  if (denied || allowed !== true) redirect('/login?denied=1');
  return {client,user};
}
