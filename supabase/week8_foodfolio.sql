begin;
alter table public.prompt_chains add column archived_at timestamptz;
alter table public.prompt_chain_steps add column archived_at timestamptz;
alter table public.prompt_chain_steps drop constraint prompt_chain_steps_prompt_chain_id_position_key;
alter table public.prompt_chain_steps add column active_position integer
  generated always as (case when archived_at is null then position end) stored;
alter table public.prompt_chain_steps add constraint prompt_chain_steps_active_order
  unique (prompt_chain_id,active_position) deferrable initially deferred;
alter policy admin_read on public.prompt_chains using ((select public.foodfolio_is_admin()) and archived_at is null);
alter policy admin_read on public.prompt_chain_steps using ((select public.foodfolio_is_admin()) and archived_at is null);
create table public.prompt_chain_previews (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.prompt_chains(id),
  created_at timestamptz not null default now(),
  status text not null check (status in ('succeeded','failed')),
  revision integer not null,
  output text not null check (length(output)<=16000),
  trace jsonb not null
);
create index on public.prompt_chain_previews(chain_id, created_at desc);
alter table public.prompt_chain_previews enable row level security;
revoke all on public.prompt_chain_previews from public,anon,authenticated;
grant select,insert on public.prompt_chain_previews to authenticated;
create policy admin_read on public.prompt_chain_previews for select to authenticated using ((select public.foodfolio_is_admin()));
create policy admin_create on public.prompt_chain_previews for insert to authenticated with check ((select public.foodfolio_is_admin()));
create function public.foodfolio_edit_chain(p_chain uuid,p_revision integer,p_operation text,p_values jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  current_revision integer;
  new_id uuid;
  step_id uuid;
  step_position integer;
  step_count integer;
  destination integer;
begin
  if not coalesce(public.foodfolio_is_admin(),false) then
    raise exception 'Superadmin access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(812092);
  if p_operation='create' then
    insert into public.prompt_chains(name,description,persona) values(p_values->>'name',p_values->>'description',p_values->>'persona') returning id into new_id;
    insert into public.prompt_chain_mix(prompt_chain_id,weight,enabled) values(new_id,0,false);
    return new_id;
  end if;
  select version into current_revision from public.prompt_chains where id=p_chain and archived_at is null for update;
  if current_revision is distinct from p_revision or current_revision is null then
    raise exception 'This chain changed. Refresh and retry.' using errcode='40001';
  end if;
  if p_operation='delete_chain' then
    update public.prompt_chains set archived_at=now(), enabled=false where id=p_chain;
  elsif p_operation='save_chain' then
    update public.prompt_chains set name=p_values->>'name', description=p_values->>'description', persona=p_values->>'persona' where id=p_chain;
  else
    step_id := (p_values->>'step')::uuid;
    select position into step_position from public.prompt_chain_steps where prompt_chain_id=p_chain and archived_at is null and id=step_id;
    select count(*) into step_count from public.prompt_chain_steps where prompt_chain_id=p_chain and archived_at is null;
    if p_operation='add_step' then
      if step_count>=6 then raise exception 'A chain supports up to six steps.'; end if;
      insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id)
      values(p_chain,step_count+1,p_values->>'name',p_values->>'instruction',(p_values->>'model')::uuid);
    elsif step_position is null then
      raise exception 'Step does not belong to this chain.';
    elsif p_operation='save_step' then
      update public.prompt_chain_steps set name=p_values->>'name',instruction=p_values->>'instruction',llm_model_id=(p_values->>'model')::uuid where id=step_id;
    elsif p_operation='delete_step' then
      update public.prompt_chain_steps set archived_at=now() where id=step_id;
      update public.prompt_chain_steps set position=position-1 where prompt_chain_id=p_chain and archived_at is null and position>step_position;
    elsif p_operation='move_step' then
      destination := (p_values->>'position')::integer;
      if destination is null or destination not between 1 and step_count then raise exception 'Invalid destination.'; end if;
      update public.prompt_chain_steps set position=case
        when id=step_id then destination
        when step_position<destination then position-1
        else position+1 end
      where prompt_chain_id=p_chain and archived_at is null and position between least(step_position,destination) and greatest(step_position,destination);
    else
      raise exception 'Invalid operation.';
    end if;
  end if;
  update public.prompt_chains set version=version+1 where id=p_chain;
  if exists (
    select 1 from unnest(array['Gordon Ramsay','Cat','Dog']) persona(name)
    where not exists (
      select 1 from public.prompt_chains c join public.prompt_chain_mix mix on mix.prompt_chain_id=c.id
      where c.persona=persona.name and c.enabled and c.archived_at is null and mix.enabled and mix.weight>0
      and exists(select 1 from public.prompt_chain_steps s where s.prompt_chain_id=c.id and s.archived_at is null and s.position=1)
      and not exists (
        select 1 from public.prompt_chain_steps s
        join public.llm_models m on m.id=s.llm_model_id
        join public.llm_providers p on p.id=m.provider_id
        where s.prompt_chain_id=c.id and s.archived_at is null
          and (not m.enabled or not p.enabled or p.api_family<>'gemini' or (s.position=1 and not m.supports_images))
      )
    )
  ) then
    raise exception 'Keep at least one runnable live chain for each Foodfolio character.' using errcode='23514';
  end if;
  return p_chain;
end;
$$;
revoke all on function public.foodfolio_edit_chain(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.foodfolio_edit_chain(uuid,integer,text,jsonb) to authenticated;

create or replace function public.foodfolio_generation_start(p_persona text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare chosen record; result jsonb; request_id uuid; config jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_persona not in ('Gordon Ramsay','Cat','Dog') or length(p_input::text)>5000 then raise exception 'Invalid generation context' using errcode='22023'; end if;
 select c.* into chosen from public.prompt_chains c join public.prompt_chain_mix mix on mix.prompt_chain_id=c.id
 where c.persona=p_persona and c.archived_at is null and c.enabled and mix.enabled and mix.weight>0
 and exists(select 1 from public.prompt_chain_steps s where s.prompt_chain_id=c.id and s.archived_at is null)
 and not exists(select 1 from public.prompt_chain_steps s join public.llm_models m on m.id=s.llm_model_id join public.llm_providers p on p.id=m.provider_id where s.prompt_chain_id=c.id and s.archived_at is null and (not m.enabled or not p.enabled or p.api_family<>'gemini' or (s.position=1 and not m.supports_images)))
 order by -ln(greatest(random(),0.000001))/mix.weight limit 1;
 if not found then raise exception 'No enabled prompt chain for this character. Ask an administrator to check the chain mix and models.'; end if;
 select jsonb_build_object('id',chosen.id,'name',chosen.name,'version',chosen.version,'steps',(select jsonb_agg(jsonb_build_object('id',s.id,'position',s.position,'name',s.name,'instruction',s.instruction,'model_id',m.model_id,'temperature',s.temperature,'max_output_tokens',s.max_output_tokens) order by s.position) from public.prompt_chain_steps s join public.llm_models m on m.id=s.llm_model_id where s.prompt_chain_id=chosen.id and s.archived_at is null),
 'terms',(select coalesce(jsonb_agg(jsonb_build_object('term',term,'definition',definition,'example',example)),'[]') from (select * from public.terms where enabled order by term limit 5) t),
 'examples',(select coalesce(jsonb_agg(jsonb_build_object('input',input_text,'output',output_text)),'[]') from (select * from public.ai_generation_examples where enabled and (prompt_chain_id=chosen.id or prompt_chain_id is null) order by created_at desc limit 2) e)) into config;
 insert into public.generation_requests(user_id,prompt_chain_id,input_context,chain_snapshot) values(auth.uid(),chosen.id,p_input,config) returning id into request_id;
 return jsonb_build_object('request_id',request_id,'chain',config);
end; $$;
revoke all on function public.foodfolio_generation_start(text,jsonb) from public,anon;
grant execute on function public.foodfolio_generation_start(text,jsonb) to authenticated;
create function public.foodfolio_chain_captions(p_chain uuid)
returns table(id uuid, created_at timestamptz, caption text)
language sql stable security definer set search_path='' as $$
  select r.id, r.created_at, g.caption
  from public.generation_requests r
  join public.caption_generations g on g.id=r.generation_id
  where public.foodfolio_is_admin() and r.prompt_chain_id=p_chain and r.status='succeeded'
  order by r.created_at desc, r.id desc
  limit 25;
$$;
revoke all on function public.foodfolio_chain_captions(uuid) from public,anon;
grant execute on function public.foodfolio_chain_captions(uuid) to authenticated;

commit;
