/* Shared, dependency-free rules for the popup and persistent download worker. */
(function (root) {
  'use strict';
  const terminal = (state) => ['complete', 'error', 'canceled'].includes(state);
  function normalizeUrl(value) {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Cole um link válido começando com https://.');
    }
    if (/(^|\.)youtube\.com$/.test(url.hostname) && url.searchParams.has('v')) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(url.searchParams.get('v'))}`;
    }
    if (url.hostname === 'youtu.be') {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(url.pathname.slice(1))}`;
    }
    url.hash = '';
    return url.href;
  }
  function humanError(error) {
    const s = String(error?.message || error || 'Não foi possível concluir o download.');
    if (/USER_CANCELED|cancelado/i.test(s)) return 'Download cancelado.';
    if (/FILE_NO_SPACE/i.test(s)) return 'Não há espaço livre para salvar. Libere espaço e tente novamente.';
    if (/FILE_ACCESS_DENIED|FILE_BLOCKED|FILE_VIRUS/i.test(s)) return 'O navegador bloqueou o arquivo. Confira o aviso na lista de downloads.';
    if (/FILE_FAILED|FILE_NAME_TOO_LONG|FILE_TOO_LARGE/i.test(s)) return 'O navegador não conseguiu salvar o arquivo. Confira a pasta de downloads e tente novamente.';
    if (/ENGINE_UPDATE_REQUIRED/i.test(s)) return 'Atualize o Motor do Downloader para continuar.';
    if (/ENGINE_OFFLINE|Failed to fetch|fetch failed|NETWORK_FAILED|NETWORK_DISCONNECTED|NETWORK_TIMEOUT|SERVER_FAILED|SERVER_UNREACHABLE/i.test(s)) return 'A conexão foi interrompida. Confira a internet e se o Motor está aberto; depois tente novamente.';
    if (/SERVER_UNAUTHORIZED|401|token|FORBIDDEN/i.test(s)) return 'A conexão com o Motor mudou. Clique em reconectar e tente novamente.';
    if (/unsupported url|não suportad/i.test(s)) return 'Este link não é compatível. Abra o vídeo e copie o endereço da página.';
    if (/sign in|login_required|login required|log in|confirm.*bot|cookies/i.test(s)) return 'Este vídeo exige acesso à conta. Abra o site no navegador, entre na sua conta e tente novamente.';
    if (/private video|video unavailable|removed|not available|404/i.test(s)) return 'O vídeo está indisponível ou privado. Confira se o link abre na sua conta.';
    if (/timed out|timeout|tempo esgotado/i.test(s)) return 'O serviço demorou demais para responder. Tente novamente em alguns instantes.';
    if (/unable to download|unable to extract/i.test(s)) return 'O site não liberou este vídeo. Confira se o link abre no navegador e tente novamente.';
    if (/SERVER_BAD_CONTENT|INVALID_MEDIA/i.test(s)) return 'O serviço não entregou um arquivo de mídia válido. Nenhum arquivo de erro foi salvo.';
    return s.replace(/^ERROR:\s*/i, '').slice(0, 400);
  }
  function isMedia(type, filename, size) {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) return false;
    const mime = String(type || '').split(';')[0].trim().toLowerCase();
    const isVideoAudio = /\.(mp4|m4v|mov|webm|mkv|mp3|wav|m4a|aac|ogg|opus)$/i.test(filename || '');
    // Pinterest can return a still image. Keep the same raster formats as
    // downloader-core.CONTENT_TYPES; an error document is never a download.
    const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(filename || '');
    if (mime === 'application/octet-stream') return isVideoAudio || isImage;
    return (isVideoAudio && /^(video|audio)\/[a-z0-9.+-]+$/.test(mime)) ||
      (isImage && /^image\/(jpeg|jpg|png|webp|gif)$/.test(mime));
  }
  function newerVersion(latest, installed) {
    const a = String(latest).split('.').map(Number), b = String(installed).split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
  }
  root.DownloaderUtils = { terminal, normalizeUrl, humanError, isMedia, newerVersion };
})(globalThis);
