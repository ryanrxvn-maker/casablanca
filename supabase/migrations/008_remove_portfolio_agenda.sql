-- 008_remove_portfolio_agenda.sql
--
-- Limpeza pos-restructure do DARKO LAB:
-- removidas completamente as areas de Portfolio (public /p/[slug], editor,
-- provas sociais) e Agenda (Google Calendar clone), ja deletadas do
-- codigo-fonte (app/portfolio, app/p/[slug], app/tools/agenda,
-- lib/portfolio-upload.ts, lib/agenda.ts).
--
-- Esta migracao derruba tudo que sobrou no banco: tabelas, colunas,
-- policies, RPCs e buckets de storage.
--
-- IMPORTANTE: esta migracao e DESTRUTIVA. Se existem dados que voce quer
-- preservar (videos de portfolio, tasks de agenda), faca export antes de
-- rodar. No deploy atual do DARKO LAB, esses dados estao todos obsoletos.

-- ============================================================
-- 1. RPC publica do portfolio
-- ============================================================
drop function if exists public.get_public_profile_by_slug(text) cascade;

-- ============================================================
-- 2. Tabelas do portfolio
-- ============================================================
drop table if exists public.portfolio_items cascade;
drop table if exists public.portfolio_categories cascade;
drop table if exists public.portfolio_proofs cascade;
drop table if exists public.provas_sociais cascade;

-- ============================================================
-- 3. Tabelas da agenda
-- ============================================================
drop table if exists public.agenda_occurrences cascade;
drop table if exists public.agenda_tasks cascade;

-- ============================================================
-- 4. Colunas legadas no profiles
-- ============================================================
alter table public.profiles drop column if exists portfolio_public;
alter table public.profiles drop column if exists portfolio_slug;
alter table public.profiles drop column if exists portfolio_cover;
alter table public.profiles drop column if exists portfolio_show_avatar;
alter table public.profiles drop column if exists portfolio_bio;
alter table public.profiles drop column if exists portfolio_headline;

-- ============================================================
-- 5. Buckets de storage
-- ============================================================
-- Apaga objetos dos buckets primeiro (pre-requisito pra dropar o bucket).
delete from storage.objects where bucket_id = 'portfolio-videos';
delete from storage.objects where bucket_id = 'portfolio-thumbnails';
delete from storage.objects where bucket_id = 'portfolio-proofs';

delete from storage.buckets where id in (
  'portfolio-videos',
  'portfolio-thumbnails',
  'portfolio-proofs'
);

-- ============================================================
-- 6. Policies orfas (defensivo — a maioria ja cai via CASCADE)
-- ============================================================
-- Se alguma policy antiga sobrou referenciando os objetos acima,
-- esta funcao drop cascade ja cuidou. Nada pra fazer aqui.

-- ============================================================
-- Sanity check (opcional)
-- ============================================================
-- Rode manualmente apos aplicar:
--   select table_name from information_schema.tables
--    where table_schema='public' and table_name in
--      ('portfolio_items','portfolio_categories','agenda_tasks','agenda_occurrences');
-- Deve retornar 0 linhas.
