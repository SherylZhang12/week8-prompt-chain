begin;
select set_config('lab_test.admin', (select id::text from public.profiles where is_superadmin limit 1), true);
select set_config('lab_test.member', (select id::text from public.profiles where not is_superadmin limit 1), true);
select set_config('lab_test.model', (select id::text from public.llm_models where model_id='gemini-3.1-flash-lite'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('lab_test.admin'),true);
do $$
declare chain uuid; step uuid; other uuid; model text:=current_setting('lab_test.model'); positions text[];
begin
  if not public.foodfolio_is_admin() then raise exception 'Missing authorized fixture'; end if;
  insert into public.lab_chains(name) values('Week 8 rollback fixture') returning id into chain;
  perform public.lab_edit(chain,1,'save_chain','{"name":"Week 8 edited fixture","description":"Test"}');
  perform public.lab_edit(chain,2,'add_step',jsonb_build_object('name','One','instruction','First','model',model));
  perform public.lab_edit(chain,3,'add_step',jsonb_build_object('name','Two','instruction','Second','model',model));
  select id into step from public.lab_steps where chain_id=chain and position=2;
  perform public.lab_edit(chain,4,'save_step',jsonb_build_object('step',step,'name','Updated','instruction','Second','model',model));
  perform public.lab_edit(chain,5,'move_step',jsonb_build_object('step',step,'position',1));
  set constraints all immediate;
  select array_agg(name order by position) into positions from public.lab_steps where chain_id=chain;
  if positions is distinct from array['Updated','One'] then raise exception 'Move did not persist'; end if;
  begin
    perform public.lab_edit(chain,5,'delete_step',jsonb_build_object('step',step));
    raise exception 'Stale revision was accepted';
  exception when serialization_failure then null;
  end;
  perform public.lab_edit(chain,6,'delete_step',jsonb_build_object('step',step));
  if not exists(select from public.lab_steps where chain_id=chain and position=1 and name='One') then raise exception 'Gap after delete'; end if;
  insert into public.lab_chains(name) values('Week 8 second rollback fixture') returning id into other;
  insert into public.lab_runs(chain_id,status,revision,output,trace) values(chain,'succeeded',7,'fixture text','[]');
  if exists(select from public.lab_runs where chain_id=other) then raise exception 'History leaked across chains'; end if;
  perform public.lab_edit(chain,7,'delete_chain','{}');
  if exists(select from public.lab_runs where chain_id=chain) or exists(select from public.lab_steps where chain_id=chain) then raise exception 'Delete did not cascade'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('lab_test.member'),true);
do $$
begin
  if public.foodfolio_is_admin() or exists(select from public.lab_chains) then raise exception 'Member could read workspace'; end if;
  begin
    perform public.lab_edit(gen_random_uuid(),1,'delete_chain','{}');
    raise exception 'Member could execute edit';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.lab_chains(name) values('Unauthorized');
    raise exception 'Member could insert';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
