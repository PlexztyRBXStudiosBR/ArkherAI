/* ============================================================
   ARKHER — service worker (o que faz o site virar "app").

   Regra de ouro: este service worker NAO guarda nada que venha do
   agente, do DsOS ou de API. Só o casco do site (html/js/icones).
   Motivo: se eu cacheasse /frame, você veria a tela de 5 minutos
   atrás achando que é a de agora. Nada de cache em coisa viva.

   Estrategia:
   - navegacao (index.html): rede primeiro, cache so como emergencia
     (offline mostra a ultima versao boa do casco, com aviso);
   - .js/.css/icones locais: cache primeiro + revalida em segundo plano;
   - qualquer outra origem (Tailscale, api.github, huggingface...): passa
     direto pela rede, sem cache nenhum.
   ============================================================ */
const VERSAO = 'arkher-v9';
const CASCO = ['./', './index.html', './manifest.json',
  './core.js', './vault.js', './auth.js', './sync.js', './dsos.js', './realtime.js',
  './dsos_client.js', './compute.js', './pool.js', './freeai.js', './websearch.js', './kaggle.js',
  './pilot.js', './skills.js', './app.js', './ui.js',
  './conhecimento.js', './neural.js', './memoria.js', './enxame.js', './cerebro_ui.js', './rdp.js', './pwa.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon.png'];

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    // cada arquivo isolado: se um faltar, os outros ainda entram
    await Promise.all(CASCO.map(async u => {
      try { await c.add(new Request(u, { cache: 'reload' })); } catch (e) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function mesmaOrigem(url) {
  try { return new URL(url).origin === self.location.origin; } catch (e) { return false; }
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;                     // POST nunca e cacheado
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!mesmaOrigem(req.url)) return;                     // agente/DsOS/APIs: rede direto
  if (/^\/(frame|job|health|guiready|file|gerar3d|ws)/.test(url.pathname)) return;
  if (/\.(glb|gltf|obj|stl)$/i.test(url.pathname)) return;

  const navegacao = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (navegacao) {
    ev.respondWith((async () => {
      try {
        const r = await fetch(req);
        const c = await caches.open(VERSAO);
        c.put('./index.html', r.clone());
        return r;
      } catch (e) {
        const c = await caches.open(VERSAO);
        const guardado = (await c.match('./index.html')) || (await c.match('./'));
        if (guardado) return guardado;
        return new Response('<h1>ARKHER offline</h1><p>Sem rede e sem copia guardada do site. ' +
          'Abra uma vez com internet que ele passa a abrir sozinho depois.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 });
      }
    })());
    return;
  }

  // casco local: cache primeiro, atualiza em segundo plano
  ev.respondWith((async () => {
    const c = await caches.open(VERSAO);
    const guardado = await c.match(req);
    const daRede = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    if (guardado) return guardado;
    const r = await daRede;
    if (r) return r;
    return new Response('', { status: 504, statusText: 'sem rede' });
  })());
});
