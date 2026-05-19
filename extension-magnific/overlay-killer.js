/**
 * DARKO LAB — Magnific Overlay Killer (ISOLATED world, document_start)
 * v3.5.56
 *
 * PROBLEMA: o Magnific às vezes mostra modais/banners SOBRE o canvas
 * (Vue Flow): "Help us improve Spaces", widget de feedback Usersnap,
 * avisos de "early preview", banner de cookies. Quando isso cobre o
 * canvas, os cliques REAIS (CDP) da automação acertam o modal em vez
 * dos nós -> falha em criar image gen / edge -> EDGE_CREATE_FAIL ->
 * retries -> "bugou". Esta é a causa que o usuário notou na tela.
 *
 * FIX: detectar e remover/ocultar APENAS esses overlays de
 * feedback/preview/cookies, de forma CONTÍNUA (observer + intervalo),
 * com assinaturas ESTRITAS. NUNCA toca no editor nem nos popups
 * funcionais do Vue Flow (Add / search de node / dropdowns de modelo)
 * que o pipeline PRECISA — senão quebraria o que funciona.
 */
(function () {
  'use strict';
  if (window.__darkoOvlKiller) return;
  window.__darkoOvlKiller = true;

  // Frases que SÓ existem nos modais de feedback/preview (nunca no
  // editor). Conservador de propósito.
  var TEXT_SIGS = [
    'help us improve',
    'spaces is in early preview',
    "we'd love to hear what you think",
    'share your thoughts or suggestions',
    'send feedback',
  ];

  // Nunca mexer se estiver dentro do editor / popups funcionais.
  function inEditor(el) {
    return !!(
      el.closest &&
      el.closest(
        '.vue-flow, .vue-flow__pane, .vue-flow__node, .vue-flow__handle, ' +
          '.vue-flow__edge, [class*="vue-flow"], [data-testid*="node"]',
      )
    );
  }

  function looksLikeFeedbackModal(el) {
    // precisa ser overlay flutuante
    var cs;
    try {
      cs = getComputedStyle(el);
    } catch (e) {
      return false;
    }
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    if (el.offsetWidth < 120 || el.offsetHeight < 80) return false;
    if (inEditor(el)) return false;
    var t = (el.innerText || '').toLowerCase().slice(0, 600);
    if (!t) return false;
    var hits = 0;
    for (var i = 0; i < TEXT_SIGS.length; i++) {
      if (t.indexOf(TEXT_SIGS[i]) !== -1) hits++;
    }
    // 1 frase forte ("help us improve"/"early preview") OU 2 sinais
    if (
      t.indexOf('help us improve') !== -1 ||
      t.indexOf('spaces is in early preview') !== -1
    )
      return true;
    return hits >= 2;
  }

  function hide(el) {
    try {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.setAttribute('data-darko-killed', '1');
    } catch (e) {
      /* noop */
    }
  }

  function nuke() {
    try {
      // 1) Usersnap (widget de feedback) — iframe + botão + container
      var us = document.querySelectorAll(
        'iframe[src*="usersnap" i], [id*="usersnap" i], [class*="usersnap" i], ' +
          '#us-entrypoint-container, .us-entrypoint, [data-usersnap]',
      );
      for (var i = 0; i < us.length; i++) {
        if (!inEditor(us[i])) hide(us[i]);
      }

      // 2) Modais de feedback "Help us improve Spaces" / early preview.
      //    Varre só candidatos fixed/absolute (barato), sobe pro
      //    container do modal e oculta — tenta fechar no X antes.
      var cand = document.querySelectorAll(
        'div[role="dialog"], [aria-modal="true"], div[class*="modal" i], ' +
          'div[class*="dialog" i], div[class*="feedback" i], ' +
          'div[class*="overlay" i], div[class*="popover" i]',
      );
      for (var j = 0; j < cand.length; j++) {
        var el = cand[j];
        if (el.getAttribute('data-darko-killed')) continue;
        if (!looksLikeFeedbackModal(el)) continue;
        // tenta clicar num botão de fechar (X) dentro
        var x = el.querySelector(
          'button[aria-label*="close" i], button[aria-label*="fechar" i], ' +
            '[class*="close" i] button, button[class*="close" i]',
        );
        if (x) {
          try {
            x.click();
          } catch (e) {
            /* noop */
          }
        }
        // sobe até o wrapper de overlay (backdrop) e oculta tudo
        var root = el;
        for (var up = 0; up < 4; up++) {
          var p = root.parentElement;
          if (!p || p === document.body) break;
          var pcs;
          try {
            pcs = getComputedStyle(p);
          } catch (e) {
            break;
          }
          if (
            (pcs.position === 'fixed' || pcs.position === 'absolute') &&
            !inEditor(p)
          ) {
            root = p;
          } else break;
        }
        if (!inEditor(root)) hide(root);
        else hide(el);
      }

      // 3) Banner de cookies/consent (clica aceitar; senão oculta)
      var cc = document.querySelectorAll(
        '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], ' +
          '[class*="consent" i], [class*="gdpr" i]',
      );
      for (var k = 0; k < cc.length; k++) {
        var c = cc[k];
        if (c.getAttribute('data-darko-killed') || inEditor(c)) continue;
        var txt = (c.innerText || '').toLowerCase();
        if (txt.indexOf('cookie') === -1 && txt.indexOf('consent') === -1)
          continue;
        var acc = c.querySelector('button');
        if (acc) {
          try {
            acc.click();
          } catch (e) {
            /* noop */
          }
        }
        hide(c);
      }
    } catch (e) {
      /* nunca deixa o killer derrubar a página */
    }
  }

  // CSS estático pro Usersnap (some imediato, sem flicker)
  try {
    var st = document.createElement('style');
    st.id = 'darko-ovl-css';
    st.textContent =
      'iframe[src*="usersnap" i],[id*="usersnap" i],[class*="usersnap" i],' +
      '#us-entrypoint-container,.us-entrypoint{display:none!important;' +
      'pointer-events:none!important;visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {
    /* noop */
  }

  function start() {
    nuke();
    try {
      var mo = new MutationObserver(function () {
        nuke();
      });
      mo.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      /* noop */
    }
    // rede de segurança: varre a cada 1.2s (querys baratas + bounded)
    setInterval(nuke, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    // mesmo antes do DOMContentLoaded, tenta cedo
    setTimeout(nuke, 300);
  } else {
    start();
  }
  try {
    console.log('[DARKO OVERLAY-KILLER] v3.5.56 ativo');
  } catch (e) {
    /* noop */
  }
})();
