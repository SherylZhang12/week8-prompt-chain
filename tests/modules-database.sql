begin;
do $$ begin perform set_config('request.jwt.claim.sub',(select id::text from public.profiles where is_superadmin limit 1),true); end $$;
set local role authenticated;
do $$
declare cid uuid; sid uuid; mid uuid; snap jsonb; rev integer; active_id uuid;
begin
 select id into mid from public.llm_models where model_id='gemini-3.5-flash-lite';
 cid:=public.foodfolio_edit_chain(null,0,'create','{"name":"Week8 module regression rollback","module":"group-order","description":"Disposable transaction test"}');
 if (select persona is not null from public.prompt_chains where id=cid) then raise exception 'Workflow assigned a caption persona'; end if;
 perform public.foodfolio_edit_chain(cid,1,'add_step',jsonb_build_object('name','A','instruction','Analyze diners','model',mid));
 perform public.foodfolio_edit_chain(cid,2,'add_step',jsonb_build_object('name','B','instruction','Check menu','model',mid));
 select id into sid from public.prompt_chain_steps where prompt_chain_id=cid and position=2;
 perform public.foodfolio_edit_chain(cid,3,'move_step',jsonb_build_object('step',sid,'position',1));
 snap:=public.foodfolio_workflow_snapshot('group-order',cid,4);
 if snap#>>'{steps,0,name}' <> 'B' then raise exception 'Saved reorder did not reach snapshot'; end if;
 begin perform public.foodfolio_edit_chain(cid,3,'save_chain','{"name":"stale"}');raise exception 'Stale edit accepted';exception when serialization_failure then null;end;
 begin perform public.foodfolio_edit_chain(cid,4,'save_chain','{"name":"wrong module","module":"meal-coach"}');raise exception 'Module mutation accepted';exception when check_violation then null;end;
 select chain_id into active_id from public.prompt_workflow_routes where module='group-order';
 perform public.foodfolio_activate_workflow(cid,4);
 snap:=public.foodfolio_workflow_snapshot('group-order');
 if snap->>'id'<>cid::text then raise exception 'Live route ignored'; end if;
 begin perform public.foodfolio_edit_chain(cid,4,'delete_chain','{}');raise exception 'Deleted active route';exception when check_violation then null;end;
 select version into rev from public.prompt_chains where id=active_id;
 perform public.foodfolio_activate_workflow(active_id,rev);
 perform public.foodfolio_edit_chain(cid,4,'delete_step',jsonb_build_object('step',sid));
 perform public.foodfolio_edit_chain(cid,5,'delete_chain','{}');
 if exists(select 1 from public.prompt_chains where id=cid) then raise exception 'Archived chain still visible';end if;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);end $$;
set local role authenticated;
do $$ declare snap jsonb; begin
 if exists(select 1 from public.prompt_chains) then raise exception 'Ordinary user can read admin chains';end if;
 if exists(select 1 from public.prompt_workflow_routes) then raise exception 'Ordinary user can read admin routes';end if;
 snap:=public.foodfolio_workflow_snapshot('meal-coach');
 if snap->>'module'<>'meal-coach' or jsonb_array_length(snap->'steps')<>4 then raise exception 'Public workflow snapshot unavailable';end if;
 begin perform public.foodfolio_edit_chain(null,0,'create','{"name":"unauthorized","module":"meal-coach"}');raise exception 'Nonadmin edit accepted';exception when insufficient_privilege then null;end;
 begin perform public.foodfolio_workflow_snapshot('meal-coach',(snap->>'id')::uuid,(snap->>'version')::int);raise exception 'Nonadmin preview accepted';exception when insufficient_privilege then null;end;
 begin perform public.foodfolio_activate_workflow((snap->>'id')::uuid,(snap->>'version')::int);raise exception 'Nonadmin activate accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claim.sub','',true);end $$;
set local role anon;
do $$ begin
 begin perform public.foodfolio_workflow_snapshot('meal-coach');raise exception 'Anonymous snapshot accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'Passed: module CRUD, order, revision checks, live routing, archive protection and admin/ordinary/anonymous permissions. All test changes rolled back.' as result;
