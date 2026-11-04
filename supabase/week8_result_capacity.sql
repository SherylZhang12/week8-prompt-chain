begin;
alter table public.prompt_chain_previews drop constraint prompt_chain_previews_output_check;
alter table public.prompt_chain_previews add constraint prompt_chain_previews_output_check check(length(output)<=64000);
commit;
