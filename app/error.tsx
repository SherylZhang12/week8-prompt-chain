'use client';

export default function ErrorPage({reset}:{reset:()=>void}) {
  return <main className="login card"><h1>Workspace unavailable</h1><p>Try again. If this persists, check the Supabase configuration and Week 8 migration.</p><button onClick={reset}>Try again</button></main>;
}
