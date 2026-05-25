# -*- coding: utf-8 -*-
"""Gera o PDF de orientacoes pros copywriters do DARKO LAB.
Documenta a estrutura do briefing EXATAMENTE como o parser ja espera
(nada muda no fluxo) — pra leitura 100% assertiva de hook/body."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    HRFlowable,
)

OUT = r"D:\NOVOS DOWNLOADS\GUIA_COPY_DARKO_LAB.pdf"

styles = getSampleStyleSheet()
H1 = ParagraphStyle('H1', parent=styles['Title'], fontSize=22, leading=26,
                    textColor=colors.HexColor('#0b6b3a'), spaceAfter=6)
SUB = ParagraphStyle('SUB', parent=styles['Normal'], fontSize=11, leading=15,
                     textColor=colors.HexColor('#444444'), spaceAfter=14)
H2 = ParagraphStyle('H2', parent=styles['Heading1'], fontSize=15, leading=19,
                    textColor=colors.HexColor('#0b6b3a'), spaceBefore=16, spaceAfter=6)
H3 = ParagraphStyle('H3', parent=styles['Heading2'], fontSize=12.5, leading=16,
                    textColor=colors.HexColor('#1a1a1a'), spaceBefore=10, spaceAfter=4)
P = ParagraphStyle('P', parent=styles['Normal'], fontSize=10.5, leading=15,
                   spaceAfter=7)
LI = ParagraphStyle('LI', parent=P, leftIndent=14, spaceAfter=4)
MONO = ParagraphStyle('MONO', parent=styles['Code'], fontSize=9.5, leading=13,
                      backColor=colors.HexColor('#f4f4f4'),
                      borderColor=colors.HexColor('#dddddd'), borderWidth=0.5,
                      borderPadding=8, textColor=colors.HexColor('#222222'),
                      spaceBefore=4, spaceAfter=10)
NOTE = ParagraphStyle('NOTE', parent=P, fontSize=10, leading=14,
                      backColor=colors.HexColor('#fff7e0'),
                      borderColor=colors.HexColor('#e0b400'), borderWidth=0.5,
                      borderPadding=8, spaceBefore=4, spaceAfter=10)

story = []

def para(t, s=P): story.append(Paragraph(t, s))
def gap(h=6): story.append(Spacer(1, h))
def rule(): story.append(HRFlowable(width="100%", thickness=0.6,
          color=colors.HexColor('#cccccc'), spaceBefore=8, spaceAfter=8))

# ---------- CAPA ----------
para("Guia de Copy — DARKO LAB", H1)
para("Como escrever o briefing pra automacao ler com 100% de assertividade "
     "(hook e body). Esta estrutura JA e a usada — nada muda. Este guia so "
     "documenta pra todos os copywriters seguirem igual.", SUB)
rule()

para("1. Por que isto importa", H2)
para("A automacao (ClickUp Pilot / HeyGen Auto) le o documento do briefing e "
     "separa sozinha o que e <b>HOOK</b>, o que e <b>BODY</b> (o roteiro "
     "falado) e o que e <b>recomendacao/referencia</b> (links, instrucoes de "
     "edicao, nomenclatura). Se a copy seguir o padrao abaixo, o avatar fala "
     "exatamente o texto certo. Se fugir do padrao, o avatar pode acabar "
     "lendo link, nomenclatura ou instrucao em voz alta.", P)

para("2. Estrutura de um AD no documento", H2)
para("Cada AD segue esta ordem, de cima pra baixo:", P)
para(
 "1. <b>Cabecalho base do AD</b> — ex.: <font face='Courier'>AD15VN - PRPB06</font><br/>"
 "2. <b>Link do avatar:</b> &lt;arquivo&gt; (linha de referencia — NAO e fala)<br/>"
 "3. <b>Instrucoes para edicao:</b> ... (referencia — NAO e fala)<br/>"
 "4. <b>Nomenclatura do HOOK 1</b> + o texto do HOOK 1<br/>"
 "5. <b>Nomenclatura do HOOK 2</b> + o texto do HOOK 2 (se houver mais hooks, repete)<br/>"
 "6. <b>BODY</b> (palavra isolada, em MAIUSCULO, numa linha so)<br/>"
 "7. O <b>roteiro falado</b> (o body)<br/>"
 "8. Depois do body: <b>Guia N</b>, <b>Tela dividida</b> + links do Drive/"
 "TikTok, <b>Take logo de inicio</b>, etc. (tudo isso e referencia — NAO e fala)",
 LI)

para("3. Regras de OURO", H2)
para("&bull; O <b>HOOK</b> e o texto que vem logo ABAIXO da linha de "
     "nomenclatura do hook (ex.: <font face='Courier'>AD15G1VN - PRPB06 - "
     "AD15G1VN[C] - PRPB06</font>) e ANTES da palavra <b>BODY</b>.", LI)
para("&bull; O <b>BODY</b> comeca DEPOIS da linha que contem so a palavra "
     "<b>BODY</b> (em maiusculo, sozinha na linha) e vai ate o fim do "
     "roteiro falado.", LI)
para("&bull; Tudo que vier DEPOIS do roteiro (Guia, Tela dividida, links, "
     "Take logo...) e ignorado automaticamente — mas <b>nao cole esse lixo "
     "no meio do body</b>.", LI)
para("&bull; A palavra <b>BODY</b> deve estar <b>sozinha na linha</b> e em "
     "<b>MAIUSCULO</b>. Nao escreva 'Body:' no meio de uma frase.", LI)
para("&bull; A nomenclatura do hook deve estar <b>sozinha na linha</b>, "
     "logo acima do texto do hook.", LI)

story.append(PageBreak())

# ---------- INDICACAO DE AVATAR / ROLE ----------
para("4. Indicacao de quem fala (avatar / personagem)", H2)
para("Quando muda quem fala, marque numa <b>linha propria</b> com a palavra "
     "do papel seguida de dois-pontos. No documento isso normalmente vem "
     "<font color='#cc0000'><b>em vermelho</b></font>. A automacao usa essa "
     "linha so pra saber QUEM fala — ela NAO e lida em voz alta.", P)
para("Palavras de papel reconhecidas (use exatamente assim, com ':' no fim):", P)
roles = [
    "Homem:", "Mulher:", "Doutor:", "Doutora:",
    "Depoimento:", "Depoimento Homem:", "Depoimento Mulher:",
    "Entrevistador:", "Entrevistado:",
]
rt = Table([[Paragraph(f"<font face='Courier' color='#cc0000'>{r}</font>", P)
             for r in roles[i:i+3]] for i in range(0, len(roles), 3)],
           colWidths=[55*mm, 55*mm, 55*mm])
rt.setStyle(TableStyle([
    ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#dddddd')),
    ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#eeeeee')),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
]))
story.append(rt)
gap(10)
para("Formato correto (a linha do papel e o texto vem na linha de baixo):", H3)
para("<font color='#cc0000'>Doutor:</font><br/>"
     "Presta atencao, porque continuar comendo esses alimentos...<br/><br/>"
     "<font color='#cc0000'>Depoimento Homem:</font><br/>"
     "Faz 60 dias que nao levanto de madrugada pra ir no banheiro.", MONO)
para("NAO escreva o papel no meio da frase (ex.: 'ai o Homem: fala que...'). "
     "Sempre numa linha so, com ':' no final.", NOTE)

para("5. O que a automacao IGNORA (nao e fala)", H2)
para("Pode existir no documento, mas nunca sera lido pelo avatar — desde que "
     "esteja FORA do body (ou em linha propria):", P)
for t in [
    "Nomenclatura de AD (ex.: <font face='Courier'>AD15G2VN - PRPB06 - AD15G1VN[C] - PRPB06</font>)",
    "A palavra <b>BODY</b> (marcador)",
    "<b>Link do avatar:</b> ... e <b>Instrucoes para edicao:</b> ...",
    "<b>Tela dividida</b> e qualquer link (drive.google.com, tiktok.com, http...)",
    "<b>Take logo de inicio...</b> e descricoes de cena",
    "<b>Guia N</b> (ex.: Guia 4)",
    "Marcadores entre colchetes tipo [a], [bc]",
]:
    para("&bull; " + t, LI)
para("Importante: NAO cole a lista de links / 'Tela dividida' no MEIO do "
     "roteiro do body. Coloque sempre DEPOIS que o roteiro terminou.", NOTE)

story.append(PageBreak())

# ---------- EXEMPLO COMPLETO ----------
para("6. Exemplo completo (2 hooks) — modelo a seguir", H2)
para("AD15VN - PRPB06<br/>"
     "<font color='#cc0000'>Link do avatar:</font> omedicodoshomens.mp4<br/>"
     "<font color='#cc0000'>Instrucoes para edicao:</font> Estilo dinamico, "
     "ilustracoes de prostata, trilha conspiracional. Ref: "
     "https://drive.google.com/...<br/><br/>"
     "AD15G1VN - PRPB06 - AD15G1VN[C] - PRPB06<br/>"
     "Por que seu urologista ainda esconde de voce que esse alimento comum "
     "esta enchendo sua prostata como uma bola de tenis?<br/><br/>"
     "AD15G2VN - PRPB06 - AD15G1VN[C] - PRPB06<br/>"
     "Esses 3 alimentos sao como um veneno para a sua prostata.<br/><br/>"
     "BODY<br/>"
     "Presta atencao, porque continuar comendo esses alimentos pode "
     "significar ter que arrancar um pedaco da prostata...<br/>"
     "(... roteiro completo ...)<br/>"
     "E so tocar no botao pra ver.<br/><br/>"
     "Guia 4<br/>"
     "Tela dividida https://drive.google.com/open?id=...<br/>"
     "Take logo de inicio com ele derramando as capsulas: https://...",
     MONO)
para("Como a automacao le esse exemplo:", H3)
para("&bull; <b>HOOK 1</b> = 'Por que seu urologista ainda esconde...'", LI)
para("&bull; <b>HOOK 2</b> = 'Esses 3 alimentos sao como um veneno...'", LI)
para("&bull; <b>BODY</b> = de 'Presta atencao...' ate 'E so tocar no botao "
     "pra ver.' (para exatamente ai)", LI)
para("&bull; <b>Ignorado</b> = Link do avatar, Instrucoes, Guia 4, Tela "
     "dividida, todos os links e Take logo", LI)

para("7. Exemplo com 1 hook (tambem valido)", H2)
para("AD15VN - PRPB06<br/><br/>"
     "AD15G1VN - PRPB06 - AD15G1VN[C] - PRPB06<br/>"
     "Por que seu urologista ainda esconde de voce...?<br/><br/>"
     "BODY<br/>"
     "Presta atencao...<br/>"
     "(... roteiro ...)<br/>"
     "E so tocar no botao pra ver.", MONO)
para("Mesma regra: 1 ou N hooks, cada um com sua nomenclatura em linha "
     "propria; o BODY e unico e comeca apos a palavra BODY.", P)

story.append(PageBreak())

# ---------- CHECKLIST ----------
para("8. Checklist final do copywriter", H2)
data = [
    ["FACA", "NAO FACA"],
    ["Nomenclatura do hook sozinha numa linha, hook logo abaixo",
     "Hook na mesma linha da nomenclatura"],
    ["Escrever BODY sozinho, MAIUSCULO, numa linha so",
     "Escrever 'body' minusculo ou no meio de frase"],
    ["Body = so o roteiro falado, do inicio ao fim",
     "Colar links / 'Tela dividida' no meio do body"],
    ["Papel (Homem:/Mulher:/Doutor:/Depoimento:...) em linha propria com ':'",
     "Indicar quem fala no meio da frase"],
    ["Links, Guia N, Take logo SEMPRE depois do roteiro",
     "Misturar referencia/instrucao dentro do roteiro"],
    ["Manter a estrutura deste guia identica em todos os ADs",
     "Inventar formato novo por AD"],
]
t = Table(data, colWidths=[82*mm, 82*mm])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (0,0), colors.HexColor('#0b6b3a')),
    ('BACKGROUND', (1,0), (1,0), colors.HexColor('#8a1f1f')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
    ('FONTSIZE', (0,0), (-1,-1), 9.5),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cccccc')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f6f6f6')]),
    ('TOPPADDING', (0,0), (-1,-1), 7),
    ('BOTTOMPADDING', (0,0), (-1,-1), 7),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('RIGHTPADDING', (0,0), (-1,-1), 8),
]))
story.append(t)
gap(14)
para("Seguindo este guia, a automacao identifica hook e body com precisao "
     "exata — sem o avatar recitar link, nomenclatura ou instrucao. "
     "A estrutura nao deve mudar; basta manter todos os ADs neste padrao.",
     NOTE)

doc = SimpleDocTemplate(OUT, pagesize=A4,
                        topMargin=20*mm, bottomMargin=18*mm,
                        leftMargin=18*mm, rightMargin=18*mm,
                        title="Guia de Copy - DARKO LAB")
doc.build(story)
print("OK ->", OUT)
