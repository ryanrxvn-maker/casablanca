/**
 * Resumo do histórico de acesso de UMA conta pro perfil do admin
 * (migration 037). Puro: recebe as linhas do banco e devolve o que a tela
 * mostra. Datas por dia sempre no fuso de São Paulo.
 */

export type AccessSessionRow = {
  id: number;
  device_id: string;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device_kind: string | null;
  started_at: string;
  last_seen_at: string;
  pings: number;
  active_seconds: number;
};

export type AccessDeviceRow = {
  device_id: string;
  browser: string | null;
  os: string | null;
  device_kind: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_ip: string | null;
  last_place: string | null;
};

export type AccessEventRow = {
  id: number;
  device_a: string;
  device_b: string;
  ip_a: string | null;
  ip_b: string | null;
  place_a: string | null;
  place_b: string | null;
  label_a: string | null;
  label_b: string | null;
  same_network: boolean;
  same_machine: boolean;
  started_at: string;
  ended_at: string;
};

export type IpSummary = {
  ip: string;
  place: string | null;
  firstSeen: string;
  lastSeen: string;
  sessions: number;
  connectedSeconds: number;
  activeSeconds: number;
  devices: string[];
  /** episódios de acesso simultâneo (não "mesmo computador") com este IP */
  concurrent: number;
};

export type DeviceSummary = {
  deviceId: string;
  label: string;
  kind: string | null;
  firstSeen: string;
  lastSeen: string;
  ips: number;
  activeSeconds: number;
  lastIp: string | null;
  lastPlace: string | null;
};

export type DaySummary = {
  day: string; // YYYY-MM-DD (São Paulo)
  activeSeconds: number;
  connectedSeconds: number;
  sessions: number;
};

export type AccessSummary = {
  ips: IpSummary[];
  devices: DeviceSummary[];
  days: DaySummary[];
  totals: {
    activeSeconds: number;
    connectedSeconds: number;
    ips: number;
    devices: number;
    concurrent: number;
    sameMachine: number;
    firstAt: string | null;
  };
};

const TZ = 'America/Sao_Paulo';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Dia (YYYY-MM-DD) do instante no fuso de São Paulo. */
export function dayKeySP(iso: string | number | Date): string {
  return dayFmt.format(new Date(iso));
}

export function placeOf(r: { city?: string | null; region?: string | null; country?: string | null }): string | null {
  const parts = [r.city, r.region, r.country].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length ? parts.join(', ') : null;
}

function label(browser: string | null | undefined, os: string | null | undefined): string {
  const parts = [browser, os].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length ? parts.join(' · ') : 'Aparelho desconhecido';
}

const secs = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));

export function summarizeAccess(
  sessions: AccessSessionRow[],
  devices: AccessDeviceRow[],
  events: AccessEventRow[],
  dayCount = 30,
  now: number = Date.now(),
): AccessSummary {
  const realEvents = events.filter((e) => !e.same_machine);

  // ── por IP ──
  const byIp = new Map<string, IpSummary & { _devices: Set<string> }>();
  for (const s of sessions) {
    const ip = s.ip || 'desconhecido';
    const connected = secs(s.started_at, s.last_seen_at);
    let cur = byIp.get(ip);
    if (!cur) {
      cur = {
        ip,
        place: placeOf(s),
        firstSeen: s.started_at,
        lastSeen: s.last_seen_at,
        sessions: 0,
        connectedSeconds: 0,
        activeSeconds: 0,
        devices: [],
        concurrent: 0,
        _devices: new Set(),
      };
      byIp.set(ip, cur);
    }
    cur.sessions += 1;
    cur.connectedSeconds += connected;
    cur.activeSeconds += s.active_seconds || 0;
    if (Date.parse(s.started_at) < Date.parse(cur.firstSeen)) cur.firstSeen = s.started_at;
    if (Date.parse(s.last_seen_at) > Date.parse(cur.lastSeen)) {
      cur.lastSeen = s.last_seen_at;
      cur.place = placeOf(s) ?? cur.place;
    }
    cur._devices.add(label(s.browser, s.os));
  }
  for (const e of realEvents) {
    for (const ip of new Set([e.ip_a, e.ip_b])) {
      if (ip && byIp.has(ip)) byIp.get(ip)!.concurrent += 1;
    }
  }
  const ips = Array.from(byIp.values())
    .map(({ _devices, ...rest }) => ({ ...rest, devices: Array.from(_devices) }))
    .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));

  // ── por aparelho ──
  const devStats = new Map<string, { ips: Set<string>; active: number }>();
  for (const s of sessions) {
    const st = devStats.get(s.device_id) ?? { ips: new Set<string>(), active: 0 };
    if (s.ip) st.ips.add(s.ip);
    st.active += s.active_seconds || 0;
    devStats.set(s.device_id, st);
  }
  const deviceSummaries: DeviceSummary[] = devices
    .map((d) => ({
      deviceId: d.device_id,
      label: label(d.browser, d.os),
      kind: d.device_kind,
      firstSeen: d.first_seen_at,
      lastSeen: d.last_seen_at,
      ips: devStats.get(d.device_id)?.ips.size ?? 0,
      activeSeconds: devStats.get(d.device_id)?.active ?? 0,
      lastIp: d.last_ip,
      lastPlace: d.last_place,
    }))
    .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));

  // ── por dia (últimos `dayCount`, incluindo hoje) ──
  const days: DaySummary[] = [];
  const index = new Map<string, DaySummary>();
  for (let i = dayCount - 1; i >= 0; i--) {
    const key = dayKeySP(now - i * 86_400_000);
    if (index.has(key)) continue; // virada de horário de verão: nunca duplica o dia
    const d = { day: key, activeSeconds: 0, connectedSeconds: 0, sessions: 0 };
    index.set(key, d);
    days.push(d);
  }
  for (const s of sessions) {
    const d = index.get(dayKeySP(s.started_at));
    if (!d) continue;
    d.sessions += 1;
    d.activeSeconds += s.active_seconds || 0;
    d.connectedSeconds += secs(s.started_at, s.last_seen_at);
  }

  const firstAt = sessions.reduce<string | null>(
    (min, s) => (!min || Date.parse(s.started_at) < Date.parse(min) ? s.started_at : min),
    null,
  );

  return {
    ips,
    devices: deviceSummaries,
    days,
    totals: {
      activeSeconds: sessions.reduce((n, s) => n + (s.active_seconds || 0), 0),
      connectedSeconds: sessions.reduce((n, s) => n + secs(s.started_at, s.last_seen_at), 0),
      ips: ips.filter((i) => i.ip !== 'desconhecido').length,
      devices: devices.length,
      concurrent: realEvents.length,
      sameMachine: events.length - realEvents.length,
      firstAt,
    },
  };
}

export type ToolEventRow = { tool: string; created_at: string };

export type UsageSummary = {
  total: number;
  tools: Array<{ tool: string; count: number; last: string }>;
  days: Array<{ day: string; count: number }>;
  recent: Array<{ tool: string; at: string }>;
  firstAt: string | null;
};

/** Uso de ferramentas (tool_events: um evento por ABERTURA de ferramenta). */
export function summarizeUsage(events: ToolEventRow[], dayCount = 30, now: number = Date.now()): UsageSummary {
  const byTool = new Map<string, { count: number; last: string }>();
  for (const e of events) {
    const cur = byTool.get(e.tool);
    if (!cur) byTool.set(e.tool, { count: 1, last: e.created_at });
    else {
      cur.count += 1;
      if (Date.parse(e.created_at) > Date.parse(cur.last)) cur.last = e.created_at;
    }
  }
  const days: Array<{ day: string; count: number }> = [];
  const index = new Map<string, { day: string; count: number }>();
  for (let i = dayCount - 1; i >= 0; i--) {
    const key = dayKeySP(now - i * 86_400_000);
    if (index.has(key)) continue;
    const d = { day: key, count: 0 };
    index.set(key, d);
    days.push(d);
  }
  for (const e of events) {
    const d = index.get(dayKeySP(e.created_at));
    if (d) d.count += 1;
  }
  const sorted = [...events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return {
    total: events.length,
    tools: Array.from(byTool.entries())
      .map(([tool, v]) => ({ tool, ...v }))
      .sort((a, b) => b.count - a.count || Date.parse(b.last) - Date.parse(a.last)),
    days,
    recent: sorted.slice(0, 25).map((e) => ({ tool: e.tool, at: e.created_at })),
    firstAt: sorted.length ? sorted[sorted.length - 1].created_at : null,
  };
}
