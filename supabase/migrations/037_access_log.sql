-- 037_access_log.sql
-- Histórico de acessos por conta (IP, aparelho, cidade) + detecção de
-- ACESSO SIMULTÂNEO. Tudo calculado aqui no banco, numa função atômica por
-- conta, chamada pelo /api/user/heartbeat com a service role.
--
-- Vocabulário (o painel admin usa as mesmas palavras):
--   aparelho  = um navegador com armazenamento próprio. O id é um UUID que o
--               site grava no localStorage: TODAS as abas do mesmo navegador
--               mandam o MESMO id. Trocar de rede não muda o aparelho.
--   sessão    = presença contínua de um aparelho num IP (pings com folga de
--               até 10 min). IP novo abre sessão nova: é ela que vira linha
--               no histórico de IPs.
--   uso ativo = ping com a aba VISÍVEL e alguém mexendo (tecla, clique,
--               toque, rolagem ou mouse) nos últimos 45 s.
--   corrida   = sequência de pings de uso ativo do mesmo aparelho, sem buraco
--               maior que 90 s.
--   acesso simultâneo = corridas de DOIS aparelhos diferentes sobrepostas
--               por pelo menos 90 s.
--
-- Por que isso não gera falso positivo:
--   • abas do mesmo navegador = mesmo aparelho → nunca contam;
--   • troca de rede (wi-fi → 4G, IPv4 ↔ IPv6) = mesmo aparelho → nunca conta;
--   • trocar de aparelho (larga o PC, pega o celular): a corrida do PC morre
--     no máximo 45 s depois do último toque, então a sobreposição fica abaixo
--     de 45 s, longe dos 90 s exigidos;
--   • aba esquecida aberta / em segundo plano: sem toque não é uso ativo.
-- E por que não perde os casos reais: duas pessoas usando a mesma conta
-- mexem nos dois aparelhos ao mesmo tempo por minutos, não segundos.
--
-- Mesmo computador: dois navegadores (ou janela anônima) no MESMO IP com a
-- MESMA impressão de máquina (tela, núcleos, fuso, sistema) ficam marcados
-- same_machine = true. Aparecem no histórico como aviso separado, mas não
-- entram na contagem de "acesso simultâneo".
--
-- Segurança: as 3 tabelas têm RLS ligado e NENHUMA policy; só a service role
-- lê e escreve. A função só executa pela service role (o IP vem do header
-- da Vercel no servidor, o cliente não consegue forjar).
--
-- Repetível: pode rodar de novo sem quebrar nada.

-- ─── 1. Aparelhos ────────────────────────────────────────────────────
create table if not exists public.access_devices (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  device_id       text not null check (char_length(device_id) between 8 and 80),
  machine_fp      text check (machine_fp is null or char_length(machine_fp) <= 80),
  user_agent      text,
  browser         text,
  os              text,
  device_kind     text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_ip         text,
  last_place      text,
  run_started_at  timestamptz,
  run_last_at     timestamptz,
  run_ip          text,
  run_place       text,
  primary key (user_id, device_id)
);

create index if not exists access_devices_run_idx
  on public.access_devices (user_id, run_last_at desc);

-- ─── 2. Sessões (histórico de IPs) ───────────────────────────────────
create table if not exists public.access_sessions (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  device_id       text not null,
  ip              text,
  city            text,
  region          text,
  country         text,
  browser         text,
  os              text,
  device_kind     text,
  started_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  pings           integer not null default 1,
  active_seconds  integer not null default 0
);

create index if not exists access_sessions_user_idx
  on public.access_sessions (user_id, last_seen_at desc);
create index if not exists access_sessions_device_idx
  on public.access_sessions (user_id, device_id, last_seen_at desc);
create index if not exists access_sessions_last_idx
  on public.access_sessions (last_seen_at desc);

-- ─── 3. Eventos de acesso simultâneo ─────────────────────────────────
create table if not exists public.access_concurrency (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  device_a      text not null,
  device_b      text not null,
  ip_a          text,
  ip_b          text,
  place_a       text,
  place_b       text,
  label_a       text,
  label_b       text,
  same_network  boolean not null default false,
  same_machine  boolean not null default false,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  created_at    timestamptz not null default now(),
  check (device_a < device_b),
  check (ended_at >= started_at)
);

create index if not exists access_concurrency_user_idx
  on public.access_concurrency (user_id, ended_at desc);
create index if not exists access_concurrency_ended_idx
  on public.access_concurrency (ended_at desc);

-- ─── 4. Trancas ──────────────────────────────────────────────────────
alter table public.access_devices enable row level security;
alter table public.access_sessions enable row level security;
alter table public.access_concurrency enable row level security;

revoke all on public.access_devices from anon, authenticated;
revoke all on public.access_sessions from anon, authenticated;
revoke all on public.access_concurrency from anon, authenticated;
grant all on public.access_devices to service_role;
grant all on public.access_sessions to service_role;
grant all on public.access_concurrency to service_role;

-- ─── 5. Mesma rede? ──────────────────────────────────────────────────
-- Mesmo IP, ou o mesmo /64 no IPv6 (uma casa/escritório recebe um /64
-- inteiro e cada aparelho pode sair por um endereço diferente dele).
create or replace function public.access_same_network(a text, b text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  ia inet;
  ib inet;
begin
  if a is null or b is null then
    return false;
  end if;
  if a = b then
    return true;
  end if;
  begin
    ia := a::inet;
    ib := b::inet;
  exception when others then
    return false;
  end;
  if family(ia) = 6 and family(ib) = 6 then
    return network(set_masklen(ia, 64)) = network(set_masklen(ib, 64));
  end if;
  return false;
end;
$$;

-- ─── 6. O ping ───────────────────────────────────────────────────────
create or replace function public.touch_access(
  p_user     uuid,
  p_device   text,
  p_fp       text,
  p_ip       text,
  p_ua       text,
  p_browser  text,
  p_os       text,
  p_kind     text,
  p_city     text,
  p_region   text,
  p_country  text,
  p_engaged  boolean,
  p_at       timestamptz default null  -- só os testes passam; o heartbeat usa o relógio do banco
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c_session_gap  constant interval := interval '10 minutes';
  c_run_gap      constant interval := interval '90 seconds';
  c_min_overlap  constant interval := interval '90 seconds';
  c_merge_gap    constant interval := interval '5 minutes';

  v_now        timestamptz;
  v_dev        public.access_devices%rowtype;
  v_has_dev    boolean;
  v_place      text;
  v_label      text;
  v_sid        bigint;
  v_active_add integer := 0;
  v_run_start  timestamptz;
  v_run_live   boolean;
  o            public.access_devices%rowtype;
  v_ov_start   timestamptz;
  v_ov_end     timestamptz;
  v_same_net   boolean;
  v_same_mach  boolean;
  v_a          text;
  v_b          text;
  v_mine_is_a  boolean;
  v_o_label    text;
  v_ev_id      bigint;
  v_new        integer := 0;
begin
  if p_user is null or p_device is null
     or char_length(p_device) < 8 or char_length(p_device) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'device');
  end if;

  -- Uma conta por vez: dois pings da mesma conta chegando juntos (duas abas,
  -- dois aparelhos) nunca abrem sessão ou evento duplicado.
  perform pg_advisory_xact_lock(hashtextextended('access:' || p_user::text, 0));
  v_now := coalesce(p_at, clock_timestamp());

  v_place := nullif(concat_ws(', ', nullif(p_city, ''), nullif(p_region, ''), nullif(p_country, '')), '');
  v_label := nullif(concat_ws(' · ', nullif(p_browser, ''), nullif(p_os, '')), '');

  select * into v_dev
    from public.access_devices
   where user_id = p_user and device_id = p_device;
  v_has_dev := found;

  if not v_has_dev then
    -- Freio: id de aparelho é gerado pelo navegador. Ninguém usa 60 aparelhos
    -- novos num dia; acima disso é lixo e não entra.
    if (select count(*) from public.access_devices
         where user_id = p_user and first_seen_at >= v_now - interval '1 day') >= 60 then
      return jsonb_build_object('ok', false, 'reason', 'device_flood');
    end if;
    insert into public.access_devices (
      user_id, device_id, machine_fp, user_agent, browser, os, device_kind,
      first_seen_at, last_seen_at, last_ip, last_place
    ) values (
      p_user, p_device, p_fp, left(p_ua, 400), p_browser, p_os, p_kind,
      v_now, v_now, p_ip, v_place
    )
    returning * into v_dev;
  else
    update public.access_devices
       set machine_fp   = coalesce(p_fp, machine_fp),
           user_agent   = coalesce(left(p_ua, 400), user_agent),
           browser      = coalesce(p_browser, browser),
           os           = coalesce(p_os, os),
           device_kind  = coalesce(p_kind, device_kind),
           last_seen_at = v_now,
           last_ip      = coalesce(p_ip, last_ip),
           last_place   = coalesce(v_place, last_place)
     where user_id = p_user and device_id = p_device;
  end if;

  -- Corrida de uso ativo deste aparelho ainda viva?
  v_run_live := v_dev.run_last_at is not null and v_dev.run_last_at >= v_now - c_run_gap;
  if p_engaged and v_run_live then
    v_active_add := least(90, greatest(0, floor(extract(epoch from (v_now - v_dev.run_last_at)))))::integer;
  end if;

  -- ── Sessão (linha do histórico de IPs) ──
  select id into v_sid
    from public.access_sessions
   where user_id = p_user
     and device_id = p_device
     and ip is not distinct from p_ip
     and last_seen_at >= v_now - c_session_gap
   order by last_seen_at desc
   limit 1;

  if v_sid is not null then
    update public.access_sessions
       set last_seen_at   = v_now,
           pings          = pings + 1,
           active_seconds = active_seconds + v_active_add,
           city           = coalesce(p_city, city),
           region         = coalesce(p_region, region),
           country        = coalesce(p_country, country),
           browser        = coalesce(p_browser, browser),
           os             = coalesce(p_os, os),
           device_kind    = coalesce(p_kind, device_kind)
     where id = v_sid;
  else
    insert into public.access_sessions (
      user_id, device_id, ip, city, region, country, browser, os, device_kind,
      started_at, last_seen_at, pings, active_seconds
    ) values (
      p_user, p_device, p_ip, p_city, p_region, p_country, p_browser, p_os, p_kind,
      v_now, v_now, 1, v_active_add
    )
    returning id into v_sid;
  end if;

  -- ── Uso ativo + simultâneo ──
  if p_engaged then
    v_run_start := case when v_run_live then v_dev.run_started_at else v_now end;
    update public.access_devices
       set run_started_at = v_run_start,
           run_last_at    = v_now,
           run_ip         = p_ip,
           run_place      = v_place
     where user_id = p_user and device_id = p_device;

    for o in
      select *
        from public.access_devices
       where user_id = p_user
         and device_id <> p_device
         and run_last_at is not null
         and run_last_at >= v_now - c_run_gap
    loop
      v_ov_start := greatest(v_run_start, o.run_started_at);
      v_ov_end := least(v_now, o.run_last_at);
      continue when v_ov_end <= v_ov_start;

      v_same_net := public.access_same_network(p_ip, o.run_ip);
      v_same_mach := v_same_net and p_fp is not null and o.machine_fp is not null
                     and p_fp = o.machine_fp;
      v_mine_is_a := p_device < o.device_id;
      v_a := least(p_device, o.device_id);
      v_b := greatest(p_device, o.device_id);
      v_o_label := nullif(concat_ws(' · ', nullif(o.browser, ''), nullif(o.os, '')), '');

      select id into v_ev_id
        from public.access_concurrency
       where user_id = p_user
         and device_a = v_a
         and device_b = v_b
         and ended_at >= v_ov_start - c_merge_gap
       order by ended_at desc
       limit 1;

      if v_ev_id is not null then
        -- Continuação do mesmo episódio: estica o fim. Basta UMA observação
        -- em redes/máquinas diferentes pra o episódio deixar de ser "mesma
        -- rede"/"mesmo computador" — e aí os IPs passam a mostrar a diferença.
        update public.access_concurrency
           set ended_at     = greatest(ended_at, v_ov_end),
               same_network = same_network and v_same_net,
               same_machine = same_machine and v_same_mach,
               ip_a    = case when v_same_net then ip_a    when v_mine_is_a then p_ip     else o.run_ip    end,
               ip_b    = case when v_same_net then ip_b    when v_mine_is_a then o.run_ip else p_ip        end,
               place_a = case when v_same_net then place_a when v_mine_is_a then v_place  else o.run_place end,
               place_b = case when v_same_net then place_b when v_mine_is_a then o.run_place else v_place  end
         where id = v_ev_id;
      elsif v_ov_end - v_ov_start >= c_min_overlap then
        insert into public.access_concurrency (
          user_id, device_a, device_b, ip_a, ip_b, place_a, place_b, label_a, label_b,
          same_network, same_machine, started_at, ended_at
        ) values (
          p_user, v_a, v_b,
          case when v_mine_is_a then p_ip else o.run_ip end,
          case when v_mine_is_a then o.run_ip else p_ip end,
          case when v_mine_is_a then v_place else o.run_place end,
          case when v_mine_is_a then o.run_place else v_place end,
          case when v_mine_is_a then v_label else v_o_label end,
          case when v_mine_is_a then v_o_label else v_label end,
          v_same_net, v_same_mach, v_ov_start, v_ov_end
        );
        v_new := v_new + 1;
      end if;
    end loop;
  end if;

  -- Faxina rara: histórico de sessão guarda 1 ano.
  if random() < 0.002 then
    delete from public.access_sessions where last_seen_at < v_now - interval '365 days';
  end if;

  return jsonb_build_object('ok', true, 'session', v_sid, 'concurrent_new', v_new);
end;
$$;

revoke all on function public.touch_access(uuid, text, text, text, text, text, text, text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.touch_access(uuid, text, text, text, text, text, text, text, text, text, text, boolean, timestamptz)
  to service_role;
revoke all on function public.access_same_network(text, text) from public, anon, authenticated;
grant execute on function public.access_same_network(text, text) to service_role;

comment on table public.access_sessions is
  'Histórico de acesso: uma linha por aparelho+IP contínuo. Escrito por touch_access (heartbeat).';
comment on table public.access_concurrency is
  'Acesso simultâneo: dois aparelhos em uso ativo sobrepostos >= 90 s. same_machine = provável mesmo computador.';
