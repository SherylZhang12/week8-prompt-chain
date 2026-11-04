begin;
alter table public.prompt_chains add column module text not null default 'caption' check(module in ('caption','meal-coach','group-order'));
alter table public.prompt_chains alter column persona drop not null;
alter table public.prompt_chains add constraint prompt_chains_module_persona check ((module='caption' and persona is not null) or (module<>'caption' and persona is null));
create table public.prompt_workflow_routes (
 module text primary key check(module in ('meal-coach','group-order')),
 chain_id uuid not null references public.prompt_chains(id),
 updated_at timestamptz not null default now()
);
alter table public.prompt_workflow_routes enable row level security;
revoke all on public.prompt_workflow_routes from public,anon,authenticated;
grant select on public.prompt_workflow_routes to authenticated;
create policy admin_read on public.prompt_workflow_routes for select to authenticated using ((select public.foodfolio_is_admin()));
create function public.foodfolio_chain_runnable(p_chain uuid,p_module text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.prompt_chain_steps s where s.prompt_chain_id=p_chain and s.archived_at is null)
 and not exists(select 1 from public.prompt_chain_steps s join public.llm_models m on m.id=s.llm_model_id join public.llm_providers p on p.id=m.provider_id where s.prompt_chain_id=p_chain and s.archived_at is null and (not m.enabled or not p.enabled or p.api_family<>'gemini' or (s.position=1 and p_module<>'group-order' and not m.supports_images)));
$$;
revoke all on function public.foodfolio_chain_runnable(uuid,text) from public,anon,authenticated;
create function public.foodfolio_workflow_snapshot(p_module text,p_chain uuid default null,p_revision integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare chosen public.prompt_chains; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_module not in ('meal-coach','group-order') then raise exception 'Invalid module'; end if;
 if p_chain is not null then
   if not coalesce(public.foodfolio_is_admin(),false) then raise exception 'Superadmin access required' using errcode='42501'; end if;
   select * into chosen from public.prompt_chains where id=p_chain and module=p_module and archived_at is null;
   if chosen.version is distinct from p_revision then raise exception 'This chain changed. Refresh and retry.' using errcode='40001'; end if;
 else
   select c.* into chosen from public.prompt_chains c join public.prompt_workflow_routes r on r.chain_id=c.id and r.module=c.module where r.module=p_module and c.enabled and c.archived_at is null;
 end if;
 if chosen.id is null or not public.foodfolio_chain_runnable(chosen.id,p_module) then raise exception 'No runnable chain for this module. Check the workflow route and models.'; end if;
 select jsonb_build_object('id',chosen.id,'name',chosen.name,'version',chosen.version,'module',chosen.module,'steps',(select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'instruction',s.instruction,'position',s.position,'model_id',m.model_id,'temperature',s.temperature,'max_output_tokens',s.max_output_tokens) order by s.position) from public.prompt_chain_steps s join public.llm_models m on m.id=s.llm_model_id where s.prompt_chain_id=chosen.id and s.archived_at is null)) into result;
 return result;
end; $$;
revoke all on function public.foodfolio_workflow_snapshot(text,uuid,integer) from public,anon;
grant execute on function public.foodfolio_workflow_snapshot(text,uuid,integer) to authenticated;
create function public.foodfolio_activate_workflow(p_chain uuid,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare c public.prompt_chains;
begin
 if not coalesce(public.foodfolio_is_admin(),false) then raise exception 'Superadmin access required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(812092);
 select * into c from public.prompt_chains where id=p_chain and archived_at is null for update;
 if c.version is distinct from p_revision then raise exception 'This chain changed. Refresh and retry.' using errcode='40001'; end if;
 if c.module not in ('meal-coach','group-order') or not c.enabled or not public.foodfolio_chain_runnable(c.id,c.module) then raise exception 'Select a runnable workflow chain.' using errcode='23514'; end if;
 insert into public.prompt_workflow_routes(module,chain_id) values(c.module,c.id) on conflict(module) do update set chain_id=excluded.chain_id,updated_at=now();
end; $$;
revoke all on function public.foodfolio_activate_workflow(uuid,integer) from public,anon;
grant execute on function public.foodfolio_activate_workflow(uuid,integer) to authenticated;
create or replace function public.foodfolio_edit_chain(p_chain uuid,p_revision integer,p_operation text,p_values jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  current_revision integer;
  new_id uuid;
  step_id uuid;
  step_position integer;
  step_count integer;
  destination integer;
  chain_module text;
begin
  if not coalesce(public.foodfolio_is_admin(),false) then
    raise exception 'Superadmin access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(812092);
  if p_operation='create' then
    insert into public.prompt_chains(name,description,persona,module) values(p_values->>'name',p_values->>'description',case when coalesce(p_values->>'module','caption')='caption' then p_values->>'persona' else null end,coalesce(p_values->>'module','caption')) returning id into new_id;
    insert into public.prompt_chain_mix(prompt_chain_id,weight,enabled) values(new_id,0,false);
    return new_id;
  end if;
  select version into current_revision from public.prompt_chains where id=p_chain and archived_at is null for update;
  if current_revision is distinct from p_revision or current_revision is null then
    raise exception 'This chain changed. Refresh and retry.' using errcode='40001';
  end if;
  select module into chain_module from public.prompt_chains where id=p_chain;
  if p_values ? 'module' and p_values->>'module' <> chain_module then raise exception 'Create a new chain to change its module.' using errcode='23514'; end if;
  if p_operation='delete_chain' then
    update public.prompt_chains set archived_at=now(), enabled=false where id=p_chain;
  elsif p_operation='save_chain' then
    update public.prompt_chains set name=p_values->>'name', description=p_values->>'description', persona=case when chain_module='caption' then p_values->>'persona' else null end where id=p_chain;
  else
    step_id := (p_values->>'step')::uuid;
    select position into step_position from public.prompt_chain_steps where prompt_chain_id=p_chain and archived_at is null and id=step_id;
    select count(*) into step_count from public.prompt_chain_steps where prompt_chain_id=p_chain and archived_at is null;
    if p_operation='add_step' then
      if step_count>=6 then raise exception 'A chain supports up to six steps.'; end if;
      insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,max_output_tokens)
      values(p_chain,step_count+1,p_values->>'name',p_values->>'instruction',(p_values->>'model')::uuid,case when chain_module='caption' then 1024 else 7000 end);
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
  if exists (select 1 from public.prompt_workflow_routes r join public.prompt_chains c on c.id=r.chain_id where r.chain_id=p_chain and (c.archived_at is not null or not c.enabled or not public.foodfolio_chain_runnable(c.id,c.module))) then raise exception 'Activate another runnable chain before removing or disabling this live workflow.' using errcode='23514'; end if;
  return p_chain;
end;
$$;
revoke all on function public.foodfolio_edit_chain(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.foodfolio_edit_chain(uuid,integer,text,jsonb) to authenticated;

do $$ declare cid uuid; mid uuid; rec record; begin
 select id into mid from public.llm_models where model_id='gemini-3.5-flash-lite' and enabled;
 if mid is null then raise exception 'Register the verified image-capable Gemini model first'; end if;
insert into public.prompt_chains(name,description,module,persona) values('Daily Meal Coach · Standard','Four editable stages shared by the public application and Prompt Chain Lab.','meal-coach',null) returning id into cid;
insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,temperature,max_output_tokens) values(cid,1,'Observe uploaded meals','Describe only the uploaded meal slots in their original order. Separate visible food details from self-reported portion and ingredient notes. State uncertainty; never estimate exact nutrition or invent unuploaded meals. Output concise working analysis.',mid,0.4,7000);
insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,temperature,max_output_tokens) values(cid,2,'Map goals and restrictions','Use the previous meal observations plus original profile to identify cuisine preferences, stated goals and dietary restrictions. Identify exactly the supplied target meals and plan day. Keep body measurements private; do not prescribe numeric targets. Output a practical planning brief.',mid,0.4,7000);
insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,temperature,max_output_tokens) values(cid,3,'Draft next-meal suggestions','Use the previous brief and original context to draft one practical idea and compatible alternative for every target meal. Explain meal composition and goal fit. Include observations of every uploaded meal, improvements, and specific clarification questions. Do not invent restaurants or imply a meal compensates for earlier eating.',mid,0.4,7000);
insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,temperature,max_output_tokens) values(cid,4,'Check and format the meal plan','Review the previous draft against the original restrictions, preferences, uploaded and target meal slots. Correct omissions and unsupported photo claims. Return the complete meal-plan JSON in the required schema. Preserve uncertainty, practical swaps and follow-up questions; never include numeric intake prescriptions or guaranteed outcomes.',mid,0.4,7000);
insert into public.prompt_workflow_routes(module,chain_id) values('meal-coach',cid);
insert into public.prompt_chains(name,description,module,persona) values('Group Ordering · Standard','Four editable stages shared by the public application and Prompt Chain Lab.','group-order',null) returning id into cid;
insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,temperature,max_output_tokens) values(cid,1,'Map every diner’s needs','Create a separate brief for EVERY anonymous diner ID in original order, retaining wants, avoids, restrictions, budget/spice notes and conflicts. Never let the majority override a restriction. Output working analysis without diner names.',mid,0.4,7000);
insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,temperature,max_output_tokens) values(cid,2,'Check supplied menu evidence','Use the diner brief and original supplied restaurant cuisine/menu. If a pasted menu exists, extract only explicitly supplied candidates and unknown ingredients/availability. Otherwise identify only conditional dish types to ask about IF AVAILABLE. Do not invent dishes, prices, reviews or verified allergens.',mid,0.4,7000);
insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,temperature,max_output_tokens) values(cid,3,'Draft individual and sharing ideas','Build on the previous menu evidence to propose ideas, requested adjustments and reasons for every diner in original order. Address preference conflicts honestly. Suggest sharing only when compatible with everyone; otherwise keep dishes separate or say a suitable option is unknown.',mid,0.4,7000);
insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,temperature,max_output_tokens) values(cid,4,'Verify restrictions and format orders','Audit the draft for every diner ID, explicit avoids/restrictions, evidence and missing information. Remove invented menu claims and allergy-safe guarantees. Return complete ordering JSON in the required schema, with individual ideas/adjustments/reasons, conditional sharing and questions for staff about menu, ingredients and cross-contact.',mid,0.4,7000);
insert into public.prompt_workflow_routes(module,chain_id) values('group-order',cid);

end; $$;
commit;
