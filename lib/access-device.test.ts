import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deviceLabel,
  hash64,
  isValidDeviceId,
  isValidFingerprint,
  machineFingerprintFrom,
  parseUserAgent,
} from './access-device';

const UA = {
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  operaWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  chromebook:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

test('navegador, sistema e tipo de aparelho saem certos dos User-Agents reais', () => {
  assert.deepEqual(parseUserAgent(UA.chromeWin), { browser: 'Chrome', os: 'Windows', kind: 'desktop' });
  assert.deepEqual(parseUserAgent(UA.edgeWin), { browser: 'Edge', os: 'Windows', kind: 'desktop' });
  assert.deepEqual(parseUserAgent(UA.operaWin), { browser: 'Opera', os: 'Windows', kind: 'desktop' });
  assert.deepEqual(parseUserAgent(UA.firefoxMac), { browser: 'Firefox', os: 'macOS', kind: 'desktop' });
  assert.deepEqual(parseUserAgent(UA.safariMac), { browser: 'Safari', os: 'macOS', kind: 'desktop' });
  assert.deepEqual(parseUserAgent(UA.safariIphone), { browser: 'Safari', os: 'iOS', kind: 'mobile' });
  assert.deepEqual(parseUserAgent(UA.chromeIphone), { browser: 'Chrome', os: 'iOS', kind: 'mobile' });
  assert.deepEqual(parseUserAgent(UA.chromeAndroid), { browser: 'Chrome', os: 'Android', kind: 'mobile' });
  assert.deepEqual(parseUserAgent(UA.samsungAndroid), { browser: 'Samsung Internet', os: 'Android', kind: 'mobile' });
  assert.deepEqual(parseUserAgent(UA.androidTablet), { browser: 'Chrome', os: 'Android', kind: 'tablet' });
  assert.deepEqual(parseUserAgent(UA.ipad), { browser: 'Safari', os: 'iPadOS', kind: 'tablet' });
  assert.deepEqual(parseUserAgent(UA.linuxFirefox), { browser: 'Firefox', os: 'Linux', kind: 'desktop' });
  assert.deepEqual(parseUserAgent(UA.chromebook), { browser: 'Chrome', os: 'ChromeOS', kind: 'desktop' });
});

test('iPad em modo desktop (UA de Mac com toque) vira iPadOS/tablet', () => {
  assert.deepEqual(parseUserAgent(UA.safariMac, 5), { browser: 'Safari', os: 'iPadOS', kind: 'tablet' });
});

test('sem UA não inventa nada', () => {
  assert.deepEqual(parseUserAgent(null), { browser: null, os: null, kind: null });
  assert.deepEqual(parseUserAgent(''), { browser: null, os: null, kind: null });
});

test('rótulo curto do aparelho', () => {
  assert.equal(deviceLabel('Chrome', 'Windows'), 'Chrome · Windows');
  assert.equal(deviceLabel(null, 'iOS'), 'iOS');
  assert.equal(deviceLabel(null, null), 'Aparelho desconhecido');
});

test('ids aceitos pelo servidor', () => {
  assert.ok(isValidDeviceId('3f2b9c1e-8d7a-4c6b-9e5f-1a2b3c4d5e6f'));
  assert.ok(isValidDeviceId('fp-0123456789abcdef'));
  assert.ok(!isValidDeviceId('curto'));
  assert.ok(!isValidDeviceId('x'.repeat(81)));
  assert.ok(!isValidDeviceId("id'; drop table--"));
  assert.ok(!isValidDeviceId(42));
  assert.ok(isValidFingerprint('m0123456789abcdef'));
  assert.ok(!isValidFingerprint('m 1'));
});

test('impressão de máquina: igual entre navegadores do mesmo PC, girar a tela não muda, outro PC muda', () => {
  const pc = { os: 'Windows', screenW: 1920, screenH: 1080, availW: 1920, availH: 1032, colorDepth: 24, cores: 12, timeZone: 'America/Sao_Paulo', touchPoints: 0 };
  assert.equal(machineFingerprintFrom(pc), machineFingerprintFrom({ ...pc }));
  const phone = { os: 'iOS', screenW: 390, screenH: 844, availW: 390, availH: 844, colorDepth: 24, cores: 6, timeZone: 'America/Sao_Paulo', touchPoints: 5 };
  assert.equal(
    machineFingerprintFrom(phone),
    machineFingerprintFrom({ ...phone, screenW: 844, screenH: 390, availW: 844, availH: 390 }),
  );
  assert.notEqual(machineFingerprintFrom(pc), machineFingerprintFrom({ ...pc, cores: 8 }));
  assert.notEqual(machineFingerprintFrom(pc), machineFingerprintFrom({ ...pc, availH: 1040 }));
  assert.match(machineFingerprintFrom(pc), /^m[0-9a-f]{16}$/);
});

test('hash64 é estável e espalha', () => {
  assert.equal(hash64('abc'), hash64('abc'));
  assert.notEqual(hash64('abc'), hash64('abd'));
  assert.equal(hash64('').length, 16);
});
