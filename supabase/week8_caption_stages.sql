begin;
do $$ declare mid uuid; rec record; begin
select id into mid from public.llm_models where model_id='gemini-3.5-flash-lite' and enabled;
if mid is null then raise exception 'Model unavailable'; end if;
 for rec in select * from public.prompt_chains where module='caption' and archived_at is null and name in (persona || ' · Balanced',persona || ' · Concise') and (select count(*) from public.prompt_chain_steps s where s.prompt_chain_id=prompt_chains.id and s.archived_at is null)=2 loop
   -- Preserve original instructions and historical step identities.
   update public.prompt_chain_steps set position=position+2 where prompt_chain_id=rec.id and archived_at is null;
   insert into public.prompt_chain_steps(prompt_chain_id,position,name,instruction,llm_model_id,temperature,max_output_tokens)
   values(rec.id,1,'Observe the food photo','Extract a concise visual evidence brief from the photo and original dish/context. Note visible shapes, colors, plating and uncertainty. Do not infer taste, freshness, food safety or hidden ingredients. Return working notes in the caption field, not a final reaction.',mid,0.4,1024),
   (rec.id,2,'Plan the character and reaction','Use the previous evidence brief and original context. Identify the requested persona and reaction style, choose grounded details to mention, and plan the tone and length. Pets must speak as the fictional pet, never the chef. Return a concise working brief in the caption field.',mid,0.4,1024);
   update public.prompt_chain_steps set name=case position when 3 then 'Draft the persona reaction' when 4 then 'Polish and check the final caption' else name end,llm_model_id=mid where prompt_chain_id=rec.id and archived_at is null;
   update public.prompt_chains set version=version+1 where id=rec.id;
 end loop;
end; $$;
commit;
