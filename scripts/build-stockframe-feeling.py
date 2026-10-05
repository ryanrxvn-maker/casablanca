"""Destila o FEELING do Silas (D:/B2C/FEELING/feeling.json, aprendido dos drafts
que ele montou e revisou) num indice compacto para o Smart Stocks do Pilot:

    nicho -> palavra/expressao da fala -> cenas que ELE pos em cima dela (peso)

As cenas sao os nomes dos b-rolls do acervo dele ("PROSTATA CRESCENDO, PROSTATA
GRANDE"); o Pilot compara essas palavras com o titulo e a ficha visual dos takes
do StockFrame. Nada de caminho, arquivo ou midia: so palavras e pesos.

Uso: python scripts/build-stockframe-feeling.py [D:/B2C/FEELING/feeling.json]
Gera data/stockframe-feeling.ts. Rodar de novo quando o acervo crescer.
"""
import io
import json
import re
import sys
import unicodedata

SRC = sys.argv[1] if len(sys.argv) > 1 else 'D:/B2C/FEELING/feeling.json'
OUT = 'data/stockframe-feeling.ts'

STOP = set('''a o as os um uma uns umas de da do das dos e em no na nos nas por para pra pro com sem sob sobre entre que quem
qual quais como quando onde porque se ao aos esta este esse essa isso isto seu sua seus suas meu minha meus minhas voce voces
ele ela eles elas eu nos mas ou ja muito muita mais menos tem ter foi ser sao era vai vao pode podem pelo pela pelos pelas ate
tambem ainda mesmo mesma assim aqui ali entao cada todo toda todos todas nao video videos clique clicar botao cena cenas take
takes parte conta contam contar ninguem detalhe jeito final atencao presta existe muda completamente quase nada tudo sempre
nunca coisa coisas vez vezes anos ano dia dias semana semanas certo certa tres dois duas uma hoje agora depois antes so
bem mal aquele aquela aquilo esses essas estes estas eram estava estao fica ficar faz fazer feito diz dizer disse sabe saber
quer querem acha acham olha veja vem vir deu dar tinha tem vai vou estou isso ai la cara gente pessoal
vida homem homens mulher mulheres pessoa pessoas problema problemas tempo forma mundo verdade medo jeito segredo
verdadeiro verdadeira simples facil rapido grande pequeno melhor pior primeiro primeira ultimo ultima unico unica
mesmo mesma outro outra outros outras qualquer nenhum nenhuma alguem algum alguma muitos muitas poucos poucas
idade casa nome lugar resultado resultados descoberta descobriu descobri fazendo usando tomando comecou comecei'''.split())
# Nomes de arquivo que nao descrevem cena (rip, clipe composto, hash, numero).
JUNK = re.compile(r'\b(?:clipe composto|lip\d*|ytdown|pindown|reel|1080p|720p|watermark|copy|final|novo|teste|img|vid|mov|mp4)\b')
GENERIC_SCENE = set('video videos clipe composto take broll b roll mp4 mov 3d hd 4k'.split())
# Marcas de ferramenta/rip no nome: saem as palavras, a cena fica.
TOOL_WORDS = re.compile(r'^(?:freepik|kling|grok|veo\d*|sora|runway|pixverse|hailuo|minimax|seedance|midjourney|animat\w*|ponta3d|\d+p|\d+fps|v\d+|copia|copy|final|novo|edit\w*|ytdown\w*|pindown\w*|reels?|tiktok|instagram|insta|snaptik|ssstik)$')
# Lei 2 do Silas (FONTE LIMPA): marca d'agua = legenda/logo queimado, fora.
# Cena explicita tambem: a trava do Pilot nunca a escolheria, e o indice vai
# num pedaco do site.
DIRTY = re.compile(r'\b(?:watermark|marca d agua|legendado|com legenda|chupa\w*|gostosa\w*|buceta|boquete|transa\w*|porn\w*|sexo oral|bunda\w*|peitos?|pelad\w*|nua|nude)\b')
CRUDE_WORDS = {'pinto', 'pau', 'piroca', 'rola', 'safado', 'safada'}


def norm(value: str) -> str:
    value = unicodedata.normalize('NFD', value.lower())
    value = ''.join(ch for ch in value if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


def scene_words(name: str) -> str:
    base = re.sub(r'\.(mp4|mov|mkv|webm|avi)$', '', name.strip(), flags=re.I)
    words = []
    for word in norm(base).split():
        if word.isdigit() or len(word) < 3 or word in STOP or word in GENERIC_SCENE or word in CRUDE_WORDS or TOOL_WORDS.match(word):
            continue
        if word not in words:
            words.append(word)
    return ' '.join(words[:10])


def niche_of(cell: str) -> str:
    niche = cell.split('|')[0]
    return niche if niche and niche != '?' else 'geral'


data = json.load(io.open(SRC, encoding='utf-8'))['associacoes']
merged: dict[str, dict[str, dict[str, float]]] = {}
for cell, keys in data.items():
    niche = niche_of(cell)
    target = merged.setdefault(niche, {})
    for key, brolls in keys.items():
        nkey = norm(key)
        tokens = [t for t in nkey.split() if t not in STOP and len(t) >= 4 and not t.isdigit()]
        if not tokens:
            continue
        slot = target.setdefault(nkey, {})
        for item in brolls:
            name = item.get('broll') or ''
            if DIRTY.search(norm(name)) or (JUNK.search(norm(name)) and len(scene_words(name).split()) < 2):
                continue
            words = scene_words(name)
            if len(words.split()) < 1 or not re.search(r'[a-z]{4,}', words):
                continue
            slot[words] = slot.get(words, 0.0) + float(item.get('peso') or 0)

out: dict[str, object] = {}
total_keys = 0
MIN_LIFT = 2.5
for niche, keys in merged.items():
    scenes: list[str] = []
    index: dict[str, int] = {}
    entries: dict[str, list[list[float]]] = {}
    # A legenda embaixo de um take traz a frase inteira: toda palavra dela
    # "associa" com o take. Lift separa o feeling do ruido — a cena tem de
    # aparecer bem mais sob ESTA palavra do que no acervo dele em geral
    # ("cirurgia" -> cirurgia de prostata; "vida" -> qualquer coisa).
    scene_total: dict[str, float] = {}
    for slot in keys.values():
        for words, weight in slot.items():
            scene_total[words] = scene_total.get(words, 0.0) + weight
    grand = sum(scene_total.values()) or 1.0
    for key, slot in keys.items():
        ranked = sorted(slot.items(), key=lambda pair: -pair[1])
        total = sum(weight for _, weight in ranked)
        # Palavra que ele so cobriu uma vez com peso baixo e' ruido, nao feeling.
        if total < 1.0:
            continue
        refs = []
        for words, weight in ranked[:6]:
            if weight < 0.5:
                continue
            lift = (weight / total) / (scene_total[words] / grand)
            if lift < MIN_LIFT:
                continue
            if len(refs) >= 4:
                break
            if words not in index:
                index[words] = len(scenes)
                scenes.append(words)
            refs.append([index[words], round(weight, 2)])
        if refs:
            entries[key] = refs
    if entries:
        out[niche] = {'scenes': scenes, 'keys': entries}
        total_keys += len(entries)

body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
header = ('/* Gerado por scripts/build-stockframe-feeling.py a partir do feeling.json do Silas\n'
          ' * (drafts que ele montou e revisou). So palavras e pesos: nenhum caminho nem midia. */\n')
io.open(OUT, 'w', encoding='utf-8', newline='\n').write(
    header + 'export type StockFrameFeelingNiche = { scenes: string[]; keys: Record<string, [number, number][]> };\n'
    + 'export const stockFrameFeeling: Record<string, StockFrameFeelingNiche> = ' + body + ';\n')
summary = ', '.join('%s=%d' % (name, len(value['keys'])) for name, value in out.items())
print(f'{OUT}: {len(body) // 1024} KB, {total_keys} expressoes, nichos: {summary}')
