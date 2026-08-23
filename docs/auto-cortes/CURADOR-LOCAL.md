# AUTO CORTES — CURADOR LOCAL (inteligência sem API, sem limite, sem custo)

> Decisão do dono (23.08.2026): **"não pode ter uso onde fica acabando token"** — a
> ferramenta tem que produzir cortes bons de forma **ilimitada e gratuita**, sempre.
>
> Então a inteligência sai da API e entra na ferramenta. O curador roda 100 % no
> navegador, sem rede, sem chave, sem cota. A IA de texto (Groq/Claude) vira um
> **polimento opcional** dos títulos — e se ela faltar, falhar ou limitar, o
> resultado continua completo. Nenhum caminho do produto depende dela.

## Por que dá pra fazer sem LLM

O que o Opus Clip realmente faz bem é **achar fronteira de assunto** e **medir
energia da fala**. Isso é medição, não geração:

| Sinal | De onde vem (grátis) |
|---|---|
| Onde um assunto começa/termina | TextTiling sobre TF-IDF das frases (a própria transcrição é o corpus) |
| Ênfase, riso, empolgação | Envelope de RMS do áudio (uma passada do ffmpeg que já roda) |
| Respiro / fim de raciocínio | Pausas entre palavras (já temos timing por palavra) |
| Gancho | Léxico de abertura + número/dinheiro/tempo na 1ª frase |
| Fecho | Pontuação final + ausência de conjunção pendurada |
| Autossuficiência | Anáfora não resolvida na abertura ("isso", "ele", "essa parada") |
| Valor/densidade | TF-IDF alto = termos específicos, não conversa fiada |
| Citabilidade | Frase curta, imperativa, com contraste ou número |

Geração de texto (título/headline) é o único ponto onde LLM ajuda de verdade —
e mesmo isso resolve bem por **extração + molde**, porque as headlines que
funcionam são quase citação ("6 anos faturando +R$30M: o segredo da consistência").

## Arquitetura

```
transcript (words + sentences)  ─┐
envelope de RMS (0,5 s)         ─┼─►  curate()  ─►  FinalClip[]  (mesmo formato de hoje)
settings (duração, nº, gênero)  ─┘         │
                                           └─► (opcional) polir títulos com IA
```

Tudo em `lib/auto-cortes/curador/` — **puro, sem DOM, sem rede, testável em Node**.
A única peça que toca ffmpeg é `lib/auto-cortes/prosody.ts`.

### Arquivos

| Arquivo | Conteúdo |
|---|---|
| `text.ts` | normalização (minúscula, sem acento), tokenização, detecção de número/dinheiro/tempo/percentual |
| `stopwords.ts` | listas PT/EN/ES + muletas ("então", "né", "tipo", "assim", "cara") |
| `lexicon.ts` | marcadores por família: gancho, contraste, imperativo, superlativo, pergunta, anáfora, conectivo-pendurado, emoção. PT primeiro, EN/ES em seguida |
| `tfidf.ts` | vetor TF-IDF por frase (idf do próprio vídeo), cosseno, densidade de termo raro |
| `topics.ts` | TextTiling: similaridade de blocos deslizantes → escore de vale → fronteiras de assunto |
| `prosody.ts` (fora do curador) | envelope de RMS por 0,5 s via ffmpeg `astats` (lido do log, não da memória) |
| `candidates.ts` | gera spans candidatos ancorados em fronteira de frase/assunto, dentro da faixa de duração |
| `score.ts` | 6 sub-notas 0-100 + total; mesma forma de `ScoreBreakdown` |
| `titles.ts` | headline/título/descrição/hashtags extrativos |
| `curate.ts` | orquestra: candidatos → nota → dedup/diversidade → top N → `FinalClip[]` |

## Regras que valem nota (o miolo)

**Fronteira de assunto (topics.ts).** Janela de k=6 frases de cada lado, cosseno
TF-IDF entre os dois blocos a cada junta; escore de profundidade
`(pico_esq - vale) + (pico_dir - vale)`; fronteira onde profundidade
> média + 0,5·desvio. Fronteira também é forçada em pausa ≥ 1,5 s.

**Candidatos (candidates.ts).** Para cada fronteira de assunto, span até a
próxima fronteira; se passar do teto de duração, quebra em sub-spans que
terminem em pontuação final; se ficar abaixo do piso, junta com o vizinho do
mesmo assunto. Também gera spans "gancho forte" começando em qualquer frase com
nota de abertura alta. Sempre alinhado a frase inteira.

**Notas (score.ts)** — todas 0-100, determinísticas:
- `hook`: marcadores de gancho na 1ª frase (+peso pra número/dinheiro/%), pergunta direta, imperativo, contraste; penaliza abertura com muleta/conectivo/anáfora.
- `value`: média do TF-IDF das palavras de conteúdo (termo específico > conversa fiada) + presença de dado concreto.
- `emotion`: z-score da energia RMS do trecho vs vídeo inteiro + variação (pico/média) + marcadores emocionais.
- `completeness`: começa em fronteira de assunto (+), termina em pontuação final (+), não termina em conectivo (+), pausa longa logo após o fim (+).
- `shareability`: existe frase curta e citável no trecho (≤ 14 palavras, com número/contraste/imperativo).
- `standalone` (**novo, entra no total mas não no `ScoreBreakdown`**): penaliza anáfora não resolvida nas 2 primeiras frases.

Total = `0,32·hook + 0,22·shareability + 0,16·value + 0,15·emotion + 0,15·completeness`, depois `× standalone` (0,6–1,0). Normalizado pra 0-99 **relativo ao melhor do vídeo** (é ranking, como já está na copy).

**Seleção (curate.ts).** Ordena por total; descarta sobreposição > 25 % com um já
escolhido; limita 2 cortes por assunto enquanto houver assunto sem representante
(diversidade); respeita `count` e a faixa de duração; devolve na ordem do score.

**Bordas.** Reusa `refineBounds` que já existe (snap em silêncio, nunca no meio
de palavra).

**Textos (titles.ts)** — sem inventar fato, só reorganizar o que foi dito:
- Escolhe a **frase-chave**: maior citabilidade dentro do corte.
- Limpa muletas, corta repetição, ajusta caixa.
- `headline` (≤ 8 palavras): se há número/dinheiro/tempo → molde `"<dado>: <benefício>"`; se há contraste → `"<A> ou <B>"`; se há imperativo → a própria ordem; senão → a frase-chave comprimida. Nunca ponto final.
- `title` (≤ 70 chars): `"<Tema em caixa alta inicial>: <payoff>"` a partir dos termos TF-IDF mais altos do corte + a frase-chave.
- `hook`: 1ª frase limpa.
- `description`: 2 linhas — o que a pessoa vai ver + o dado mais forte.
- `hashtags`: 5 termos TF-IDF mais altos do corte (normalizados, sem acento) + 1 de formato (`cortes`).
- `why`: montado dos sinais ("Abre com número e fecha a ideia em 48 s").

## Contrato

```ts
export type CurateInput = {
  transcript: Transcript;            // words + sentences + language
  energy: EnergyEnvelope | null;     // prosody.ts; null = pontua sem o sinal de energia
  settings: ClipSettings;
  durationSec: number;
};
export type CurateResult = { clips: FinalClip[]; topics: number[]; warnings: string[] };
export function curate(input: CurateInput): CurateResult;   // SÍNCRONO e determinístico
```

`FinalClip` é o mesmo tipo que a análise por IA já devolve (`lib/auto-cortes/analyze.ts`)
— o pipeline não muda de forma.

```ts
// lib/auto-cortes/prosody.ts
export type EnergyEnvelope = { stepSec: number; db: Float32Array };  // RMS dBFS por passo
export async function extractEnergyEnvelope(ff, mountedPath, opts): Promise<EnergyEnvelope | null>;
```
Uma passada: `-vn -af "aresample=8000,asetnsamples=n=4000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null -`
→ lê `lavfi.astats.Overall.RMS_level=-23.4` do log (0,5 s por valor). Falhou → `null` (o curador segue sem energia).

## Onde encaixa no pipeline

1. `ensureTranscript` (igual hoje).
2. **novo**: `extractEnergyEnvelope` na instância já montada (barato, sem heap).
3. `curate(...)` → clips. **Zero rede.**
4. Se `settings.polirComIa` e houver chave: 1 chamada curta (só os textos dos N cortes, ~800 tokens) pra reescrever títulos/headlines. Falhou/limitou → mantém os locais e registra aviso. **Nunca derruba o lote.**

## UI

Novo controle em Ajustes: **"Inteligência"**
- `Local (grátis e ilimitada)` — padrão
- `Refinar textos com IA (usa sua chave)` — opcional

Copy honesta: o local decide os cortes; a IA, quando ligada, só melhora título e headline.

## Testes obrigatórios

`curador.test.ts` com uma transcrição sintética PT de ~120 frases (3 assuntos, 1 história com virada, 1 lista, 1 trecho de logística sem valor):
- fronteiras de assunto caem entre os blocos plantados;
- o trecho de logística **não** entra no top N;
- o trecho com número + fecho entra em 1º;
- nenhum corte começa em muleta/anáfora nem termina em conectivo;
- durações dentro da faixa; sem sobreposição;
- determinismo (2 execuções = mesmo resultado);
- headline ≤ 8 palavras, sem ponto final; 5 hashtags; título ≤ 70 chars;
- roda sem `energy` (null) e com energy.
