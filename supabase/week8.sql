begin;
create table public.lab_chains (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 100),
  description text not null default '' check (length(description)<=1000),
  revision integer not null default 1
);
create table public.lab_steps (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.lab_chains on delete cascade,
  position integer not null check (position between 1 and 6),
  name text not null check (length(trim(name)) between 1 and 100),
  instruction text not null check (length(trim(instruction)) between 1 and 2000),
  model_id uuid not null references public.llm_models on delete restrict,
  unique (chain_id,position) deferrable initially deferred
);
create index on public.lab_steps(model_id);
create table public.lab_runs (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.lab_chains on delete cascade,
  created_at timestamptz not null default now(),
  status text not null check (status in ('succeeded','failed')),
  revision integer not null,
  output text not null check (length(output)<=16000),
  trace jsonb not null
);
create index on public.lab_runs(chain_id, created_at desc);
alter table public.lab_chains enable row level security;
alter table public.lab_steps enable row level security;
alter table public.lab_runs enable row level security;
revoke all on public.lab_chains,public.lab_steps,public.lab_runs from public,anon,authenticated;
grant select on public.lab_chains,public.lab_steps,public.lab_runs to authenticated;
grant insert on public.lab_chains,public.lab_runs to authenticated;
create policy admin_read on public.lab_chains for select to authenticated using ((select public.foodfolio_is_admin()));
create policy admin_read on public.lab_steps for select to authenticated using ((select public.foodfolio_is_admin()));
create policy admin_read on public.lab_runs for select to authenticated using ((select public.foodfolio_is_admin()));
create policy admin_create on public.lab_chains for insert to authenticated with check ((select public.foodfolio_is_admin()));
create policy admin_create on public.lab_runs for insert to authenticated with check ((select public.foodfolio_is_admin()));

create function public.lab_edit(p_chain uuid,p_revision integer,p_operation text,p_values jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  current_revision integer;
  step_id uuid;
  step_position integer;
  step_count integer;
  destination integer;
begin
  if not coalesce(public.foodfolio_is_admin(),false) then
    raise exception 'Superadmin access required' using errcode='42501';
  end if;
  select revision into current_revision from public.lab_chains where id=p_chain for update;
  if current_revision is distinct from p_revision or current_revision is null then
    raise exception 'This chain changed. Refresh and retry.' using errcode='40001';
  end if;
  if p_operation='delete_chain' then
    delete from public.lab_chains where id=p_chain;
    return;
  elsif p_operation='save_chain' then
    update public.lab_chains set name=p_values->>'name', description=p_values->>'description' where id=p_chain;
  else
    step_id := (p_values->>'step')::uuid;
    select position into step_position from public.lab_steps where chain_id=p_chain and id=step_id;
    select count(*) into step_count from public.lab_steps where chain_id=p_chain;
    if p_operation='add_step' then
      if step_count>=6 then raise exception 'A chain supports up to six steps.'; end if;
      insert into public.lab_steps(chain_id,position,name,instruction,model_id)
      values(p_chain,step_count+1,p_values->>'name',p_values->>'instruction',(p_values->>'model')::uuid);
    elsif step_position is null then
      raise exception 'Step does not belong to this chain.';
    elsif p_operation='save_step' then
      update public.lab_steps set name=p_values->>'name',instruction=p_values->>'instruction',model_id=(p_values->>'model')::uuid where id=step_id;
    elsif p_operation='delete_step' then
      delete from public.lab_steps where id=step_id;
      update public.lab_steps set position=position-1 where chain_id=p_chain and position>step_position;
    elsif p_operation='move_step' then
      destination := (p_values->>'position')::integer;
      if destination is null or destination not between 1 and step_count then raise exception 'Invalid destination.'; end if;
      update public.lab_steps set position=case
        when id=step_id then destination
        when step_position<destination then position-1
        else position+1 end
      where chain_id=p_chain and position between least(step_position,destination) and greatest(step_position,destination);
    else
      raise exception 'Invalid operation.';
    end if;
  end if;
  update public.lab_chains set revision=revision+1 where id=p_chain;
end;
$$;
revoke all on function public.lab_edit(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.lab_edit(uuid,integer,text,jsonb) to authenticated;

with example as (
  insert into public.lab_chains(name,description) values
  ('Photo to five captions','Describe a photo, find a funny angle, and write five short captions.')
  returning id
)
insert into public.lab_steps(chain_id,position,name,instruction,model_id)
select example.id, sample.position, sample.name, sample.instruction, model.id
from example cross join (values
  (1,'Describe the photo','Describe what is visibly present in the photo using two concrete sentences. If the input is text, summarize the described scene.'),
  (2,'Find the funny angle','Use the previous description to write one playful observation grounded in the scene.'),
  (3,'Write five captions','Turn the previous observation into exactly five distinct short, funny captions, numbered 1 through 5.')
) as sample(position,name,instruction)
cross join lateral (
  select id from public.llm_models where model_id='gemini-3.1-flash-lite' limit 1
) model;
commit;
