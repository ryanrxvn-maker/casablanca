import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dayKeySP,
  placeOf,
  summarizeAccess,
  summarizeUsage,
  type AccessDeviceRow,
  type AccessEventRow,
  type AccessSessionRow,
} from './admin-access-summary';

const NOW = Date.parse('2026-10-07T18:00:00Z'); // 15:00 em São Paulo

function sess(p: Partial<AccessSessionRow> & { id: number; started_at: string; last_seen_at: string }): AccessSessionRow {
  return {
    device_id: 'dev-pc',
    ip: '200.1.1.1',
    city: 'São Paulo',
    region: 'SP',
    country: 'BR',
    browser: 'Chrome',
    os: 'Windows',
    device_kind: 'desktop',
    pings: 10,
    active_seconds: 0,
    ...p,
  };
}

const devices: AccessDeviceRow[] = [
  { device_id: 'dev-pc', browser: 'Chrome', os: 'Windows', device_kind: 'desktop', first_seen_at: '2026-10-05T12:00:00Z', last_seen_at: '2026-10-07T17:00:00Z', last_ip: '200.1.1.1', last_place: 'São Paulo, SP, BR' },
  { device_id: 'dev-phone', browser: 'Safari', os: 'iOS', device_kind: 'mobile', first_seen_at: '2026-10-06T12:00:00Z', last_seen_at: '2026-10-07T16:00:00Z', last_ip: '177.9.9.9', last_place: 'Rio de Janeiro, RJ, BR' },
];

test('dia no fuso de São Paulo (23h de SP já é o dia seguinte em UTC)', () => {
  assert.equal(dayKeySP('2026-10-08T02:30:00Z'), '2026-10-07');
  assert.equal(dayKeySP('2026-10-08T03:30:00Z'), '2026-10-08');
});

test('local legível só com o que existe', () => {
  assert.equal(placeOf({ city: 'Campinas', region: 'SP', country: 'BR' }), 'Campinas, SP, BR');
  assert.equal(placeOf({ city: null, region: null, country: 'BR' }), 'BR');
  assert.equal(placeOf({}), null);
});

test('histórico por IP, por aparelho e por dia', () => {
  const sessions = [
    sess({ id: 1, started_at: '2026-10-07T12:00:00Z', last_seen_at: '2026-10-07T13:00:00Z', active_seconds: 1800 }),
    sess({ id: 2, started_at: '2026-10-06T12:00:00Z', last_seen_at: '2026-10-06T12:30:00Z', active_seconds: 600 }),
    sess({ id: 3, device_id: 'dev-phone', ip: '177.9.9.9', city: 'Rio de Janeiro', region: 'RJ', browser: 'Safari', os: 'iOS', device_kind: 'mobile', started_at: '2026-10-07T12:10:00Z', last_seen_at: '2026-10-07T12:40:00Z', active_seconds: 900 }),
  ];
  const events: AccessEventRow[] = [
    { id: 1, device_a: 'dev-pc', device_b: 'dev-phone', ip_a: '200.1.1.1', ip_b: '177.9.9.9', place_a: 'São Paulo, SP, BR', place_b: 'Rio de Janeiro, RJ, BR', label_a: 'Chrome · Windows', label_b: 'Safari · iOS', same_network: false, same_machine: false, started_at: '2026-10-07T12:10:00Z', ended_at: '2026-10-07T12:40:00Z' },
    { id: 2, device_a: 'dev-pc', device_b: 'dev-pc2', ip_a: '200.1.1.1', ip_b: '200.1.1.1', place_a: null, place_b: null, label_a: 'Chrome · Windows', label_b: 'Edge · Windows', same_network: true, same_machine: true, started_at: '2026-10-06T12:00:00Z', ended_at: '2026-10-06T12:05:00Z' },
  ];
  const r = summarizeAccess(sessions, devices, events, 30, NOW);

  assert.equal(r.ips.length, 2);
  const sp = r.ips.find((i) => i.ip === '200.1.1.1')!;
  assert.equal(sp.sessions, 2);
  assert.equal(sp.activeSeconds, 2400);
  assert.equal(sp.connectedSeconds, 3600 + 1800);
  assert.equal(sp.place, 'São Paulo, SP, BR');
  assert.equal(sp.firstSeen, '2026-10-06T12:00:00Z');
  assert.equal(sp.concurrent, 1, '"mesmo computador" não soma como simultâneo');
  assert.deepEqual(sp.devices, ['Chrome · Windows']);
  assert.equal(r.ips[0].ip, '200.1.1.1', 'IP mais recente primeiro');

  assert.equal(r.devices.length, 2);
  assert.equal(r.devices[0].label, 'Chrome · Windows');
  assert.equal(r.devices[0].activeSeconds, 2400);
  assert.equal(r.devices[1].ips, 1);

  assert.equal(r.days.length, 30);
  assert.equal(r.days[r.days.length - 1].day, '2026-10-07');
  assert.equal(r.days[r.days.length - 1].activeSeconds, 1800 + 900);
  assert.equal(r.days[r.days.length - 2].sessions, 1);

  assert.equal(r.totals.concurrent, 1);
  assert.equal(r.totals.sameMachine, 1);
  assert.equal(r.totals.ips, 2);
  assert.equal(r.totals.devices, 2);
  assert.equal(r.totals.firstAt, '2026-10-06T12:00:00Z');
});

test('conta sem histórico não quebra', () => {
  const r = summarizeAccess([], [], [], 30, NOW);
  assert.equal(r.ips.length, 0);
  assert.equal(r.days.length, 30);
  assert.equal(r.totals.firstAt, null);
});

test('uso de ferramentas: ranking, série diária e recentes', () => {
  const ev = [
    { tool: 'clickup-pilot', created_at: '2026-10-07T12:00:00Z' },
    { tool: 'downloader', created_at: '2026-10-07T13:00:00Z' },
    { tool: 'clickup-pilot', created_at: '2026-10-06T12:00:00Z' },
    { tool: 'clickup-pilot', created_at: '2026-08-01T12:00:00Z' },
  ];
  const u = summarizeUsage(ev, 30, NOW);
  assert.equal(u.total, 4);
  assert.deepEqual(u.tools[0], { tool: 'clickup-pilot', count: 3, last: '2026-10-07T12:00:00Z' });
  assert.equal(u.days[u.days.length - 1].count, 2);
  assert.equal(u.days.reduce((n, d) => n + d.count, 0), 3, 'agosto fica fora da janela de 30 dias');
  assert.equal(u.recent[0].tool, 'downloader');
  assert.equal(u.firstAt, '2026-08-01T12:00:00Z');
});
