/* =====================================================================
   CELULAR — tela cheia, aviso de girar e barra na altura do polegar

   O que tem que ser verdade:

     1. tela cheia entra e sai de verdade (e quando o navegador recusa,
        diz o motivo em vez de nao fazer nada);
     2. o site sabe a orientacao do aparelho e avisa quando a tela remota
        e deitada e o celular esta em pe ("gire o celular");
     3. travar em paisagem so e tentado em tela cheia, e quando o aparelho
        nao deixa, a resposta diz isso — nao finge que travou;
     4. no celular a barra de abas vai para baixo (o dedo alcanca) e o
        conteudo ganha espaco para ela;
     5. limite honesto: nada disso melhora a imagem — tela cheia tira a
        barra do caminho, so isso.

   Rode:  node teste_celular.js
   ===================================================================== */
'use strict';

const vm = require('vm');
const fs = require('fs');

let falhou = 0;
function ok(cond, texto, extra) {
  if (cond) { console.log('  ok  ' + texto); return true; }
  falhou++;
  console.log('  FALHOU: ' + texto + (extra ? '\n          → ' + extra : ''));
  return false;
}

/* ---------- tela e aparelho de mentira ---------- */
const docEventos = {};
const janelaEventos = {};
const telaEl = {
  id: 'dsr-tela',
  pedidos: 0,
  requestFullscreen: null,          /* cada teste troca */
};
const documento = {
  fullscreenElement: null,
  exitFullscreen: async function () { documento.fullscreenElement = null; },
  addEventListener: (k, f) => { docEventos[k] = f; },
  getElementById: id => (id === 'dsr-tela' ? telaEl : null),
};
let travaDeOrientacao = null;       /* o que o aparelho responde ao lock */
const aparelho = {
  orientation: {
    type: 'portrait-primary',
    lock: async function (o) {
      if (travaDeOrientacao === 'erro') throw new Error('aparelho nao permite');
      if (travaDeOrientacao === 'nao-existe') throw new Error('nao suportado');
      aparelho.orientation.type = o + '-primary';
      return true;
    },
  },
};

const mem = {};
const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, setTimeout, clearTimeout, performance,
  AbortController, URL, Blob,
  document: documento, screen: aparelho,
  localStorage: ls,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
});
ctx.window = ctx;
ctx.window.innerWidth = 400; ctx.window.innerHeight = 800;
ctx.window.document = documento;
ctx.window.screen = aparelho;
ctx.window.addEventListener = (k, f) => { janelaEventos[k] = f; };
ctx.window.LS = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = String(v); } };
ctx.performance = { now: () => Date.now() };
ctx.location = { origin: 'https://x', protocol: 'https:' };
vm.runInContext(fs.readFileSync('dsos_client.js', 'utf8'), ctx, { filename: 'dsos_client.js' });
const DsC = ctx.DsC;

function img(W, H) {
  return {
    naturalWidth: W, naturalHeight: H, style: {},
    getBoundingClientRect() { return { left: 0, top: 0, width: W, height: H }; },
    addEventListener() {}, parentElement: null,
  };
}

(async function () {
  console.log('=== 1) tela cheia: entra, sai e, se recusarem, diz o motivo ===\n');
  {
    telaEl.requestFullscreen = function () {
      telaEl.pedidos++;
      documento.fullscreenElement = telaEl;
      return Promise.resolve();
    };
    const r1 = await DsC.telaCheia(telaEl);
    ok(r1.ok === true && r1.cheio === true, 'entrou em tela cheia');
    ok(DsC.emTelaCheia() === true, 'e o site sabe que está em tela cheia');
    const r2 = await DsC.telaCheia(telaEl);
    ok(r2.ok === true && r2.cheio === false, 'chamar de novo sai da tela cheia');
    ok(DsC.emTelaCheia() === false, 'e volta ao normal');

    /* navegador que recusa */
    telaEl.requestFullscreen = function () { return Promise.reject(new Error('permissao negada')); };
    const r3 = await DsC.telaCheia(telaEl);
    ok(r3.ok === false && /permissao negada/.test(r3.erro), 'quando o navegador recusa, o motivo aparece', r3.erro);

    /* navegador antigo, sem a função */
    telaEl.requestFullscreen = null;
    const r4 = await DsC.telaCheia(telaEl);
    ok(r4.ok === false && /nao deixa|não deixa/.test(r4.erro), 'sem suporte, explica em vez de travar', r4.erro);

    /* a área da tela é achada sozinha quando não se passa nada */
    telaEl.requestFullscreen = function () { documento.fullscreenElement = telaEl; return Promise.resolve(); };
    const imgFake = img(1920, 1080), caixaFake = { clientWidth: 400, clientHeight: 225, parentElement: telaEl,
      getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 225 }; }, addEventListener() {} };
    DsC.ligarVista(imgFake, caixaFake, null);
    const r5 = await DsC.telaCheia();
    ok(r5.ok === true, 'sem dizer qual área, ele usa a área da tela remota');
    documento.fullscreenElement = null;
  }

  console.log('\n=== 2) orientação e o aviso de girar ===\n');
  {
    aparelho.orientation.type = 'portrait-primary';
    ctx.window.innerWidth = 400; ctx.window.innerHeight = 800;
    ok(DsC.orientacao() === 'retrato', 'com o aparelho em pé: retrato');

    aparelho.orientation.type = 'landscape-primary';
    ok(DsC.orientacao() === 'paisagem', 'deitado: paisagem');

    /* aparelho sem a API nova: cai no tamanho da janela */
    const guarda = aparelho.orientation;
    aparelho.orientation = undefined;
    ctx.window.innerWidth = 400; ctx.window.innerHeight = 800;
    ok(DsC.orientacao() === 'retrato', 'aparelho antigo: decide pelo tamanho da janela');
    ctx.window.innerWidth = 900; ctx.window.innerHeight = 400;
    ok(DsC.orientacao() === 'paisagem', 'e deitado também');
    aparelho.orientation = guarda;

    /* o aviso: tela remota deitada + celular em pé = rende girar */
    DsC.vista.img = img(1920, 1080);
    aparelho.orientation.type = 'portrait-primary';
    ok(DsC.precisaGirar() === true, 'tela remota deitada + celular em pé: avisa para girar');
    aparelho.orientation.type = 'landscape-primary';
    ok(DsC.precisaGirar() === false, 'celular já deitado: não enche o saco');
    aparelho.orientation.type = 'portrait-primary';
    DsC.vista.img = img(1080, 1920);
    ok(DsC.precisaGirar() === false, 'tela remota em pé (celular deitado serve): não avisa');
    DsC.vista.img = img(0, 0);
    ok(DsC.precisaGirar() === false, 'sem imagem ainda: não avisa nada');
    DsC.vista.img = img(1920, 1080);
  }

  console.log('\n=== 3) travar em paisagem: só em tela cheia, e sem fingir ===\n');
  {
    documento.fullscreenElement = null;
    const fora = await DsC.travarPaisagem();
    ok(fora.ok === false && /tela cheia/.test(fora.erro),
       'fora da tela cheia, explica que a trava só vale em tela cheia', fora.erro);

    documento.fullscreenElement = telaEl;
    travaDeOrientacao = 'ok';
    const okr = await DsC.travarPaisagem();
    ok(okr.ok === true && aparelho.orientation.type === 'landscape-primary', 'em tela cheia, travou em paisagem');

    travaDeOrientacao = 'erro';
    aparelho.orientation.type = 'portrait-primary';
    const erro = await DsC.travarPaisagem();
    ok(erro.ok === false && /nao deixou|não deixou/.test(erro.erro),
       'quando o aparelho não deixa, a resposta diz isso', erro.erro);

    const guarda2 = aparelho.orientation;
    aparelho.orientation = {};
    const semApi = await DsC.travarPaisagem();
    ok(semApi.ok === false && /nao permite|não permite/.test(semApi.erro),
       'aparelho sem a API: diz que não permite (não finge que travou)', semApi.erro);
    aparelho.orientation = guarda2;
    documento.fullscreenElement = null;
  }

  console.log('\n=== 4) no celular, a barra vai para o polegar ===\n');
  {
    const html = fs.readFileSync('index.html', 'utf8');
    const bloco = html.slice(html.indexOf('@media(max-width:760px)'));
    ok(/\.tabs\{position:fixed;left:0;right:0;bottom:0/.test(bloco),
       'no celular a barra de abas fica fixa embaixo (ao alcance do dedo)');
    ok(/\.tab\{padding:9px 11px/.test(bloco), 'e os alvos ficaram maiores para o dedo');
    ok(/main\{padding-bottom:54px\}/.test(bloco), 'e o conteúdo ganha espaço para não ficar sob a barra');
    ok(/id="dsr-girar"/.test(html), 'o aviso de girar existe na tela do DsOS');
    ok(/id="dsr-full"/.test(html), 'e existe o botão de tela cheia na barra');
    ok(/id="hud-tela"/.test(html) && /id="hud-mouse"/.test(html),
       'e dentro do HUD também (para não sair do HUD para nada)');
  }

  console.log('\n=== 5) a interface usa isso, e o limite é dito ===\n');
  {
    const ui = fs.readFileSync('ui.js', 'utf8');
    ok(/DsC\.telaCheia\(\)/.test(ui) && /#dsr-full/.test(ui), 'o botão Tela chama a tela cheia de verdade');
    ok(/DsC\.precisaGirar\(\)/.test(ui), 'o aviso de girar aparece quando precisa');
    ok(/DsC\.travarPaisagem\(\)/.test(ui), 'e o botão "deitar agora" tenta travar em paisagem');
    ok(/fullscreenchange/.test(ui), 'a interface acompanha a tela cheia (entrar/sair pelo botão ou pelo sistema)');
    ok(/orientationchange/.test(ui), 'e acompanha a rotação do aparelho');
    const fonte = fs.readFileSync('dsos_client.js', 'utf8');
    ok(/só funciona dentro da tela cheia|so vale em tela cheia/.test(fonte),
       'o arquivo diz que a trava de orientação só vale em tela cheia');
    ok(!/aumenta a qualidade|melhora a imagem/.test(fonte),
       'e não promete que tela cheia melhora a imagem — ela só tira a barra do caminho');
    console.log('\n   resumo: tela cheia de verdade, aviso de girar honesto e barra na altura do polegar.');
  }

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ CELULAR OK — tela cheia, aviso de girar e barra ao alcance do dedo'));
  process.exitCode = falhou ? 1 : 0;
})();
