#!/usr/bin/env node
/**
 * Roda a suite de testes do projeto.
 *
 * Antes isto era UMA linha gigante no "scripts.test" do package.json. Em
 * 31.08.2026 ela passou dos ~8000 caracteres que o Windows aceita e o cmd
 * recusou de vez ("Linha de comando muito longa") — a suite INTEIRA parou de
 * rodar de uma vez, sem nenhum teste ter quebrado. Cada etapa agora vive na
 * lista abaixo, e acrescentar teste novo e' somar um item em vez de esticar
 * a linha.
 *
 * Uso:
 *   node scripts/test.mjs             roda tudo
 *   node scripts/test.mjs typography  roda so as etapas cujo nome casa
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Etapa: ou compila com tsc e roda o JS (`tsc` + `run`), ou roda o TS direto
 *  pelo tsx (`tsx`). O tsx existe pros testes que dependem de pacote ESM de
 *  verdade — mp4box, por exemplo — que nao sobrevive ao --module commonjs.
 *  @type {{ tsc?: string, run?: string[], tsx?: string[] }[]} */
const ETAPAS = [
  { tsc: "lib/heygen-extension-bridge.ts lib/heygen-extension-version.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom", run: [".test-tmp/heygen-extension-version.test.js"] },
  { run: ["scripts/test-pilot-economia-runtime.mjs"] },
  { run: ["scripts/test-pilot-biblioteca-avatares.mjs"] },
  { run: ["scripts/test-pilot-post-scope.mjs"] },
  { run: ["scripts/test-va-stockframe-coverage.mjs"] },
  { tsx: ["lib/stockframe-live-contract.test.ts"] },
  { run: ["scripts/test-flow-bridge.mjs", "scripts/test-pilot-flow-integration.mjs", "scripts/test-flow-extension.mjs"] },
  { tsc: "lib/flow-prompt.ts lib/flow-prompt.test.ts --outDir .test-tmp --module commonjs --target es2022 --moduleResolution node --skipLibCheck --esModuleInterop --lib esnext,dom", run: [".test-tmp/flow-prompt.test.js"] },
  { tsc: "lib/stockframe.ts lib/stockframe-smart.ts lib/stockframe-translate.ts lib/stockframe.test.ts lib/stockframe-translate.test.ts --outDir .test-tmp --module commonjs --target es2022 --moduleResolution node --skipLibCheck --lib esnext,dom,dom.iterable", run: [".test-tmp/stockframe.test.js", ".test-tmp/stockframe-translate.test.js", "scripts/test-stockframe-integration.mjs", "scripts/test-stockframe-bridge.mjs"] },
  { tsc: "lib/durable-records-core.ts lib/durable-records.ts lib/durable-records.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom", run: [".test-tmp/durable-records.test.js"] },
  { tsc: "lib/speech-detect.ts lib/speech-detect.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom", run: [".test-tmp/speech-detect.test.js"] },
  { tsc: "lib/decupagem-matcher.ts lib/decupagem-matcher.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck", run: [".test-tmp/decupagem-matcher.test.js"] },
  { tsc: "lib/copy-parser.ts lib/heygen-extension-bridge.ts lib/doc-to-disparos.ts lib/doc-to-disparos.test.ts lib/doc-to-disparos.real.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom", run: [".test-tmp/doc-to-disparos.test.js", ".test-tmp/doc-to-disparos.real.test.js"] },
  { tsc: "lib/audio-engine.ts lib/audio-engine.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom", run: [".test-tmp/audio-engine.test.js"] },
  { tsc: "lib/pilot-audio.ts lib/pilot-audio.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/pilot-audio.test.js"] },
  { tsc: "lib/pilot-indicacoes.ts lib/pilot-indicacoes.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/pilot-indicacoes.test.js"] },
  { tsc: "lib/versoes-ad.ts lib/versoes-ad.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/versoes-ad.test.js"] },
  { tsc: "lib/pilot-pos-producao.ts lib/pilot-pos-producao.test.ts --outDir .test-tmp --module commonjs --target es2022 --moduleResolution node --skipLibCheck --lib esnext,dom,dom.iterable", run: [".test-tmp/pilot-pos-producao.test.js"] },
  { tsx: ["lib/video-duracao.test.ts"] },
  { tsx: ["lib/pilot-plano-copy.test.ts"] },
  { tsx: ["lib/zip-entries.test.ts"] },
  { tsc: "lib/idioma.ts lib/idioma.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck", run: [".test-tmp/idioma.test.js"] },
  { tsc: "lib/pilot-inserts.ts lib/pilot-inserts.test.ts --outDir .test-tmp --module commonjs --target es2022 --moduleResolution node --skipLibCheck --lib esnext,dom,dom.iterable", run: [".test-tmp/pilot-inserts.test.js"] },
  { tsc: "lib/ffmpeg-serial.ts lib/ffmpeg-serial.test.ts --outDir .test-tmp --module commonjs --target es2022 --moduleResolution node --skipLibCheck --lib esnext,dom", run: [".test-tmp/ffmpeg-serial.test.js"] },
  // ffmpeg-worker importa os módulos ESM estaticamente para o clique da
  // Decupagem nunca depender de um chunk tardio. Rode esse teste como ESM.
  { tsx: ["lib/ffmpeg-worker.test.ts"] },
  // fontes de task do Pilot (05.09): DOCS / CREATOR — doc real vira N tasks, ids seguros, .docx, persistencia
  { tsc: "lib/pilot-fontes.ts lib/pilot-fontes.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom,dom.iterable", run: [".test-tmp/pilot-fontes.test.js"] },
  { tsc: "lib/typography/player-control.ts lib/typography/player-control.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/player-control.test.js"] },
  { tsc: "lib/pilot-copy-creator.ts lib/pilot-copy-creator.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021", run: [".test-tmp/pilot-copy-creator.test.js"] },
  { tsc: "lib/pilot-economia.ts lib/pilot-economia.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021", run: [".test-tmp/pilot-economia.test.js"] },
  { tsc: "lib/pilot-runner-pulse.ts lib/pilot-runner-pulse.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom", run: [".test-tmp/pilot-runner-pulse.test.js"] },
  { tsc: "lib/pilot-selos.ts lib/pilot-selos.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021", run: [".test-tmp/pilot-selos.test.js"] },
  { tsc: "lib/pilot-fila.ts lib/pilot-fila.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021", run: [".test-tmp/pilot-fila.test.js"] },
  { tsc: "lib/pilot-progresso.ts lib/pilot-progresso.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021", run: [".test-tmp/pilot-progresso.test.js"] },
  // trava de scroll com CONTADOR (04.09): 10 modais dependem dela; duas janelas abertas nao podem travar a pagina pra sempre
  { tsc: "lib/trava-scroll.ts lib/trava-scroll.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom", run: [".test-tmp/trava-scroll.test.js"] },
  { tsc: "lib/downloader-extension-guard.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/downloader-extension-guard.test.js"] },
  { tsc: "lib/heygen-batch-store.ts lib/heygen-batch-store.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom", run: [".test-tmp/heygen-batch-store.test.js"] },
  { tsc: "lib/pilot-gen-isolation.ts lib/pilot-gen-isolation.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom", run: [".test-tmp/pilot-gen-isolation.test.js"] },
  // historico POR FERRAMENTA (17.09): rota->ferramenta, apelidos, estado honesto do botao Baixar
  { tsc: "lib/history-tools.ts lib/history-tools.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/history-tools.test.js"] },
  // acoes do historico (17.09): download do MONTADO, taskId do disparo, intencao entre paginas
  { tsc: "lib/history-tools.ts lib/history-acoes.ts lib/history-acoes.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/history-acoes.test.js"] },
  // status AO VIVO no historico (18.09): mesma conta da barra do card do Pilot
  { tsc: "lib/history-fila.ts lib/history-fila.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021", run: [".test-tmp/history-fila.test.js"] },
  { tsc: "lib/zip-store-prune.ts lib/zip-store-prune.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom", run: [".test-tmp/zip-store-prune.test.js"] },
  { tsc: "lib/heygen-queue-store.ts lib/heygen-queue-store.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom", run: [".test-tmp/heygen-queue-store.test.js"] },
  { tsc: "lib/drmillion-parser.ts lib/drmillion-parser.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/drmillion-parser.test.js"] },
  { tsc: "lib/pilot-dedup.ts lib/pilot-dedup.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/pilot-dedup.test.js"] },
  { tsc: "lib/heygen-health.ts lib/heygen-health.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom", run: [".test-tmp/heygen-health.test.js"] },
  { tsc: "lib/heygen-motion-motor.ts lib/heygen-motion-motor.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/heygen-motion-motor.test.js"] },
  { tsc: "lib/montagem-sig.ts lib/montagem-sig.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/montagem-sig.test.js"] },
  // chip de CANAL (19.09): o board nao pode apagar o que ja se sabia do card
  { tsc: "lib/pilot-canais.ts lib/pilot-canais.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021", run: [".test-tmp/pilot-canais.test.js"] },
  { tsc: "lib/versao-canal.ts lib/versao-canal.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/versao-canal.test.js"] },
  { tsc: "lib/auto-cortes/transcript.ts lib/auto-cortes/transcript.test.ts lib/auto-cortes/types.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom,dom.iterable", run: [".test-tmp/auto-cortes/transcript.test.js"] },
  { tsc: "lib/auto-cortes/types.ts lib/auto-cortes/prompts.ts lib/auto-cortes/analyze.ts lib/auto-cortes/analyze.test.ts --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom,dom.iterable", run: [".test-tmp/auto-cortes/analyze.test.js"] },
  { tsc: "lib/auto-cortes/reframe-plan.ts lib/auto-cortes/reframe.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/auto-cortes/reframe.test.js"] },
  { tsc: "lib/auto-cortes/ext-bridge.ts lib/auto-cortes/ext-bridge.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2021,dom", run: [".test-tmp/auto-cortes/ext-bridge.test.js"] },
  { tsc: "lib/auto-cortes/pipeline-core.ts lib/auto-cortes/pipeline.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/auto-cortes/pipeline.test.js"] },
  { tsc: "lib/auto-cortes/curador/curate.ts lib/auto-cortes/curador/curador.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/auto-cortes/curador/curador.test.js"] },
  { tsc: "lib/typography/blocks-edit.ts lib/typography/blocks-edit.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/blocks-edit.test.js"] },
  { tsc: "lib/typography/caption-script.ts lib/typography/caption-script.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/caption-script.test.js"] },
  { tsc: "lib/typography/fx.ts lib/typography/fx.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/fx.test.js"] },
  { tsc: "lib/typography/canvas-loop.ts lib/typography/canvas-loop.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/canvas-loop.test.js"] },
  { tsc: "lib/typography/engine.ts lib/typography/anchor.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/anchor.test.js"] },
  { tsc: "lib/typography/engine.ts lib/typography/presets.ts lib/typography/fonts.ts lib/typography/emphasis.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/emphasis.test.js"] },
  { tsc: "lib/typography/engine.ts lib/typography/presets.ts lib/typography/fonts.ts lib/typography/rot-box.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/rot-box.test.js"] },
  { tsc: "lib/typography/asr-tempo.ts lib/typography/asr-gaps.ts lib/typography/asr-tempo.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/asr-tempo.test.js"] },
  { tsc: "lib/typography/asr-gaps.ts lib/typography/asr-gaps.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/asr-gaps.test.js"] },
  { tsc: "lib/typography/headline.ts lib/typography/headline.test.ts --outDir .test-tmp --rootDir lib --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2021,dom,dom.iterable", run: [".test-tmp/typography/headline.test.js"] },
];

const filtro = process.argv[2];
const alvo = filtro
  ? ETAPAS.filter((e) => [e.tsc || '', ...(e.run || []), ...(e.tsx || [])].join(' ').includes(filtro))
  : ETAPAS;

if (alvo.length === 0) {
  console.error('Nenhuma etapa casa com "' + filtro + '".');
  process.exit(1);
}

/**
 * Chama o tsc pelo ARQUIVO js do pacote, com o proprio node.
 *
 * Nada de `npx.cmd`: desde o Node 20 o spawn de um .cmd sem shell falha com
 * EINVAL (endurecimento contra injecao de argumento), e com shell:true os
 * argumentos precisariam de escape manual no Windows. Chamar o bin do
 * typescript direto e' mais rapido e nao depende de shell nenhum.
 */
// Resolve pelo Node em vez de assumir node_modules dentro do checkout. Git
// worktrees compartilham as dependencias do repositorio principal e precisam
// subir diretorios exatamente como qualquer import normal.
const localRequire = createRequire(import.meta.url);
const TSC = join(dirname(localRequire.resolve('typescript/package.json')), 'bin', 'tsc');
const { buildSync } = localRequire('esbuild');
let falhou = 0;

for (const etapa of alvo) {
  if (etapa.tsx) {
    for (const arquivo of etapa.tsx) {
      const saida = join('.test-tmp', 'esm', arquivo.replace(/[\\/]/g, '_').replace(/\.tsx?$/, '.mjs'));
      try {
        buildSync({ entryPoints: [arquivo], outfile: saida, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
      } catch (error) {
        console.error('\n[test] esbuild falhou em: ' + arquivo, error);
        falhou++;
        continue;
      }
      const r = spawnSync(process.execPath, [saida], { stdio: 'inherit' });
      if (r.status !== 0) {
        console.error('\n[test] FALHOU: ' + arquivo);
        falhou++;
      }
    }
    continue;
  }
  const args = etapa.tsc?.split(/\s+/).filter(Boolean);
  const tsc = args ? spawnSync(process.execPath, [TSC, ...args], { stdio: 'inherit' }) : null;
  if (tsc && tsc.status !== 0) {
    console.error('\n[test] tsc falhou em: ' + etapa.run.join(', '));
    falhou++;
    continue;
  }
  for (const arquivo of etapa.run) {
    const r = spawnSync(process.execPath, [arquivo], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('\n[test] FALHOU: ' + arquivo);
      falhou++;
    }
  }
}

if (falhou > 0) {
  console.error('\n[test] ' + falhou + ' etapa(s) falharam.');
  process.exit(1);
}
console.log('\n[test] ' + alvo.length + ' etapas OK.');
