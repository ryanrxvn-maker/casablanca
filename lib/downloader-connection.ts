/** The bundled release is a safe fallback while the no-cache release endpoint loads. */
export const DOWNLOADER_EXTENSION_VERSION = '1.9.3';
export const DOWNLOADER_ENGINE_VERSION = '1.2.1';

export type DownloaderConnection = {
  checked: boolean;
  connected: boolean;
  version?: string;
  engine?: boolean;
  engineVersion?: string;
  engineCompatible?: boolean;
  lastSeenAt: number;
  lastEngineSeenAt?: number;
};

export type DownloaderStatus = 'checking' | 'missing' | 'outdated' | 'engine-checking' | 'engine-offline' | 'engine-outdated' | 'ready';

export const INITIAL_DOWNLOADER_CONNECTION: DownloaderConnection = {
  checked: false, connected: false, lastSeenAt: 0,
};

/** Chrome versions have two to four numeric components; unknown versions are legacy. */
export function versionAtLeast(version: string | undefined, minimum: string): boolean {
  if (!version || !/^\d+(?:\.\d+){1,3}$/.test(version)) return false;
  const actual = version.split('.').map(Number);
  const required = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(actual.length, required.length); i++) {
    if ((actual[i] || 0) !== (required[i] || 0)) return (actual[i] || 0) > (required[i] || 0);
  }
  return true;
}

export function connectionFromPong(data: Record<string, unknown>, now: number, previous?: DownloaderConnection): DownloaderConnection {
  // The bridge announces its presence before a slower Motor probe finishes.
  // Keep a recent Motor result during that probe, never indefinitely.
  const keepEngine = data.checking === true && previous?.version === data.version && now - (previous?.lastEngineSeenAt || 0) < 15000;
  return {
    checked: true,
    connected: true,
    version: typeof data.version === 'string' ? data.version : undefined,
    engine: typeof data.engine === 'boolean' ? data.engine : keepEngine ? previous?.engine : undefined,
    engineVersion: typeof data.engineVersion === 'string' ? data.engineVersion : keepEngine ? previous?.engineVersion : undefined,
    engineCompatible: typeof data.engineCompatible === 'boolean' ? data.engineCompatible : keepEngine ? previous?.engineCompatible : undefined,
    lastSeenAt: now,
    lastEngineSeenAt: typeof data.engine === 'boolean' ? now : previous?.lastEngineSeenAt,
  };
}

/** A tab returning from sleep must re-probe. No localStorage value proves connectivity. */
export function expireDownloaderConnection(previous: DownloaderConnection, now: number): DownloaderConnection {
  if (previous.connected && now - previous.lastSeenAt < 15000) return previous;
  return { ...previous, checked: true, connected: false, engine: undefined, engineCompatible: undefined };
}

export function getDownloaderStatus(connection: DownloaderConnection, latest = DOWNLOADER_EXTENSION_VERSION): DownloaderStatus {
  if (!connection.checked) return 'checking';
  if (!connection.connected) return 'missing';
  if (!versionAtLeast(connection.version, latest)) return 'outdated';
  if (connection.engine === undefined) return 'engine-checking';
  if (!connection.engine) return 'engine-offline';
  if (connection.engineCompatible !== true || !versionAtLeast(connection.engineVersion, DOWNLOADER_ENGINE_VERSION)) return 'engine-outdated';
  return 'ready';
}
