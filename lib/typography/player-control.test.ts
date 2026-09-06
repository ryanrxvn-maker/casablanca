import {
  alternarPlay,
  criarMedidorDeQuadros,
  criarVigiaDoPlayer,
  pausar,
  recarregarVideo,
  tocar,
  type VideoLike,
} from './player-control';

let oks = 0;
let fails = 0;
function ok(cond: unknown, msg: string) {
  if (cond) {
    oks++;
    console.log(`  ok   ${msg}`);
  } else {
    fails++;
    console.log(`  FAIL ${msg}`);
  }
}

type Modo = 'ok' | 'rejeita-abort' | 'rejeita-suporte' | 'pendente';

/** Dublê de <video>: o suficiente pra exercitar play/pause/load/eventos. */
function fakeVideo(init?: Partial<VideoLike> & { modo?: Modo }) {
  const ouvintes = new Map<string, Set<() => void>>();
  let resolverPendente: (() => void) | null = null;
  const log: string[] = [];
  const v = {
    paused: true,
    ended: false,
    readyState: 4,
    networkState: 1,
    currentTime: 0,
    error: null as VideoLike['error'],
    modo: (init?.modo ?? 'ok') as Modo,
    log,
    play() {
      log.push('play');
      if (v.modo === 'rejeita-abort') return Promise.reject(Object.assign(new Error('interrupted by pause'), { name: 'AbortError' }));
      if (v.modo === 'rejeita-suporte') return Promise.reject(Object.assign(new Error('no supported source'), { name: 'NotSupportedError' }));
      v.paused = false;
      if (v.modo === 'pendente') return new Promise<void>((res) => { resolverPendente = res; });
      return Promise.resolve();
    },
    pause() {
      log.push('pause');
      v.paused = true;
    },
    load() {
      log.push('load');
      v.readyState = 0;
      v.error = null;
      // carrega "no próximo tick"
      setTimeout(() => {
        v.readyState = 4;
        v.modo = 'ok';
        for (const fn of ouvintes.get('loadedmetadata') ?? []) fn();
      }, 0);
    },
    addEventListener(t: string, fn: () => void) {
      if (!ouvintes.has(t)) ouvintes.set(t, new Set());
      ouvintes.get(t)!.add(fn);
    },
    removeEventListener(t: string, fn: () => void) {
      ouvintes.get(t)?.delete(fn);
    },
    resolverPlayPendente() {
      resolverPendente?.();
      resolverPendente = null;
    },
    ...init,
  };
  return v;
}

async function main() {
  console.log('player-control:');
  const avisos: string[] = [];
  const o = { avisar: (m: string) => avisos.push(m) };

  // 1. play normal
  {
    const v = fakeVideo();
    ok((await tocar(v, o)) === true && !v.paused, 'tocar: vídeo pronto toca e devolve true');
    ok(avisos.length === 0, 'tocar: sem aviso quando dá certo');
  }

  // 2. readyState 0 → recarrega e toca
  {
    avisos.length = 0;
    const v = fakeVideo({ readyState: 0 });
    const r = await tocar(v, o);
    ok(r === true && v.log.includes('load') && !v.paused, 'tocar: readyState 0 recarrega a mídia e toca');
    ok(avisos.some((m) => m.includes('recarregando')), 'tocar: avisa que recarregou (nunca calado)');
  }

  // 3. elemento em erro → recarrega mantendo o instante
  {
    avisos.length = 0;
    const v = fakeVideo({ error: { code: 3, message: 'PIPELINE_ERROR_DECODE' }, currentTime: 12.5 });
    const r = await tocar(v, o);
    ok(r === true && v.currentTime === 12.5, 'tocar: MEDIA_ERR recarrega e volta pro mesmo instante');
  }

  // 4. NotSupportedError na 1ª → recarrega → toca na 2ª
  {
    avisos.length = 0;
    const v = fakeVideo({ modo: 'rejeita-suporte' });
    const r = await tocar(v, o);
    ok(r === true && v.log.filter((x) => x === 'play').length === 2, 'tocar: NotSupportedError tenta de novo depois de recarregar');
    ok(avisos.some((m) => m.includes('NotSupportedError')), 'tocar: registra o nome do erro');
  }

  // 5. AbortError = intenção do usuário: não insiste
  {
    avisos.length = 0;
    const v = fakeVideo({ modo: 'rejeita-abort' });
    const r = await tocar(v, o);
    ok(r === false && v.log.filter((x) => x === 'play').length === 1, 'tocar: AbortError não insiste (foi um pause no meio)');
  }

  // 6. pausar espera o play pendente assentar
  {
    const v = fakeVideo({ modo: 'pendente' });
    const p = tocar(v, o);
    let pausou = false;
    const q = pausar(v).then(() => {
      pausou = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    ok(!pausou && v.log.length === 1, 'pausar: com play() pendente, não chama pause() ainda');
    v.resolverPlayPendente();
    await p;
    await q;
    ok(pausou && v.log[1] === 'pause' && v.paused, 'pausar: pausa assim que o play() assenta');
  }

  // 7. alternar
  {
    const v = fakeVideo();
    await alternarPlay(v, o);
    ok(!v.paused, 'alternarPlay: pausado → toca');
    await alternarPlay(v, o);
    ok(v.paused, 'alternarPlay: tocando → pausa');
  }

  // 8. recarregarVideo devolve false se load lançar
  {
    const v = fakeVideo();
    v.load = () => {
      throw new Error('sem src');
    };
    ok((await recarregarVideo(v, o)) === false, 'recarregarVideo: load() que lança devolve false sem explodir');
  }

  // 9. vigia: avisa quando toca mas não anda; não avisa pausado; empurra
  {
    avisos.length = 0;
    const v = fakeVideo({ paused: false, currentTime: 3 });
    const vig = criarVigiaDoPlayer(v, { avisar: o.avisar, paradoMs: 2000 });
    vig.tick(0);
    vig.tick(1000);
    ok(avisos.length === 0, 'vigia: 1s parado ainda não avisa');
    vig.tick(2100);
    ok(avisos.length === 1 && avisos[0].includes('parado em 3.00s'), 'vigia: 2s parado avisa com o instante');
    ok(Math.abs(v.currentTime - 3.001) < 1e-9, 'vigia: dá o empurrão de 1ms');
    vig.tick(3000);
    ok(avisos.length === 1, 'vigia: avisa UMA vez por episódio');
    v.currentTime = 3.5;
    vig.tick(3200);
    v.currentTime = 3.5;
    vig.tick(5500);
    ok(avisos.length === 2 && vig.episodios() === 2, 'vigia: andou e travou de novo = novo episódio');
    v.paused = true;
    avisos.length = 0;
    vig.tick(9000);
    vig.tick(12000);
    ok(avisos.length === 0, 'vigia: pausado nunca avisa');
  }

  // 10. medidor de quadros
  {
    avisos.length = 0;
    const med = criarMedidorDeQuadros({ avisar: o.avisar, lentoMs: 50, janelaMs: 1000, rotulo: 'teste' });
    med.registrar(5, 0);
    med.registrar(8, 200);
    med.registrar(120, 400);
    med.registrar(6, 1200);
    ok(avisos.length === 1 && avisos[0].includes('1 de 4 quadros') && avisos[0].includes('pior 120ms'), 'medidor: fecha a janela com contagem e pior caso');
    avisos.length = 0;
    med.registrar(4, 1400);
    med.registrar(4, 2500);
    ok(avisos.length === 0, 'medidor: janela sem quadro lento não avisa');
  }

  console.log(`\nplayer-control: ${oks} ok, ${fails} fail`);
  if (fails) process.exit(1);
}

void main();
