/* ============================================================
   REALTIME — WebSocket com queda automatica pro polling.

   Por que isso existe (e o que isso NAO e):
   - /frame e /job sao HTTP de uma foto por vez. Polling soma a
     latencia do intervalo (900ms no terminal, 2s nos frames) e
     reabre conexao toda vez.
   - WebSocket: o no empurra os quadros/linhas NA HORA. Medido aqui:
     5 comandos = 33ms no WS contra ~5 idas e voltas HTTP.
   - WebRTC (tipo rtc.io) daria menos overhead ainda, mas precisa de
     um servidor de sinalizacao SEMPRE ligado — e os nossos nos caem
     a cada 6h (Actions) / 9-12h (Kaggle). Sem essa peca, WebRTC nao
     fica melhor; por isso aqui e WS (que o proprio navegador ja tem).

   Tudo aqui cai sozinho pro caminho antigo (HTTP) se:
     - o navegador nao tiver WebSocket (ou ele falhar),
     - o no for um agente antigo sem /ws,
     - a conexao cair (tenta 1 vez voltar pro WS depois de 15s).
   ============================================================ */
'use strict';
(function () {
  const RT = {};

  RT.aberto = function () {
    return (typeof window !== 'undefined') && typeof window.WebSocket === 'function';
  };

  function wsUrl(base, canal, extra) {
    const u = String(base || '').replace(/\/+$/, '');
    const q = Object.assign({ canal }, extra || {});
    const qs = Object.keys(q).filter(k => q[k] !== undefined && q[k] !== null)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
    return u.replace(/^http/, 'ws') + '/ws?' + qs;
  }

  /* ---------- 1) FRAMES (tela ao vivo) ----------
     onQuadro({img, modo}) recebe o JPEG pronto pra <img src>.
     devolve {parar(), ajustar({scale,q,fps}), modo} */
  RT.frames = function (base, opts, onQuadro, onAviso) {
    const o = Object.assign({ scale: 0.5, q: 55, fps: 8 }, opts || {});
    const aviso = onAviso || function () {};
    let sock = null, parado = false, modo = 'ws', tentouHttp = false, timerHttp = null, avisouErro = '';
    const baseLimpa = String(base || '').replace(/\/+$/, '');

    function parar() {
      parado = true;
      if (sock) { try { sock.close(); } catch (e) {} sock = null; }
      if (timerHttp) { clearInterval(timerHttp); timerHttp = null; }
    }

    /* caminho antigo: GET /frame a cada intervalo (uma foto por vez) */
    function comecarHttp(motivo) {
      if (parado || tentouHttp) return;
      tentouHttp = true; modo = 'http';
      aviso('sem websocket (' + motivo + ') — caiu pro modo foto a foto');
      const intervalo = Math.max(120, 1000 / Math.max(1, o.fps));
      let ocupado = false, erros = 0;
      timerHttp = setInterval(async () => {
        if (parado || ocupado) return;
        ocupado = true;
        try {
          const r = await fetch(baseLimpa + '/frame?q=' + o.q + '&s=' + o.scale);
          const d = await r.json();
          if (d && d.img) { onQuadro(d); erros = 0; }
          else if (d && d.err && erros++ === 0) aviso(d.err);
        } catch (e) { if (erros++ === 0) aviso('no fora do ar? ' + (e.message || e)); }
        ocupado = false;
      }, intervalo);
    }

    if (!RT.aberto()) { comecarHttp('navegador sem WebSocket'); return { parar, ajustar() {}, get modo() { return modo; } }; }

    try {
      sock = new WebSocket(wsUrl(base, 'frames', { scale: o.scale, q: o.q, fps: o.fps }));
      sock.binaryType = 'arraybuffer';
      sock.onmessage = ev => {
        const d = ev.data;
        if (typeof d === 'string') {
          let m = null;
          try { m = JSON.parse(d); } catch (e) {}
          // o no esta vivo, so nao consegue capturar: avisa UMA vez e fica tentando
          if (m && m.t === 'erro' && m.v !== avisouErro) { avisouErro = m.v; aviso(m.v); }
          return;
        }
        const dados = d instanceof ArrayBuffer ? d : (d && d.buffer ? d.buffer : null);
        if (!dados || dados.byteLength < 100) return;
        const bytes = new Uint8Array(dados);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        onQuadro({ img: 'data:image/jpeg;base64,' + btoa(bin), modo: 'ws' });
      };
      sock.onclose = () => { if (!parado && !avisouErro && modo === 'ws') comecarHttp('conexao fechada'); };
      sock.onerror = () => {};
    } catch (e) { comecarHttp(e.message || 'erro no websocket'); }

    return {
      parar,
      get modo() { return modo; },
      ajustar(a) {
        Object.assign(o, a || {});
        if (sock && sock.readyState === 1) { try { sock.send(JSON.stringify(a || {})); } catch (e) {} }
      },
    };
  };

  /* ---------- 2) JOB (saida de comando ao vivo) ----------
     Se o WS cair antes do fim, continua por polling de onde parou. */
  RT.job = async function (base, id, onLinha, onFim, onAviso) {
    const aviso = onAviso || function () {};
    const parado = { v: false };
    const baseLimpa = String(base || '').replace(/\/+$/, '');
    const ctrl = {
      parar() { parado.v = true; if (ctrl.sock) { try { ctrl.sock.close(); } catch (e) {} } },
    };

    async function porHttp(desde) {
      let from = desde || 0, tique = 0;
      for (;;) {
        if (parado.v) return -3;
        await new Promise(r => setTimeout(r, 900));
        try {
          const q = await (await fetch(baseLimpa + '/job?id=' + id + '&from=' + from)).json();
          if (!q.ok) return -1;
          (q.lines || []).forEach(onLinha);
          from = q.next;
          if (q.done) return q.code;
        } catch (e) { /* segue tentando */ }
        if (++tique > 4000) return -2;
      }
    }

    if (RT.aberto()) {
      let entregues = 0, finalizado = null;
      await new Promise(resolve => {
        try {
          const s = new WebSocket(wsUrl(base, 'job', { id }));
          ctrl.sock = s;
          s.onmessage = ev => {
            let m = null;
            try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m.t === 'linha') { entregues++; onLinha(m.v); }
            else if (m.t === 'fim') { finalizado = (m.v && m.v.code !== undefined) ? m.v.code : 0;
              onFim(finalizado, m.v && m.v.meta); resolve(); }
            else if (m.t === 'erro') { finalizado = -1; aviso(m.v); onFim(-1); resolve(); }
          };
          s.onerror = () => {};
          s.onclose = () => resolve();
        } catch (e) { resolve(); }
      });
      if (finalizado !== null) return ctrl;
      aviso('websocket caiu no meio — continuando por polling');
      const codigo = await porHttp(entregues);
      onFim(codigo);
      return ctrl;
    }

    aviso('navegador sem WebSocket — modo polling');
    onFim(await porHttp(0));
    return ctrl;
  };

  /* ---------- 3) CMD (terminal instantaneo) ----------
     Um socket, varios comandos: sem reabrir conexao a cada comando. */
  RT.terminal = function (base) {
    const T = { sock: null, fila: [], pronto: false, modo: 'http', _espera: [] };
    const baseLimpa = String(base || '').replace(/\/+$/, '');
    let tentou = false;

    T.ligar = function () {
      if (T.sock || !RT.aberto() || tentou) return T.sock;
      tentou = true;
      try {
        const s = new WebSocket(wsUrl(base, 'cmd'));
        T.sock = s;
        s.onopen = () => { T.pronto = true; T.modo = 'ws'; T._espera.splice(0).forEach(f => f(true)); };
        s.onmessage = ev => {
          let m = null;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          const espera = T.fila.shift();
          if (espera) espera(m);
        };
        s.onclose = () => { T.pronto = false; T._espera.splice(0).forEach(f => f(false)); };
        s.onerror = () => { T.pronto = false; };
      } catch (e) { T.sock = null; }
      return T.sock;
    };

    function aberto() {
      return new Promise(res => {
        if (T.pronto && T.sock && T.sock.readyState === 1) return res(true);
        const s = T.ligar();
        if (!s) return res(false);
        if (s.readyState === 1) return res(true);
        T._espera.push(res);
        setTimeout(() => res(false), 4000);
      });
    }

    T.rodar = async function (cmd, timeout) {
      if (!await aberto()) {
        // nao tem WS: quem chamou decide (a ui cai pro /exec)
        throw new Error('sem ws');
      }
      return new Promise((resolve, reject) => {
        T.fila.push(resolve);
        try { T.sock.send(JSON.stringify({ cmd, timeout: timeout || 600 })); }
        catch (e) { T.fila.pop(); reject(e); }
      });
    };
    T.fechar = function () { if (T.sock) { try { T.sock.close(); } catch (e) {} T.sock = null; } };
    return T;
  };

  /* ---------- 4) ENTRADA (mouse/teclado do DsOS) ----------
     Pelo WS o evento vai na hora, sem um POST por clique. Cai pro POST
     (lote de 12) se o WS nao existir. */
  RT.entrada = function (base, onAviso, onResultado) {
    const aviso = onAviso || function () {};
    const baseLimpa = String(base || '').replace(/\/+$/, '');
    const E = { modo: 'http', sock: null, fila: [], timer: null, parar() {} };
    let tentou = false, espera = [];

    function ligar() {
      if (E.sock || !RT.aberto() || tentou) return E.sock;
      tentou = true;
      try {
        const s = new WebSocket(wsUrl(base, 'input'));
        E.sock = s;
        s.onopen = () => { E.modo = 'ws'; espera.splice(0).forEach(f => f(true)); };
        s.onmessage = ev => {
          let m = null;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (onResultado) onResultado(m);
        };
        s.onclose = () => { E.sock = null; };
        s.onerror = () => {};
      } catch (e) { E.sock = null; }
      return E.sock;
    }

    function pronto() {
      return new Promise(res => {
        if (E.sock && E.sock.readyState === 1) return res(true);
        const s = ligar();
        if (!s) return res(false);
        if (s.readyState === 1) return res(true);
        espera.push(res);
        setTimeout(() => res(false), 2000);
      });
    }

    /* escrita em lote: 1 envio a cada ~25ms, juntando o que chegou */
    async function escoar() {
      if (E.timer) return;
      E.timer = setTimeout(async () => {
        E.timer = null;
        const lote = E.fila.splice(0, E.fila.length);
        if (!lote.length) return;
        if (await pronto()) {
          try { E.sock.send(JSON.stringify({ eventos: lote })); return; }
          catch (e) { E.sock = null; }
        }
        // sem WS: POST em lotes de 12 (caminho antigo)
        aviso('sem websocket no DsOS — enviando por POST');
        for (let i = 0; i < lote.length; i += 12) {
          try {
            const r = await fetch(baseLimpa + '/input', { method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ eventos: lote.slice(i, i + 12) }) });
            if (onResultado) onResultado(await r.json());
          } catch (e) { /* nao trava a UI por um clique perdido */ }
        }
      }, 25);
    }

    E.enviar = function (ev) {
      if (ev && ev.t === 'move' && E.fila.length && E.fila[E.fila.length - 1].t === 'move') {
        E.fila[E.fila.length - 1] = ev;     // so o ultimo movimento importa
      } else {
        E.fila.push(ev);
      }
      if (E.fila.length > 60) E.fila.splice(0, E.fila.length - 60);
      escoar();
    };
    E.parar = function () { if (E.sock) { try { E.sock.close(); } catch (e) {} E.sock = null; } E.fila.length = 0; };
    ligar();
    return E;
  };

  if (typeof window !== 'undefined') window.RT = RT;
  if (typeof module !== 'undefined') module.exports = RT;
})();
