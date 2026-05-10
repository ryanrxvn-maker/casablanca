// content-bridge.js roda no isolated world em https://*.heygen.com/*.
// Unica responsabilidade: receber pedidos de fetch da sidepanel
// (via chrome.tabs.sendMessage) e executa-los aqui — assim a request sai
// com Origin = https://app.heygen.com e cookies da sessao do usuario,
// que e o que a HeyGen aceita. Sem isso a HeyGen retorna 403 forbidden.

(() => {
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function proxyApiFetch({ url, method = "GET", headers = {}, bodyText, bodyBase64, bodyType }) {
    const opts = { method, headers: { ...headers } };
    let host = "";
    try { host = new URL(url).host; } catch {}
    // Cookies de sessao so para api2.heygen.com (S3 nao precisa).
    if (host.endsWith("heygen.com")) opts.credentials = "include";

    let uploadedBytes = 0;
    if (bodyText !== undefined) {
      opts.body = bodyText;
      uploadedBytes = bodyText.length;
    } else if (bodyBase64) {
      const bytes = base64ToBytes(bodyBase64);
      uploadedBytes = bytes.byteLength;
      opts.body = new Blob([bytes], { type: bodyType || "application/octet-stream" });
    }

    const r = await fetch(url, opts);
    let data;
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("json")) {
      try { data = await r.json(); } catch { data = {}; }
    } else {
      try { data = { _text: (await r.text()).slice(0, 2000) }; } catch { data = {}; }
    }
    return { status: r.status, ok: r.ok, body: data, _uploadedBytes: uploadedBytes };
  }

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "ping") {
        sendResponse({ ok: true, url: location.href });
        return true;
      }
      if (msg?.type === "api-fetch") {
        proxyApiFetch(msg.req).then(sendResponse, (e) =>
          sendResponse({ status: 0, ok: false, body: { message: String(e?.message || e) } })
        );
        return true; // resposta async
      }
    });
  } catch {
    // Extension context invalidated. Sem-op.
  }
})();
