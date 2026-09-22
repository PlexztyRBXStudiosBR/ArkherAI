/* DsOS Client — o site NAO desenha o desktop; ele recebe a tela do DsOS remoto.
   Mesmo canal do agente: Tailscale + HTTP. */
(function () {
  const C = {};
  const LSg = (k, d) => (window.LS ? LS.get(k, d) : d);
  const LSs = (k, v) => { if (window.LS) LS.set(k, v); };

  C.url = () => LSg('dsos_url', '');
  C.setUrl = u => LSs('dsos_url', (u || '').replace(/\/+$/, ''));
  C.ligado = false; C.hw = null; C.fps = 0; C.latencia = 0;

  async function req(rota, opt, ms) {
    const u = C.url(); if (!u) throw new Error('sem endereco do DsOS');
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms || 20000);
    try {
      const r = await fetch(u + rota, Object.assign({ signal: ac.signal }, opt || {}));
      if (!r.ok && r.status !== 503) throw new Error('HTTP ' + r.status);
      return r;
    } finally { clearTimeout(t); }
  }

  C.health = async function () {
    const t0 = performance.now();
    const r = await req('/health', {}, 12000);
    const j = await r.json();
    C.latencia = Math.round(performance.now() - t0);
    C.hw = j.hw || null; C.ligado = !!j.ok;
    return j;
  };
  C.boot    = async () => (await req('/boot', { method: 'POST' }, 90000)).json();
  C.sys     = async () => (await req('/sys', {}, 15000)).json();
  C.apps    = async () => (await req('/apps', {}, 15000)).json();
  C.procs   = async () => (await req('/procs', {}, 15000)).json();
  C.janelas = async () => (await req('/janelas', {}, 15000)).json();
  C.fs      = async p => (await req('/fs?p=' + encodeURIComponent(p || ''), {}, 15000)).json();
  C.abrir   = async bin => (await req('/abrir', { method: 'POST', body: JSON.stringify({ bin }) }, 40000)).json();
  C.matar   = async pid => (await req('/matar', { method: 'POST', body: JSON.stringify({ pid }) }, 15000)).json();
  C.exec    = async (cmd, timeout) => (await req('/exec', { method: 'POST', body: JSON.stringify({ cmd, timeout: timeout || 120 }) }, ((timeout || 120) + 10) * 1000)).json();

  /* entrada: WS quando existir (evento sai na hora), POST em lote quando nao.
     O RT.entrada cuida do agrupamento e da queda — aqui so repassamos. */
  let _ent = null;
  C.entradaModo = function () { return _ent ? _ent.modo : 'http'; };
  C.enviar = function (ev) {
    if (typeof RT !== 'undefined' && RT.entrada) {
      if (!_ent) _ent = RT.entrada(C.url(), msg => { if (C.onAvisoEntrada) C.onAvisoEntrada(msg); });
      _ent.enviar(ev);
      return;
    }
    fila.push(ev);
    if (!enviando) escoar();
  };
  let fila = [], enviando = false;
  async function escoar() {
    enviando = true;
    while (fila.length) {
      const lote = fila.splice(0, 12);
      try { await req('/input', { method: 'POST', body: JSON.stringify({ eventos: lote }) }, 15000); }
      catch (e) { /* nao trava a UI por um clique perdido */ }
    }
    enviando = false;
  }

  /* streaming de tela.
     WebSocket (RT.frames): o DsOS empurra os quadros; sem requisicao por foto.
     Sem WS (ou DsOS antigo), o proprio RT cai no /frame de antes. */
  C.stream = { rodando: false, q: 55, escala: 100, fps: 12, ms: 0, _n: 0, _t0: 0, modo: 'http' };
  C.iniciarStream = function (img, onErro, onStatus) {
    if (C.stream.rodando) return;
    C.stream.rodando = true; C.stream._n = 0; C.stream._t0 = performance.now();
    if (typeof RT !== 'undefined' && RT.frames) {
      let ultimo = 0;
      C.stream._rt = RT.frames(C.url(), { q: C.stream.q, fps: C.stream.fps || 12,
        scale: (C.stream.escala || 100) / 100 },
        d => {
          if (!C.stream.rodando) return;
          const agora = performance.now();
          if (ultimo) C.stream.ms = Math.round(agora - ultimo);
          ultimo = agora;
          img.src = d.img;
          C.stream._n++;
          const dt = (performance.now() - C.stream._t0) / 1000;
          if (dt >= 1) {
            C.fps = +(C.stream._n / dt).toFixed(1);
            C.stream._n = 0; C.stream._t0 = performance.now();
            C._adaptarArrocho();
            if (onStatus) onStatus(C.fps, C.stream.ms);
          }
        },
        msg => { if (onErro) onErro(msg); });
      C.stream.modo = 'ws';
      return;
    }
    let ultimoUrl = null;
    (async function laco() {
      while (C.stream.rodando) {
        const t0 = performance.now();
        try {
          const r = await req('/frame?q=' + C.stream.q + '&s=' + (C.stream.escala || 100), {}, 25000);
          if (r.status === 503) {
            const j = await r.json().catch(() => ({}));
            if (onErro) onErro(j.erro || 'sessao grafica indisponivel');
            await new Promise(s => setTimeout(s, 3000));
            continue;
          }
          const b = await r.blob();
          if (!C.stream.rodando) break;
          const u = URL.createObjectURL(b);
          img.src = u;
          if (ultimoUrl) URL.revokeObjectURL(ultimoUrl);
          ultimoUrl = u;
          C.stream.ms = Math.round(performance.now() - t0);
          C.stream._n++;
          const dt = (performance.now() - C.stream._t0) / 1000;
          if (dt >= 1) {
            C.fps = +(C.stream._n / dt).toFixed(1);
            C.stream._n = 0; C.stream._t0 = performance.now();
            C._adaptarArrocho();
            if (onStatus) onStatus(C.fps, C.stream.ms);
          }
        } catch (e) {
          if (onErro) onErro(e.message);
          await new Promise(s => setTimeout(s, 2500));
        }
      }
      if (ultimoUrl) URL.revokeObjectURL(ultimoUrl);
    })();
  };
  C.pararStream = function () {
    C.stream.rodando = false;
    if (C.stream._rt) { try { C.stream._rt.parar(); } catch (e) {} C.stream._rt = null; }
  };

  /* ------------------------------------------------------------------
     VISTA: encaixe, zoom e cursor virtual
     A tela remota nao e "uma imagem": e uma janela para outra maquina.
     Aqui ficam os modos de encaixe, o zoom por pinca e o cursor de mouse
     controlado pelo dedo (trackpad) — o que faltava pra usar no celular.
     ------------------------------------------------------------------ */
  C.vista = { modo: LSg('dsos_fit', 'ajustar'), zoom: 1, panX: 0, panY: 0,
              img: null, caixa: null, cursorEl: null, base: 1 };
  C.MODOS_VISTA = ['ajustar', 'preencher', 'largura', '100'];
  C.rotuloVista = m => ({ ajustar: 'Ajustar', preencher: 'Preencher', largura: 'Largura', '100': '100%' }[m] || m);

  C.ligarVista = function (img, caixa, cursorEl) {
    const v = C.vista;
    v.img = img; v.caixa = caixa || img.parentElement; v.cursorEl = cursorEl || null;
    if (!img._dsosVista) {
      img._dsosVista = true;
      img.addEventListener('load', C.recalcular);
      window.addEventListener('resize', C.recalcular);
      window.addEventListener('orientationchange', () => setTimeout(C.recalcular, 250));
      if (window.visualViewport) window.visualViewport.addEventListener('resize', C.recalcular);
    }
    C.recalcular();
  };

  /* encaixa a imagem na caixa: ajustar (inteira) | preencher (corta) |
     largura (enche a largura) | 100 (pixel por pixel) + zoom e pan */
  C.recalcular = function () {
    const v = C.vista, img = v.img, caixa = v.caixa;
    if (!img || !caixa) return;
    const W = img.naturalWidth || 0, H = img.naturalHeight || 0;
    if (!W || !H) return;
    const cw = caixa.clientWidth || 1, ch = caixa.clientHeight || 1;
    let f;
    if (v.modo === 'preencher') f = Math.max(cw / W, ch / H);
    else if (v.modo === 'largura') f = cw / W;
    else if (v.modo === '100') f = 1;
    else f = Math.min(cw / W, ch / H);       /* ajustar = cabe inteira */
    v.base = f;
    const s = f * v.zoom, dw = W * s, dh = H * s;
    const lx = Math.max(0, (dw - cw) / 2), ly = Math.max(0, (dh - ch) / 2);
    v.panX = Math.max(-lx, Math.min(lx, v.panX));
    v.panY = Math.max(-ly, Math.min(ly, v.panY));
    img.style.width = Math.round(dw) + 'px';
    img.style.height = Math.round(dh) + 'px';
    img.style.transform = 'translate(' + Math.round(v.panX) + 'px,' + Math.round(v.panY) + 'px)';
    C.sincronizarCursor();
  };

  C.setVista = function (m) {
    if (C.MODOS_VISTA.indexOf(m) < 0) return C.vista.modo;
    C.vista.modo = m; LSs('dsos_fit', m);
    C.vista.zoom = 1; C.vista.panX = 0; C.vista.panY = 0;
    C.recalcular();
    return m;
  };
  C.cicloVista = function () {
    const i = C.MODOS_VISTA.indexOf(C.vista.modo);
    return C.setVista(C.MODOS_VISTA[(i + 1) % C.MODOS_VISTA.length]);
  };
  C.zoom = function (f) {
    const v = C.vista;
    v.zoom = Math.max(0.4, Math.min(6, v.zoom * (f || 1)));
    C.recalcular();
    return v.zoom;
  };

  /* ---------- cursor virtual: o dedo vira trackpad ----------
     'toque' = toca e clica onde tocou (como hoje)
     'mouse' = arrasta o dedo e o cursor anda; toque curto = clique,
               toque longo = botao direito. A posicao real vem do DsOS
               pela rota /cursor — nao fica estimando. */
  C.cursor = { modo: LSg('dsos_cursor', 'toque'), x: 0, y: 0, tem: false };
  C.setCursorModo = function (m) {
    C.cursor.modo = (m === 'mouse') ? 'mouse' : 'toque';
    LSs('dsos_cursor', C.cursor.modo);
    const img = C.vista.img;
    if (C.cursor.modo === 'mouse' && !C.cursor.tem && img && img.naturalWidth) {
      C.cursor.x = Math.round(img.naturalWidth / 2);
      C.cursor.y = Math.round(img.naturalHeight / 2);
      C.cursor.tem = true;
      C.cursorReal();
    }
    if (C.onCursorModo) C.onCursorModo(C.cursor.modo);
    C.sincronizarCursor();
    return C.cursor.modo;
  };
  C.sincronizarCursor = function () {
    const v = C.vista, el = v.cursorEl, img = v.img;
    if (!el || !img) return;
    if (C.cursor.modo !== 'mouse' || !C.cursor.tem || !img.naturalWidth) { el.style.display = 'none'; return; }
    const r = img.getBoundingClientRect(), b = (v.caixa || img).getBoundingClientRect();
    el.style.display = 'block';
    el.style.left = Math.round(r.left - b.left + (C.cursor.x / img.naturalWidth) * r.width) + 'px';
    el.style.top = Math.round(r.top - b.top + (C.cursor.y / img.naturalHeight) * r.height) + 'px';
  };
  /* pergunta a posicao REAL ao DsOS (se a rota nao existir, segue na estimativa) */
  C.cursorReal = async function () {
    try {
      const r = await req('/cursor', {}, 8000);
      const j = await r.json();
      if (j && j.ok && j.x != null) {
        const esc = (j.escala || 100) / 100;      /* a rota devolve em pixels REAIS */
        C.cursor.x = Math.round(j.x * esc);
        C.cursor.y = Math.round(j.y * esc);
        C.cursor.tem = true;
        C.sincronizarCursor();
      }
      return j;
    } catch (e) { return null; }
  };

  /* ---------- qualidade: o que deixa a VM lisa ----------
     escala = resolucao que o DsOS MANDA (o maior ganho de fluidez);
     q = JPEG; fps = quantos quadros por segundo.                       */
  C.PRESETS = {
    auto:  { q: 60, escala: 75, fps: 12 },
    alta:  { q: 72, escala: 100, fps: 15 },
    media: { q: 60, escala: 75, fps: 12 },
    baixa: { q: 45, escala: 50, fps: 8 }
  };
  C._ordem = ['baixa', 'media', 'alta'];
  C.qual = LSg('dsos_qual', 'auto');
  C._nivel = 'media'; C._ultimoAjuste = 0;

  C._aplicarPreset = function (p) {
    C.stream.q = p.q; C.stream.escala = p.escala; C.stream.fps = p.fps;
    if (C.stream._rt && C.stream._rt.ajustar)
      C.stream._rt.ajustar({ q: p.q, scale: p.escala / 100, fps: p.fps });
  };
  C.setQualidade = function (n) {
    if (!C.PRESETS[n]) n = 'auto';
    C.qual = n; LSs('dsos_qual', n);
    if (n === 'auto') { C._nivel = 'media'; C._ultimoAjuste = Date.now(); }
    const p = C.PRESETS[n === 'auto' ? C._nivel : n];
    C._aplicarPreset(p);
    if (C.onQualidade) C.onQualidade(n, p);
    return n;
  };
  /* so no modo Auto: cai de nivel quando trava, sobe quando sobra folga */
  C._adaptarArrocho = function () {
    if (C.qual !== 'auto' || !C.fps) return;
    const agora = Date.now();
    if (agora - C._ultimoAjuste < 5000) return;
    const i = C._ordem.indexOf(C._nivel);
    if (C.fps < 7 && i > 0) {
      C._nivel = C._ordem[i - 1]; C._ultimoAjuste = agora;
      C._aplicarPreset(C.PRESETS[C._nivel]);
      if (C.onQualidade) C.onQualidade('auto', C.PRESETS[C._nivel], 'caiu para ' + C._nivel + ' (' + C.fps + ' fps)');
    } else if (C.fps > 18 && (C.stream.ms || 0) < 130 && i < C._ordem.length - 1) {
      C._nivel = C._ordem[i + 1]; C._ultimoAjuste = agora;
      C._aplicarPreset(C.PRESETS[C._nivel]);
      if (C.onQualidade) C.onQualidade('auto', C.PRESETS[C._nivel], 'subiu para ' + C._nivel + ' (' + C.fps + ' fps)');
    }
  };

  /* converte clique no <img> para coordenada DA IMAGEM recebida
     (o DsOS converte de volta para a tela real — inclusive com s<100) */
  C.coord = function (img, cx, cy) {
    const r = img.getBoundingClientRect();
    if (!img.naturalWidth || !r.width) return null;
    const x = Math.round((cx - r.left) / r.width * img.naturalWidth);
    const y = Math.round((cy - r.top) / r.height * img.naturalHeight);
    if (x < 0 || y < 0 || x > img.naturalWidth || y > img.naturalHeight) return null;
    return { x, y };
  };

  const ehToque = e => !!(e && (e.touches || e.changedTouches));

  /* liga touch/mouse/teclado. caixa = area que aceita o dedo (a tela toda,
     para que o trackpad funcione tambem fora da imagem). */
  C.ligarEntrada = function (img, caixa) {
    if (img._dsosLigado) return; img._dsosLigado = true;
    const alvo = caixa || img;
    let t0 = 0, px = 0, py = 0, arrastou = false, ativo = false;
    let ult = null, dist0 = 0, zoom0 = 1, pdx = 0, pdy = 0, tPend = 0;

    const um = e => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    const dois = e => (e.touches && e.touches.length >= 2) ? [e.touches[0], e.touches[1]] : null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const pxPorCliente = () => {
      const r = img.getBoundingClientRect();
      return r.width ? (img.naturalWidth || 1) / r.width : 1;
    };
    /* manda o movimento acumulado e move o cursor local junto */
    const escoarPend = () => {
      if (Math.abs(pdx) + Math.abs(pdy) < 0.6) return;
      const dx = Math.round(pdx), dy = Math.round(pdy);
      C.enviar({ t: 'trackpad', dx, dy });
      pdx -= dx; pdy -= dy;
      const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
      C.cursor.x = Math.max(0, Math.min(W - 1, C.cursor.x + dx));
      C.cursor.y = Math.max(0, Math.min(H - 1, C.cursor.y + dy));
      C.sincronizarCursor();
    };

    const inicio = e => {
      const d = dois(e);
      if (d) {                                  /* dois dedos: pan + pinca (nunca clica) */
        ult = { x: (d[0].clientX + d[1].clientX) / 2, y: (d[0].clientY + d[1].clientY) / 2 };
        dist0 = dist(d[0], d[1]); zoom0 = C.vista.zoom;
        ativo = true; arrastou = true;
        if (e.cancelable) e.preventDefault();
        return;
      }
      const s = um(e);
      const p = C.coord(img, s.clientX, s.clientY);
      if (C.cursor.modo === 'mouse') {
        if (!C.cursor.tem && img.naturalWidth) C.setCursorModo('mouse');
        ativo = true; arrastou = false; t0 = Date.now(); ult = null; pdx = 0; pdy = 0;
      } else {
        if (!p) return;
        ativo = true; arrastou = false; t0 = Date.now();
        px = p.x; py = p.y; ult = null;
      }
      if (e.cancelable) e.preventDefault();
    };

    const move = e => {
      if (!ativo) return;
      const d = dois(e);
      if (d) {                                  /* pan + pinca */
        const cx0 = (d[0].clientX + d[1].clientX) / 2, cy0 = (d[0].clientY + d[1].clientY) / 2;
        if (ult) { C.vista.panX += cx0 - ult.x; C.vista.panY += cy0 - ult.y; }
        ult = { x: cx0, y: cy0 };
        const dd = dist(d[0], d[1]);
        if (dist0 > 20) C.vista.zoom = Math.max(0.4, Math.min(6, zoom0 * (dd / dist0)));
        C.recalcular();
        if (e.cancelable) e.preventDefault();
        return;
      }
      const s = um(e);
      if (C.cursor.modo === 'mouse') {
        if (!ehToque(e)) {                      /* mouse de verdade: absoluto */
          const p = C.coord(img, s.clientX, s.clientY);
          if (p) { C.cursor.x = p.x; C.cursor.y = p.y; C.cursor.tem = true;
                   C.sincronizarCursor(); C.enviar({ t: 'move', x: p.x, y: p.y }); }
          return;
        }
        const k = pxPorCliente();               /* dedo -> pixels da imagem */
        if (ult) {
          pdx += (s.clientX - ult.x) * k;
          pdy += (s.clientY - ult.y) * k;
          if (Math.abs(pdx) + Math.abs(pdy) > 2) arrastou = true;   /* dedo andando */
        }
        ult = { x: s.clientX, y: s.clientY };
        const agora = performance.now();
        /* no maximo ~22/s, mas o PRIMEIRO movimento grande sai na hora
           (senao o cursor parece travado no comeco do arrasto) */
        if (agora - tPend > 45 || Math.abs(pdx) + Math.abs(pdy) > 8) { tPend = agora; escoarPend(); }
      } else {
        const p = C.coord(img, s.clientX, s.clientY);
        if (p && (Math.abs(p.x - px) > 6 || Math.abs(p.y - py) > 6)) arrastou = true;
        ult = { x: s.clientX, y: s.clientY };
      }
      if (e.cancelable) e.preventDefault();
    };

    const fim = e => {
      if (!ativo) return;
      if (e.touches && e.touches.length) { ult = null; return; }   /* soltou um dedo de dois */
      ativo = false;
      const dt = Date.now() - t0;
      if (C.cursor.modo === 'mouse') {
        escoarPend();
        if (dt < 500 && !arrastou) C.enviar({ t: 'click', x: C.cursor.x, y: C.cursor.y, btn: 'left' });
        else if (dt >= 500 && !arrastou) C.enviar({ t: 'click', x: C.cursor.x, y: C.cursor.y, btn: 'right' });
        C.cursorReal();
      } else {
        const s = um(e), p = C.coord(img, s.clientX, s.clientY);
        if (!p) { arrastou = false; return; }
        if (arrastou) C.enviar({ t: 'drag', x: px, y: py, x2: p.x, y2: p.y });
        else if (dt > 550) C.enviar({ t: 'click', x: p.x, y: p.y, btn: 'right' });
        else C.enviar({ t: 'click', x: p.x, y: p.y, btn: 'left' });
      }
      arrastou = false;
      if (e.cancelable) e.preventDefault();
    };

    alvo.addEventListener('touchstart', inicio, { passive: false });
    alvo.addEventListener('touchmove', move, { passive: false });
    alvo.addEventListener('touchend', fim, { passive: false });
    alvo.addEventListener('touchcancel', fim, { passive: false });
    alvo.addEventListener('mousedown', inicio);
    alvo.addEventListener('mousemove', move);
    alvo.addEventListener('mouseup', fim);
    img.addEventListener('contextmenu', e => e.preventDefault());
    img.addEventListener('dblclick', e => {
      const p = C.coord(img, e.clientX, e.clientY);
      if (p) C.enviar({ t: 'dbl', x: p.x, y: p.y });
    });
    img.addEventListener('wheel', e => {
      const p = C.coord(img, e.clientX, e.clientY);
      if (p) { C.enviar({ t: 'scroll', x: p.x, y: p.y, dy: e.deltaY, n: 3 }); e.preventDefault(); }
    }, { passive: false });
  };

  /* ------------------------------------------------------------------
     TELA CHEIA + ORIENTACAO
     Usar Studio/Blender no celular com a barra do site comendo metade da
     tela nao da. Aqui: tela cheia de verdade e, quando a tela remota e
     deitada e o celular esta em pe, o aviso de girar (e a tentativa de
     travar em paisagem — so funciona dentro da tela cheia, e quando o
     aparelho deixa; quando nao deixa, a resposta diz isso).
     ------------------------------------------------------------------ */
  C.elTela = function () {
    return (C.vista && C.vista.caixa && C.vista.caixa.parentElement) ||
      (typeof document !== 'undefined' ? document.getElementById('dsr-tela') : null);
  };
  C.emTelaCheia = function () {
    if (typeof document === 'undefined') return false;
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  };
  C.telaCheia = async function (el) {
    const alvo = el || C.elTela();
    if (!alvo) return { ok: false, erro: 'sem area de tela' };
    try {
      if (C.emTelaCheia()) {
        const saida = (typeof document.exitFullscreen === 'function') ? document.exitFullscreen()
          : (document.webkitExitFullscreen ? document.webkitExitFullscreen() : null);
        if (saida && saida.then) await saida;
        if (C.recalcular) C.recalcular();
        return { ok: true, cheio: false };
      }
      const ped = alvo.requestFullscreen ? alvo.requestFullscreen({ navigationUI: 'hide' })
        : (alvo.webkitRequestFullscreen ? alvo.webkitRequestFullscreen() : null);
      if (!ped) return { ok: false, erro: 'este navegador nao deixa a pagina entrar em tela cheia' };
      if (ped.then) await ped;
      if (C.recalcular) setTimeout(C.recalcular, 120);
      return { ok: true, cheio: true };
    } catch (e) {
      return { ok: false, erro: 'o navegador recusou a tela cheia: ' + ((e && e.message) || e) };
    }
  };

  C.orientacao = function () {
    if (typeof window === 'undefined') return 'paisagem';
    let retrato;
    if (window.screen && window.screen.orientation && window.screen.orientation.type)
      retrato = /portrait/i.test(window.screen.orientation.type);
    else retrato = (window.innerHeight || 0) > (window.innerWidth || 0);
    return retrato ? 'retrato' : 'paisagem';
  };

  /* a tela remota e deitada e o aparelho esta em pe? entao rende girar */
  C.precisaGirar = function () {
    const img = C.vista && C.vista.img;
    if (!img || !img.naturalWidth || !img.naturalHeight) return false;
    const remotoDeitado = img.naturalWidth > img.naturalHeight * 1.15;
    return remotoDeitado && C.orientacao() === 'retrato';
  };

  C.travarPaisagem = async function () {
    try {
      if (!C.emTelaCheia())
        return { ok: false, erro: 'a trava de orientacao so vale em tela cheia (entre em tela cheia primeiro)' };
      if (typeof screen === 'undefined' || !screen.orientation || !screen.orientation.lock)
        return { ok: false, erro: 'este aparelho/navegador nao permite travar a orientacao' };
      await screen.orientation.lock('landscape');
      return { ok: true };
    } catch (e) {
      return { ok: false, erro: 'o aparelho nao deixou travar em paisagem: ' + ((e && e.message) || e) };
    }
  };

  C.teclado = function (el) {
    if (!el || el._dsosTec) return; el._dsosTec = true;
    const mapa = { Enter: 'Return', Backspace: 'BackSpace', Escape: 'Escape', Tab: 'Tab',
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Delete: 'Delete' };
    el.addEventListener('keydown', e => {
      if (mapa[e.key]) { C.enviar({ t: 'tecla', v: mapa[e.key] }); e.preventDefault(); return; }
      if (e.ctrlKey && /^[a-z]$/.test(e.key)) { C.enviar({ t: 'tecla', v: 'ctrl+' + e.key }); e.preventDefault(); return; }
      if (e.key.length === 1) { C.enviar({ t: 'texto', v: e.key }); e.preventDefault(); }
    });
  };

  C.texto = t => C.enviar({ t: 'texto', v: t });
  C.tecla = k => C.enviar({ t: 'tecla', v: k });

  /* resumo honesto do hardware: so o que o backend reportou */
  C.resumoHw = function () {
    const h = C.hw; if (!h) return 'nao conectado';
    const p = [];
    if (h.cpu) p.push(h.cpu.replace(/\(R\)|\(TM\)|CPU|Processor/g, '').trim() + ' x' + (h.cpu_cores || '?'));
    if (h.ram_gb) p.push(h.ram_gb + ' GB RAM');
    p.push(h.gpu ? (h.gpu + (h.vram_mb ? ' ' + (h.vram_mb / 1024).toFixed(0) + ' GB' : '')) : 'sem GPU');
    if (h.disco_livre_gb) p.push(h.disco_livre_gb + ' GB livres');
    return p.join(' · ');
  };

  window.DsC = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})();
