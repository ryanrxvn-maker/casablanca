// Relógio NÃO-ESTRANGULADO pro polling do HeyGen rodar mesmo com a aba em
// SEGUNDO PLANO. O Chrome aplica "intensive throttling" (timers da JANELA caem
// pra ~1x/min depois de 5min com a aba oculta) — isso congelava o poll do
// render ("RENDERIZANDO" eterno) e a montagem quando o user trocava de aba.
// Timers DENTRO de um Web Worker NÃO sofrem esse throttle agressivo (piso ~1x/s),
// o que é de sobra pro poll de ~8s. A main thread só recebe um EVENTO (mensagem)
// e dispara o fetch — eventos não são estrangulados como timers.
//
// Protocolo: a página manda { id, ms }; o worker responde com `id` após `ms`.
self.onmessage = function (e) {
  var d = e.data || {};
  if (d.ms == null || d.id == null) return;
  setTimeout(function () {
    self.postMessage(d.id);
  }, d.ms);
};
