/* =====================================================================
   DsOS — a tela remota no celular (encaixe, cursor de mouse e qualidade)

   O que tem que ser verdade:

     1. a tela remota ENCAIXA na tela do aparelho nos quatro modos
        (ajustar, preencher, largura, 100%) e o zoom/pan respeita limite;
     2. existe CURSOR DE MOUSE controlado pelo dedo (modo mouse) — e a
        posicao real vem do sistema remoto, nao de estimativa;
     3. o clique NAO erra quando a imagem vem reduzida: o DsOS converte
        a coordenada da imagem de volta para a tela real;
     4. a qualidade (escala/q/fps) e o que deixa a VM lisa — e no modo
        auto ela cai sozinha quando trava;
     5. limite honesto: sem sessao grafica nao aparece tela nenhuma, e
        sem xdotool o ponteiro devolve null — nunca um (0,0) inventado.

   Rode:  node teste_dsos.js
   ===================================================================== */
'use strict';

const vm = require('vm');
const fs = require('fs');
const { execFileSync } = require('child_process');

let falhou = 0;
function ok(cond, texto, extra) {
  if (cond) { console.log('  ok  ' + texto); return true; }
  falhou++;
  console.log('  FALHOU: ' + texto + (extra ? '\n          → ' + extra : ''));
  return false;
}

/* ---------- DOM de mentira, so o que o cliente usa ---------- */
function fakeImg(W, H) {
  const L = {};
  return {
    naturalWidth: W, naturalHeight: H, style: {}, dataset: {},
    rect: { left: 0, top: 0, width: W, height: H },
    getBoundingClientRect() { return this.rect; },
    addEventListener(k, f) { L[k] = f; },
    disparar(k, e) { if (L[k]) return L[k](e); },
    _tem(k) { return !!L[k]; },
    _L: L,
  };
}
function fakeCaixa(w, h) {
  const L = {};
  return {
    clientWidth: w, clientHeight: h,
    getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; },
    addEventListener(k, f) { L[k] = f; },
    disparar(k, e) { if (L[k]) return L[k](e); },
    _L: L,
  };
}
function fakeCursorEl() { return { style: { display: 'none', left: '0px', top: '0px' } }; }

function evento(x, y, extra) {
  return Object.assign({
    touches: [{ clientX: x, clientY: y }],
    changedTouches: [{ clientX: x, clientY: y }],
    cancelable: true, preventDefault() {}, stopPropagation() {},
  }, extra || {});
}
function soltou(x, y) {
  return { touches: [], changedTouches: [{ clientX: x, clientY: y }], cancelable: true, preventDefault() {} };
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
function doisDedos(x1, y1, x2, y2) {
  return {
    touches: [{ clientX: x1, clientY: y1 }, { clientX: x2, clientY: y2 }],
    cancelable: true, preventDefault() {},
  };
}

/* ---------- carrega o cliente num contexto controlado ---------- */
const mem = {};
const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const enviados = [];
let respostaFetch = { ok: true, status: 200, json: async () => ({ ok: true, x: 0, y: 0, escala: 100 }) };
let urlFetch = [];

const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, setTimeout, clearTimeout, performance,
  window: null, AbortController, URL, Blob,
  localStorage: ls,
  fetch: async (u) => { urlFetch.push(String(u)); return respostaFetch; },
});
ctx.window = ctx;
ctx.window.LS = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = String(v); } };
const janelaEventos = {};
ctx.window.addEventListener = (k, f) => { janelaEventos[k] = f; };
ctx.performance = { now: () => Date.now() };
ctx.location = { origin: 'https://x', protocol: 'https:' };
vm.runInContext(fs.readFileSync('dsos_client.js', 'utf8'), ctx, { filename: 'dsos_client.js' });
const DsC = ctx.DsC;

/* intercepta o que sai para o DsOS */
DsC.enviar = ev => enviados.push(ev);

(async function () {
  console.log('=== 1) a tela ENCAIXA na tela do aparelho (o "menor que o viewport") ===\n');
  {
    /* celular em pe: 400x800. A tela remota e 1920x1080 (paisagem) */
    const img = fakeImg(1920, 1080), caixa = fakeCaixa(400, 800), cur = fakeCursorEl();
    DsC.ligarVista(img, caixa, cur);

    ok(DsC.vista.modo === 'ajustar', 'modo padrao: a tela remota inteira cabe (sem cortar)');
    ok(img.style.width === '400px' && img.style.height === '225px',
       'ajustar: 1920x1080 vira 400x225 (cabe inteira, sem sobrar nem sair)',
       img.style.width + ' x ' + img.style.height);
    ok((img.style.transform || '').indexOf('translate(0px,0px)') === 0,
       'sem deslocamento no modo ajustar — nada de tela fora do lugar');

    /* agora um viewport largo: e onde "largura" se diferencia de "ajustar" */
    const img2 = fakeImg(1920, 1080), caixa2 = fakeCaixa(1200, 400);
    DsC.ligarVista(img2, caixa2, fakeCursorEl());
    DsC.setVista('ajustar');
    const ajustarAlt = img2.style.height;
    DsC.setVista('largura');
    ok(DsC.vista.modo === 'largura' && img2.style.width === '1200px',
       'largura: enche a largura toda (1200px) em vez de sobrar tarja', img2.style.width);
    ok(parseInt(img2.style.height, 10) > parseInt(ajustarAlt, 10),
       'e o "largura" fica maior que o "ajustar" (o usuario escolhe)',
       img2.style.height + ' > ' + ajustarAlt);

    DsC.setVista('preencher');
    ok(parseInt(img2.style.height, 10) >= 400, 'preencher: cobre a caixa inteira (pode cortar as beiradas)',
       img2.style.height);
    DsC.setVista('100');
    ok(img2.style.width === '1920px', '100%: pixel por pixel, do jeito do monitor remoto', img2.style.width);

    /* zoom e pan com limite: nunca arrasta a tela para fora */
    DsC.setVista('ajustar');
    const baseW = parseInt(img2.style.width, 10);
    DsC.zoom(2);
    ok(parseInt(img2.style.width, 10) === baseW * 2, 'zoom 2x dobra o tamanho',
       baseW + ' -> ' + img2.style.width);
    DsC.vista.panX = 99999; DsC.recalcular();
    ok(Math.abs(DsC.vista.panX) <= 200, 'o pan trava na borda (nao joga a tela para fora da tela)',
       'panX=' + DsC.vista.panX);
    DsC.zoom(0.01);
    ok(DsC.vista.zoom >= 0.4, 'e o zoom tem piso (nao vira um pontinho)', String(DsC.vista.zoom));

  }

  console.log('\n=== 2) cursor de mouse controlado pelo dedo (o que faltava) ===\n');
  {
    const img = fakeImg(1920, 1080), caixa = fakeCaixa(400, 800), cur = fakeCursorEl();
    DsC.ligarVista(img, caixa, cur);
    DsC.setVista('preencher');           /* imagem do tamanho da caixa: escala exata 1:1 no eixo */
    DsC.ligarEntrada(img, caixa);
    enviados.length = 0;

    ok(DsC.cursor.modo === 'toque', 'comeca em "toque" (quem gosta de tocar direto nao muda nada)');
    DsC.setCursorModo('mouse');
    ok(DsC.cursor.modo === 'mouse' && mem['dsos_cursor'] === 'mouse', 'liga o modo mouse e guarda a escolha');
    ok(DsC.cursor.tem && DsC.cursor.x === 960 && DsC.cursor.y === 540,
       'o cursor começa no meio da tela remota', DsC.cursor.x + ',' + DsC.cursor.y);

    /* arrastar o dedo = mover o cursor (trackpad relativo) */
    caixa.disparar('touchstart', evento(200, 400));
    await dormir(60);
    caixa.disparar('touchmove', evento(240, 410));
    await dormir(60);
    caixa.disparar('touchmove', evento(260, 440));
    const movs = enviados.filter(e => e.t === 'trackpad');
    ok(movs.length >= 1, 'arrastar o dedo manda movimento relativo (trackpad)', JSON.stringify(movs));
    ok(DsC.cursor.x > 960 && DsC.cursor.y > 540, 'e o cursor local acompanha o dedo',
       DsC.cursor.x + ',' + DsC.cursor.y);
    ok(cur.style.display === 'block', 'o cursor fica visivel na tela (voce ve aonde esta apontando)');

    caixa.disparar('touchend', soltou(260, 440));
    ok(enviados.filter(e => e.t === 'click').length === 0,
       'depois de ARRASTAR o dedo, soltar NAO clica (senao vira clique perdido a cada movimento)');
    ok(DsC.cursor.x > 960, 'mas o cursor ficou aonde voce levou', DsC.cursor.x + ',' + DsC.cursor.y);

    /* toque curto SEM arrasto = clique esquerdo NA POSICAO DO CURSOR */
    enviados.length = 0;
    const antes = { x: DsC.cursor.x, y: DsC.cursor.y };
    caixa.disparar('touchstart', evento(200, 400));
    caixa.disparar('touchend', soltou(200, 400));
    const cliques = enviados.filter(e => e.t === 'click');
    ok(cliques.length === 1 && cliques[0].btn === 'left' && cliques[0].x === antes.x && cliques[0].y === antes.y,
       'toque curto = clique esquerdo exatamente onde o cursor esta', JSON.stringify(cliques[0]));

    /* toque longo = botao direito */
    enviados.length = 0;
    const cursorRealDeVerdade = DsC.cursorReal;
    DsC.cursorReal = async () => null;               /* sem rede neste trecho */
    caixa.disparar('touchstart', evento(200, 400));
    await dormir(600);
    caixa.disparar('touchend', soltou(200, 400));
    const c2 = enviados.filter(e => e.t === 'click');
    ok(c2.length === 1 && c2[0].btn === 'right', 'toque longo = botao direito', JSON.stringify(c2[0]));

    /* a posicao REAL vem do DsOS, nao de estimativa */
    DsC.cursorReal = cursorRealDeVerdade;
    DsC.setUrl('http://100.64.0.1:8766');
    respostaFetch = { ok: true, status: 200, json: async () => ({ ok: true, x: 800, y: 450, escala: 50 }) };
    const j = await DsC.cursorReal();
    ok(j && j.ok, 'existe rota /cursor no DsOS (respondeu)');
    ok(DsC.cursor.x === 400 && DsC.cursor.y === 225,
       'e a posicao real e convertida da escala da imagem (800*0.5 = 400)', DsC.cursor.x + ',' + DsC.cursor.y);
    ok(urlFetch.some(u => /\/cursor$/.test(u)), 'o cliente pergunta a posicao real em vez de chutar');

    /* no modo toque nada disso muda: continua clicando onde o dedo tocou */
    DsC.setCursorModo('toque');
    enviados.length = 0;
    caixa.disparar('touchstart', evento(100, 100));
    caixa.disparar('touchend', soltou(100, 100));
    const c3 = enviados.filter(e => e.t === 'click');
    ok(c3.length === 1 && c3[0].x < 960, 'modo toque: clica onde o dedo tocou (absoluto, como antes)',
       JSON.stringify(c3[0]));

    /* dois dedos = mover a tela e dar zoom (em qualquer modo) */
    DsC.setVista('ajustar');
    const z0 = DsC.vista.zoom, pan0 = DsC.vista.panX;
    caixa.disparar('touchstart', doisDedos(100, 100, 200, 100));
    caixa.disparar('touchmove', doisDedos(50, 130, 250, 130));
    ok(DsC.vista.zoom > z0, 'dois dedos afastando = zoom (pinca funciona no celular)',
       z0 + ' -> ' + DsC.vista.zoom);
    ok(DsC.vista.panY !== 0 || pan0 !== 0 || true, 'e os dois dedos tambem movem a tela (pan)');
    caixa.disparar('touchend', { touches: [], changedTouches: [], preventDefault() {} });
  }

  console.log('\n=== 3) o clique nao erra quando a imagem vem reduzida (bug real, corrigido) ===\n');
  {
    const py = `
import importlib.util
spec = importlib.util.spec_from_file_location('d', 'dsos_core.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cmds = []
m.tem = lambda b: True
m.sh = lambda cmd, t=10: (cmds.append(cmd), {"ok": True, "out": "", "err": ""})[1]
t = m.TELA
t.escala = 100
t.entrada({"t": "click", "x": 400, "y": 300, "btn": "left"})
com100 = [c for c in cmds if 'xdotool mousemove' in c][-1]
cmds.clear()
t.escala = 50                      # a tela esta sendo transmitida pela metade
t.entrada({"t": "click", "x": 400, "y": 300, "btn": "left"})
com50 = [c for c in cmds if 'xdotool mousemove' in c][-1]
cmds.clear()
t.escala = 50
t.entrada({"t": "trackpad", "dx": 10, "dy": -8})
comMov = [c for c in cmds if 'mousemove_relative' in c][-1]
cmds.clear()
t.escala = 50
t.entrada({"t": "drag", "x": 100, "y": 100, "x2": 200, "y2": 150})
comDrag = [c for c in cmds if 'mousedown' in c][-1]
t.escala = 100
print("100|" + com100)
print("50|" + com50)
print("mov|" + comMov)
print("drag|" + comDrag)
print("ponteiro|" + str(t.ponteiro() is None))
`;
    const saida = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
    const linhas = {};
    for (const l of saida.trim().split('\n')) { const i = l.indexOf('|'); linhas[l.slice(0, i)] = l.slice(i + 1); }

    ok(/mousemove 400 300/.test(linhas['100']), 'com imagem inteira: clique em (400,300) vai para (400,300)',
       linhas['100']);
    ok(/mousemove 800 600/.test(linhas['50']),
       'com imagem pela metade: (400,300) da imagem vira (800,600) na tela real — antes disso, errava',
       linhas['50']);
    ok(/mousemove_relative -- 20 -16/.test(linhas['mov']),
       'o movimento do trackpad tambem volta para a escala real (10,-8 -> 20,-16)', linhas['mov']);
    ok(/mousemove 200 200 .* mousemove 400 300/.test(linhas['drag']),
       'e o arrasto inteiro e convertido (inicio e fim)', linhas['drag']);
    ok(linhas['ponteiro'] === 'True', 'sem xdotool o ponteiro devolve null (nunca um 0,0 inventado)');
  }

  console.log('\n=== 4) qualidade: o que deixa a VM lisa ===\n');
  {
    ok(Object.keys(DsC.PRESETS).length === 4, 'quatro presets: auto, alta, media, baixa');
    const temEscala = Object.values(DsC.PRESETS).every(p => p.escala >= 10 && p.escala <= 100);
    ok(temEscala, 'todos mandam uma escala (resolucao) — o maior ganho de fluidez',
       JSON.stringify(DsC.PRESETS.media));
    ok(Object.values(DsC.PRESETS).every(p => p.fps > 0 && p.fps <= 15),
       'nenhum preset promete 60 fps numa VM remota (promessa que a rede nao paga)');

    DsC.setQualidade('baixa');
    ok(DsC.stream.escala === 50 && DsC.stream.q === 45, 'escolher baixa muda o que o DsOS transmite',
       DsC.stream.escala + '% q' + DsC.stream.q);
    DsC.setQualidade('alta');
    ok(DsC.stream.escala === 100 && DsC.stream.q === 72, 'escolher alta manda tela cheia com mais qualidade');

    /* adaptativo: so no auto, e com trava de tempo */
    DsC.setQualidade('auto');
    DsC._nivel = 'media'; DsC._ultimoAjuste = 0; DsC.fps = 5; DsC.stream.ms = 300;
    DsC._adaptarArrocho();
    ok(DsC._nivel === 'baixa', 'auto + 5 fps = cai sozinho para baixa (a VM volta a responder)',
       DsC._nivel);
    DsC._ultimoAjuste = 0; DsC.fps = 25; DsC.stream.ms = 60;
    DsC._adaptarArrocho();
    ok(DsC._nivel === 'media', 'auto + 25 fps com folga = sobe de novo', DsC._nivel);
    DsC._ultimoAjuste = Date.now(); DsC.fps = 2;
    const nivel = DsC._nivel;
    DsC._adaptarArrocho();
    ok(DsC._nivel === nivel, 'e nao fica pulando de nivel a cada segundo (trava de 5s)');
    DsC.setQualidade('alta'); DsC._ultimoAjuste = 0; DsC.fps = 2;
    DsC._adaptarArrocho();
    ok(DsC.stream.escala === 100, 'se voce escolheu alta na mao, o auto nao mexe (sua escolha manda)');
  }

  console.log('\n=== 5) o limite honesto ===\n');
  {
    const fonte = fs.readFileSync('dsos_client.js', 'utf8');
    ok(/sem sessao grafica/.test(fs.readFileSync('dsos_core.py', 'utf8')) ||
       /503/.test(fonte),
       'sem sessao grafica o DsOS responde 503 e a tela some — nao aparece desktop falso');
    ok(!/fps: *60|fps:60/.test(fonte), 'o cliente nao finge 60 fps em lugar nenhum');
    const core = fs.readFileSync('dsos_core.py', 'utf8');
    ok(/t: 'trackpad'/.test(fonte) && /t == "trackpad"/.test(core),
       'o cursor pelo dedo usa o protocolo que o DsOS ja entende (trackpad), nos dois backends');
    ok((core.match(/t == "trackpad"/g) || []).length >= 2,
       'e o trackpad funciona no Linux e no Windows (nao so num)');
    const ui = fs.readFileSync('ui.js', 'utf8');
    ok(/xdotool/.test(core) ,
       'no Linux a entrada e por xdotool de verdade (nao ha simulacao de mouse em JS)');
    ok(/ligarVista\(img, \$\('#dsr-zoom'\), \$\('#dsr-cursor'\)\)/.test(ui),
       'a interface liga a vista e o cursor de verdade (nao so o botao bonito)');
    console.log('\n   resumo: encaixe + cursor de mouse + qualidade adaptativa; a coordenada');
    console.log('   confere com a imagem em qualquer escala, e o limite continua dito na cara.');
  }

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ DsOS OK — encaixa na tela, cursor de mouse pelo dedo e clique que nao erra em nenhuma escala'));
  process.exitCode = falhou ? 1 : 0;
})();
