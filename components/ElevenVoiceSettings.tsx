'use client';

import { useEffect, useState } from 'react';
import { listElevenModels, type ElevenModel } from '@/lib/elevenlabs-api-direct';
import { DEFAULT_PRESET, type ElevenPreset } from '@/lib/eleven-pilot-config';

/**
 * Ajustes da voz do ElevenLabs — o painel completo.
 *
 * Cada controle vem com o que ele faz EM PORTUGUÊS de gente. "Similarity
 * boost 0.75" não diz nada pra quem está com um anúncio pra entregar; "quanto
 * o áudio gruda na voz original" diz.
 *
 * O preset é salvo e reusado em todo disparo: o user calibra a assinatura
 * sonora dele uma vez e não mexe mais ([[eleven-pilot-config]]).
 */

const IDIOMAS: Array<{ id: string | null; label: string }> = [
  { id: null, label: 'Detectar' },
  { id: 'pl', label: 'Polonês' },
  { id: 'pt', label: 'Português' },
  { id: 'en', label: 'Inglês' },
  { id: 'es', label: 'Espanhol' },
];

/** No v3 a estabilidade não é contínua — são três modos fechados. */
const V3_STABILITY = [
  { v: 0, label: 'Criativo', hint: 'Mais emoção e variação. Pode escorregar na pronúncia.' },
  { v: 0.5, label: 'Natural', hint: 'O equilíbrio — é o que você usa hoje.' },
  { v: 1, label: 'Robusto', hint: 'Mais previsível e estável. Menos expressivo.' },
];

function isV3(modelId: string): boolean {
  return /(^|_)v3($|_)/i.test(modelId);
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="label-tech text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
          {label}
        </span>
        <span className="mono ml-auto text-[10px] font-semibold text-text">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="el-range w-full"
      />
      <p className="mt-0.5 text-[10.5px] leading-snug text-text-muted">{hint}</p>
      <style jsx>{`
        .el-range {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 999px;
          background: rgb(var(--line-strong));
          outline: none;
        }
        .el-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: linear-gradient(135deg, #ffffff, #cfd6e0);
          border: 1px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 0 10px -2px rgba(255, 255, 255, 0.7);
          cursor: pointer;
        }
        .el-range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          border: none;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

export function ElevenVoiceSettings({
  preset,
  onChange,
  disabled = false,
}: {
  preset: ElevenPreset;
  onChange: (p: ElevenPreset) => void;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<ElevenModel[]>([]);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto || models.length > 0) return;
    void listElevenModels().then(setModels);
  }, [aberto, models.length]);

  const set = (patch: Partial<ElevenPreset>) => onChange({ ...preset, ...patch });
  const setS = (patch: Partial<ElevenPreset['settings']>) =>
    onChange({ ...preset, settings: { ...preset.settings, ...patch } });

  const modeloAtual = models.find((m) => m.id === preset.modelId);
  const v3 = isV3(preset.modelId);

  const mudouDoPadrao =
    JSON.stringify(preset) !== JSON.stringify(DEFAULT_PRESET);

  return (
    <div className="rounded-[12px] border border-line-strong bg-bg-soft/40">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <svg
          className="h-3.5 w-3.5 text-text-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        </svg>
        <span className="label-tech text-[9.5px] font-bold uppercase tracking-[0.16em] text-text-muted">
          Ajustes da voz
        </span>
        <span className="mono ml-auto truncate text-[9.5px] text-text-muted/80">
          {modeloAtual?.name || preset.modelId.replace(/_/g, ' ')}
          {mudouDoPadrao ? ' · editado' : ''}
        </span>
        <span className="text-[10px] text-text-muted">{aberto ? '▾' : '▸'}</span>
      </button>

      {aberto ? (
        <div className={'flex flex-col gap-3.5 border-t border-line px-3 py-3 ' + (disabled ? 'pointer-events-none opacity-50' : '')}>
          {/* Modelo */}
          <div>
            <div className="label-tech mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
              Modelo
            </div>
            <select
              value={preset.modelId}
              onChange={(e) => set({ modelId: e.target.value })}
              className="w-full rounded-[9px] border border-line-strong bg-bg px-2.5 py-1.5 text-[12px] text-text outline-none focus:border-white/50"
            >
              {models.length === 0 ? (
                <option value={preset.modelId}>{preset.modelId}</option>
              ) : (
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              )}
            </select>
            <p className="mt-0.5 text-[10.5px] leading-snug text-text-muted">
              {modeloAtual?.description ||
                'Multilingual v2 é o mais estável pra anúncio longo — é o que você já usa.'}
              {modeloAtual?.maxChars
                ? ` Aceita ${modeloAtual.maxChars.toLocaleString('pt-BR')} caracteres por vez (copy maior é dividida e emendada sem corte).`
                : ''}
            </p>
          </div>

          {/* Idioma */}
          <div>
            <div className="label-tech mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
              Idioma
            </div>
            <div className="flex flex-wrap gap-1.5">
              {IDIOMAS.map((l) => {
                const ativo = preset.languageCode === l.id;
                return (
                  <button
                    key={String(l.id)}
                    type="button"
                    onClick={() => set({ languageCode: l.id })}
                    className={
                      'mono rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-widest transition ' +
                      (ativo
                        ? 'border-white/70 bg-white/15 text-white'
                        : 'border-line-strong text-text-muted hover:border-white/40')
                    }
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-0.5 text-[10.5px] leading-snug text-text-muted">
              Travar o idioma evita o modelo &quot;errar o sotaque&quot; numa frase curta. No DR
              MILLION, polonês.
            </p>
          </div>

          {/* Estabilidade */}
          {v3 ? (
            <div>
              <div className="label-tech mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
                Estabilidade
              </div>
              <div className="flex flex-wrap gap-1.5">
                {V3_STABILITY.map((o) => {
                  const ativo = Math.abs(preset.settings.stability - o.v) < 0.01;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      title={o.hint}
                      onClick={() => setS({ stability: o.v })}
                      className={
                        'mono rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-widest transition ' +
                        (ativo
                          ? 'border-white/70 bg-white/15 text-white'
                          : 'border-line-strong text-text-muted hover:border-white/40')
                      }
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-0.5 text-[10.5px] leading-snug text-text-muted">
                Neste modelo a estabilidade tem três modos fechados — não é deslizante.
              </p>
            </div>
          ) : (
            <Slider
              label="Estabilidade"
              hint="Baixo = mais emoção, e cada geração sai um pouco diferente. Alto = sempre igual, porém mais chapado."
              value={preset.settings.stability}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setS({ stability: v })}
            />
          )}

          <Slider
            label="Semelhança"
            hint="Quanto o áudio gruda na voz original. Muito alto pode trazer junto o chiado do material que clonou."
            value={preset.settings.similarity_boost}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setS({ similarity_boost: v })}
          />

          <Slider
            label="Estilo"
            hint="Exagera o jeito de falar da voz. Acima de zero deixa a geração mais lenta e menos previsível — deixe em 0 pra anúncio."
            value={preset.settings.style}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setS({ style: v })}
          />

          <Slider
            label="Velocidade"
            hint="1.00 é o natural. Mexer pouco (0.95–1.05) já muda bastante o ritmo do anúncio."
            value={preset.settings.speed}
            min={0.7}
            max={1.2}
            step={0.01}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => setS({ speed: v })}
          />

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={preset.settings.use_speaker_boost}
              onChange={(e) => setS({ use_speaker_boost: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 accent-white"
            />
            <span>
              <span className="label-tech block text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
                Reforço de locutor
              </span>
              <span className="block text-[10.5px] leading-snug text-text-muted">
                Deixa a voz mais parecida com a original. Custa um pouco de latência.
              </span>
            </span>
          </label>

          {mudouDoPadrao ? (
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_PRESET, settings: { ...DEFAULT_PRESET.settings } })}
              className="mono self-start rounded-full border border-line-strong px-2.5 py-1 text-[9px] uppercase tracking-widest text-text-muted transition hover:border-white/50 hover:text-white"
            >
              restaurar padrão
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
