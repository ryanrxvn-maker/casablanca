# DARKO LAB — HeyGen Auto (Chrome Extension)

Automacao da geracao de avatares HeyGen direto da sua conta logada.
Sem consumir API publica (usa sua mensalidade HeyGen).

## Como instalar

1. Baixa o ZIP da extensao no DARKO LAB → ferramenta HeyGen Auto Avatar → "Como instalar"
2. Descompacta a pasta no seu computador
3. Abre o Chrome e vai em `chrome://extensions`
4. Liga **Modo de desenvolvedor** (canto superior direito)
5. Clica **Carregar sem compactacao**
6. Seleciona a pasta descompactada
7. A extensao "DARKO LAB — HeyGen Auto" deve aparecer ativa
8. Faz login no HeyGen normalmente em outra aba (https://app.heygen.com)
9. Volta no DARKO LAB → ferramenta HeyGen Auto Avatar — deve detectar a extensao automaticamente

## Como usar

1. Na ferramenta HeyGen Auto Avatar:
   - Escolhe o motor (Avatar III/IV/V)
   - Busca o avatar pelo nome (preview com thumbnail)
   - Cole a copy ou faz upload dos audios divididos
   - Clica "Gerar todas as partes via HeyGen"
2. A extensao automatiza o HeyGen no fundo, parte por parte
3. No final, baixa um ZIP com `parte1.mp4`, `parte2.mp4`, ... organizados na ordem certa

## Requisitos

- Google Chrome (ou navegador baseado em Chromium — Edge, Brave, etc)
- Conta HeyGen ativa (qualquer plano)
- Estar logado no HeyGen no momento de gerar

## Privacidade

A extensao:
- So acessa app.heygen.com e o site DARKO LAB
- NAO envia suas credenciais pra nenhum servidor (tudo roda local + sua sessao HeyGen)
- NAO acessa nenhuma outra aba/site
- Codigo aberto — voce pode auditar todos os arquivos

## Troubleshooting

**"Extensao nao detectada"**
- Verifica se ela esta ativada em `chrome://extensions`
- Recarrega a pagina do DARKO LAB
- Se persistir, remove e reinstala

**"HeyGen rejeitou a request — login pode ter expirado"**
- Vai em https://app.heygen.com e re-loga
- Volta na ferramenta e tenta de novo

**"Aba HeyGen nao respondeu"**
- A extensao precisa de pelo menos 1 aba HeyGen aberta. Abre uma e tenta de novo.

## Versao

1.4.0 — URL HeyGen corrigida (/avatar em vez de /create-video) + tab navigate fallback.
1.3.0 — manifest permissivo (qualquer *.vercel.app + localhost).
1.2.0 — botao "Testar conexao HeyGen" + endpoints internos priorizados.
1.1.0 — modo audio (lipsync via upload) + texto-pra-video.
1.0.0 — primeira release (apenas modo texto).
