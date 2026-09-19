import crypto from 'crypto';
import path from 'path';
import { createWriteStream } from 'fs';
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { processDownload, type DownloadInput, type DownloadResult } from '../lib/downloader-core';

export type Job = {
  id: string;
  requestId: string;
  input: DownloadInput;
  state: 'queued' | 'processing' | 'ready' | 'error';
  createdAt: number;
  updatedAt: number;
  filename?: string;
  size?: number;
  mime?: string;
  error?: string;
};
const TTL = 6 * 60 * 60 * 1000;

/** Reject error pages before Chrome's download manager ever sees a URL. */
export async function validateMedia(file: string, mime: string): Promise<number> {
  if (!/^(video|audio|image)\//.test(mime)) throw new Error('A fonte não entregou um arquivo de mídia válido.');
  const size = (await stat(file)).size;
  if (size < 32) throw new Error('A fonte entregou um arquivo vazio ou incompleto.');
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(512);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const head = bytes.subarray(0, bytesRead).toString('utf8').trimStart();
    if (/^(?:<!doctype|<html|<\?xml|\{\s*"|\[\s*\{)/i.test(head)) {
      throw new Error('A fonte retornou uma mensagem de erro no lugar do vídeo. Tente novamente.');
    }
  } finally { await handle.close(); }
  return size;
}

export class DownloadJobs {
  private jobs = new Map<string, Job>();
  private active = 0;
  private pumping = false;
  private initializing = new Set<string>();
  private saves = new Map<string, Promise<void>>();
  constructor(private dir: string, private process: (input: DownloadInput) => Promise<DownloadResult> = processDownload) {}

  async init() {
    await mkdir(this.dir, { recursive: true });
    for (const name of await readdir(this.dir)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const job = JSON.parse(await readFile(path.join(this.dir, name), 'utf8')) as Job;
        if (name !== `${job.id}.json`) continue;
        this.jobs.set(job.id, job);
        if (job.state === 'processing') job.state = 'queued';
        if (job.state === 'ready') {
          try { await validateMedia(this.filePath(job.id), job.mime || ''); }
          catch { job.state = 'error'; job.error = 'O arquivo não está mais disponível. Inicie o download novamente.'; }
        }
      } catch { /* An interrupted metadata write cannot stop the engine. */ }
    }
    await this.prune();
    void this.pump();
  }

  private async save(job: Job) {
    const destination = path.join(this.dir, `${job.id}.json`);
    const snapshot = JSON.stringify(job);
    const pending = (this.saves.get(job.id) || Promise.resolve()).catch(() => {}).then(async () => {
      await writeFile(destination + '.tmp', snapshot);
      await rename(destination + '.tmp', destination);
    });
    this.saves.set(job.id, pending);
    try { await pending; }
    finally { if (this.saves.get(job.id) === pending) this.saves.delete(job.id); }
  }
  filePath(id: string) { return path.join(this.dir, `${id}.media`); }
  get(id: string) { return this.jobs.get(id); }
  public(job: Job) {
    const { input: _input, requestId: _requestId, ...publicJob } = job;
    return publicJob;
  }
  async create(input: DownloadInput, requestId: string) {
    const existing = [...this.jobs.values()].find(j => j.requestId === requestId);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Error('Esse pedido já foi usado para outro download.');
      await this.saves.get(existing.id);
      return existing;
    }
    if ([...this.jobs.values()].filter(j => j.state === 'queued' || j.state === 'processing').length >= 100) throw new Error('A fila está cheia. Aguarde os downloads atuais terminarem.');
    const job: Job = { id: crypto.randomUUID(), requestId, input, state: 'queued', createdAt: Date.now(), updatedAt: Date.now() };
    // Insert before the first await: duplicate requests share a single job.
    this.jobs.set(job.id, job);
    this.initializing.add(job.id);
    try { await this.save(job); }
    catch (e) { this.jobs.delete(job.id); throw e; }
    finally { this.initializing.delete(job.id); }
    void this.pump();
    return job;
  }
  async prune() {
    for (const [id, job] of this.jobs) {
      if (job.state === 'queued' || job.state === 'processing' || Date.now() - job.updatedAt < TTL) continue;
      this.jobs.delete(id);
      await rm(this.filePath(id), { force: true });
      await rm(path.join(this.dir, `${id}.json`), { force: true });
    }
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.active < 2) {
        const job = [...this.jobs.values()].find(j => j.state === 'queued' && !this.initializing.has(j.id));
        if (!job) break;
        job.state = 'processing';
        this.active++;
        void this.run(job).finally(() => { this.active--; void this.pump(); });
      }
    } finally { this.pumping = false; }
  }
  private async run(job: Job) {
    let result: DownloadResult | undefined;
    const file = this.filePath(job.id);
    try {
      await this.save(job);
      result = await this.process(job.input);
      if (!result.ok) throw new Error(result.error);
      if (result.kind === 'file') {
        await copyFile(result.filePath, file);
      } else {
        const response = await fetch(result.url, { headers: result.headers, signal: AbortSignal.timeout(25 * 60_000) });
        if (!response.ok || !response.body) throw new Error('A fonte do vídeo não respondeu. Tente novamente em instantes.');
        if (/json|html|xml/.test(response.headers.get('content-type') || '')) throw new Error('A fonte retornou um erro no lugar do vídeo.');
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(file));
        const length = Number(response.headers.get('content-length'));
        if (length && (await stat(file)).size !== length) throw new Error('A conexão caiu antes de terminar o arquivo. Tente novamente.');
      }
      job.size = await validateMedia(file, result.contentType);
      job.filename = result.name.replace(/[\r\n"\\/]/g, '_');
      job.mime = result.contentType;
      job.state = 'ready';
    } catch (e) {
      job.state = 'error';
      job.error = e instanceof Error ? e.message : 'Não foi possível preparar o download. Tente novamente.';
      await rm(file, { force: true }).catch(() => {});
    } finally {
      if (result?.ok) await result.dispose().catch(() => {});
      job.updatedAt = Date.now();
      await this.save(job).catch(e => console.error('[jobs] persist failed:', e.message));
    }
  }
}
