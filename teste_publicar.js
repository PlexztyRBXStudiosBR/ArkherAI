/* =====================================================================
   PUBLICAR E TELEMETRIA — o jogo no ar, e o jogo VIVO

   O que tem que ser verdade:

     1. o telemetria.py SOBE e responde de verdade (não é maquete);
     2. os números do resumo são os que foram enviados (mortes por fase,
        sessões, minutos por sessão) — medidos, não estimados;
     3. as sugestões vêm COM o número que as sustenta, e com pouco dado
        elas dizem que é pouco dado (não inventam conclusão);
     4. identidade NUNCA é gravada: nome, e-mail, conversa e id do jogador
        são descartados nas duas pontas — e o arquivo em disco prova;
     5. limites seguram abuso: corpo grande, json torto, lote gigante,
        envios demais (429);
     6. o ARQUIVO é a verdade: derrubar e subir o servidor mantém os
        números (nada de memória que evapora);
     7. o publicador monta os pedidos certos (GitHub e Roblox Open Cloud),
        e quando falha diz o erro que a API devolveu — 401 é 401;
     8. o que ele não faz é dito: .rbxl é o Studio que salva; aqui só
        publica o arquivo.

   Rode:  node teste_publicar.js
   ===================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

let falhou = 0;
function ok(cond, texto, extra) {
  if (cond) { console.log('  ok  ' + texto); return true; }
  falhou++;
  console.log('  FALHOU: ' + texto + (extra ? '\n          → ' + extra : ''));
  return false;
}

const PORTA = 8791;
const BASE = 'http://127.0.0.1:' + PORTA;
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'tel_teste_'));
const JOGO = 'jogo-teste';
let srv = null;

function subir() {
  srv = spawn('python3', ['telemetria.py'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, { TELEMETRIA_PORT: String(PORTA), TELEMETRIA_ROOT: RAIZ }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', d => { const t = String(d); if (/Traceback|Error/.test(t)) console.log('   [py] ' + t.trim()); });
}

async function esperar(base, ms) {
  const fim = Date.now() + (ms || 8000);
  while (Date.now() < fim) {
    try {
      const r = await fetch(base + '/health');
      if (r.ok) return await r.json();
    } catch (e) { /* ainda subindo */ }
    await new Promise(s => setTimeout(s, 120));
  }
  return null;
}

async function parar() {
  if (!srv) return;
  const p = srv;
  p.kill('SIGTERM');
  await new Promise(s => p.once('exit', s) || setTimeout(s, 1500));
  srv = null;
}

/* o tempo dos eventos é em segundos (os.clock) — aqui eu monto SEGUNDOS
   com base no relógio, para os minutos por sessão darem números redondos */
const T0 = 1_000_000;
function ev(evento, dados, quem, quando) {
  return { t: T0 + (quando || 0), evento: evento, dados: dados || {}, quem: quem || undefined };
}

async function postar(corpo) {
  const r = await fetch(BASE + '/evento', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j: j };
}

(async function () {
  subir();
  const saude = await esperar(BASE, 10000);
  if (!saude) {
    ok(false, 'o telemetria.py subiu e respondeu /health', 'não subiu na porta ' + PORTA);
    console.log('\n❌ não deu para testar sem o servidor');
    process.exitCode = 1;
    return;
  }

  console.log('=== 1) o telemetria.py sobe e responde ===\n');
  ok(saude.ok === true && saude.servico === 'telemetria', 'GET /health respondeu: ' + JSON.stringify(saude));

  console.log('\n=== 2) os números do resumo são os que foram enviados ===\n');
  {
    /* jogo real: 3 vidas de sessão, mortes concentradas na fase 3,
       gente travando sempre no mesmo ponto, e gente saindo na fase 4 */
    const lote = [];
    for (let s = 1; s <= 9; s++) {
      lote.push(ev('entrou', {}, 'sessao' + s, 0));
      lote.push(ev('chegou', { fase: 1 }, 'sessao' + s, 1));
      lote.push(ev('chegou', { fase: 2 }, 'sessao' + s, 2));
      lote.push(ev('chegou', { fase: 3 }, 'sessao' + s, 3));
      lote.push(ev('morte', { fase: 3, x: 121, z: -44, causa: 'queda' }, 'sessao' + s, 4));
      lote.push(ev('morte', { fase: 3, x: 119, z: -41 }, 'sessao' + s, 5));
      lote.push(ev('morte', { fase: 3, x: 117, z: -46 }, 'sessao' + s, 6));
      lote.push(ev('travou', { fase: 3, x: 118, z: -40 }, 'sessao' + s, 7));
      lote.push(ev('morte', { fase: 2, x: 10, z: 10 }, 'sessao' + s, 8));
      lote.push(ev('chegou', { fase: 4 }, 'sessao' + s, 9));
      if (s > 1) lote.push(ev('saiu', { fase: 4 }, 'sessao' + s, 600));   /* 10 min de sessão */
      else lote.push(ev('saiu', { fase: 4 }, 'sessao' + s, 300));          /* 5 min */
    }
    const r = await postar({ jogo: JOGO, versao: 'v1', lote: lote });
    ok(r.status === 200 && r.j.ok === true && r.j.aceitos === lote.length,
       'aceitou o lote inteiro (' + lote.length + ' eventos)', JSON.stringify(r.j));

    const res = await (await fetch(BASE + '/resumo?jogo=' + JOGO)).json();
    ok(res.eventos === lote.length, 'contou ' + res.eventos + ' eventos (os mesmos que foram mandados)');
    ok(res.sessoes === 9, 'contou 9 sessões');
    ok(res.mortes_por_fase['3'] === 27 && res.mortes_por_fase['2'] === 9,
       'mortes por fase certas: fase 3 = 27, fase 2 = 9', JSON.stringify(res.mortes_por_fase));
    ok(res.chegadas_por_fase['4'] === 9, 'e as chegadas na fase 4 = 9');
    ok(res.saidas_por_fase['4'] === 9, 'e as saídas na fase 4 = 9');
    ok(res.minutos_por_sessao === 9.4, 'minutos por sessão calculados da primeira à última marca (9,4 min)',
       String(res.minutos_por_sessao));
    ok(res.onde_trava.length >= 1 && res.onde_trava[0].x === 110 && res.onde_trava[0].z === -40,
       'e o ponto de travamento vem agrupado (x=110, z=-40, 9 vezes)', JSON.stringify(res.onde_trava[0]));
    ok(res.por_versao['v1'] === lote.length, 'e guarda a versão do jogo junto (dá para comparar depois)');
  }

  console.log('\n=== 3) as sugestões vêm com o número que as sustenta ===\n');
  {
    const s = await (await fetch(BASE + '/sugestoes?jogo=' + JOGO)).json();
    const txt = s.sugestoes.map(x => x.texto).join(' | ');
    ok(s.sugestoes.length >= 3, 'deu ' + s.sugestoes.length + ' sugestões');
    ok(/fase 3 concentra 75% das mortes \(27 de 36\)/.test(txt),
       'diz a fase que mata mais, com a porcentagem e o total', txt);
    ok(/9 jogadores travaram perto de \(110, -40\)/.test(txt), 'e o lugar onde travam, com o ponto exato');
    ok(/100% dos que chegam na fase 4 saem ali \(9 de 9\)/.test(txt), 'e onde o jogo perde o jogador');
    ok(/sessao media de 9\.4 min/.test(txt), 'e diz se o jogo está segurando o jogador (tempo de sessão)');
    ok(s.sugestoes.some(x => x.numeros), 'cada sugestão carrega os números (não é opinião solta)');
    ok(s.sugestoes.every(x => x.nivel), 'e diz de que tipo é (dificuldade, bug-provavel, retenção...)');
  }

  console.log('\n=== 4) identidade NUNCA é gravada (e o arquivo prova) ===\n');
  {
    const antes = (await (await fetch(BASE + '/resumo?jogo=' + JOGO)).json()).eventos;
    const r = await postar({ jogo: JOGO, lote: [
      { t: T0, evento: 'morte', quem: 'sessao9', dados: {
        fase: 5, x: 1, z: 1, nome: 'Fulano de Tal', email: 'fulano@exemplo.com',
        chat: 'oi gente', userId: '123456789', senha: 'nao-pode', telefone: '11 99999-0000',
        anotacao: 'x'.repeat(500) } },
    ] });
    ok(r.status === 200 && r.j.aceitos === 1, 'o evento foi aceito (o que interessa, passa)');

    const arqTexto = fs.readFileSync(path.join(RAIZ, JOGO + '.jsonl'), 'utf8');
    ['Fulano', 'exemplo.com', 'oi gente', '123456789', 'nao-pode', '99999-0000'].forEach(t =>
      ok(arqTexto.indexOf(t) < 0, 'o arquivo em disco NÃO contém "' + t + '"'));
    ok(arqTexto.indexOf('"fase": 5') >= 0 || arqTexto.indexOf('"fase":5') >= 0,
       'mas contém a fase do acontecimento (o que serve para consertar o jogo)');
    ok(!/"anotacao": "x{400}/.test(arqTexto), 'e o texto de 500 caracteres foi cortado (não vira despejo de fala)');

    const res = await (await fetch(BASE + '/resumo?jogo=' + JOGO)).json();
    ok(res.eventos === antes + 1, 'o resumo somou o evento');
    ok(JSON.stringify(res).indexOf('Fulano') < 0, 'e o resumo não carrega nada de identidade');
  }

  console.log('\n=== 5) limites: abuso não entra ===\n');
  {
    const grande = await fetch(BASE + '/evento', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jogo: JOGO, lote: [{ evento: 'x', dados: { anotacao: 'a'.repeat(80 * 1024) } }] }) });
    ok(grande.status === 413, 'corpo grande demais: recusado com 413', String(grande.status));

    const torto = await fetch(BASE + '/evento', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{isso nao e json' });
    ok(torto.status === 400, 'json torto: recusado com 400', String(torto.status));

    const gigante = await postar({ jogo: JOGO, lote: new Array(300).fill(0).map(() => ({ evento: 'x' })) });
    ok(gigante.status === 400 && /lote grande demais/.test(gigante.j.motivo),
       'lote com 300 eventos: recusado com o motivo', JSON.stringify(gigante.j));

    const vazio = await postar({ jogo: JOGO });
    ok(vazio.status === 400 && vazio.j.motivo === 'sem lote', 'corpo sem lote: recusado com o motivo');

    const rota = await fetch(BASE + '/nao-existe');
    ok(rota.status === 404, 'rota que não existe: 404 (não devolve página de erro com HTML)');
  }

  console.log('\n=== 6) o arquivo é a verdade: reiniciar não perde nada ===\n');
  {
    const antes = await (await fetch(BASE + '/resumo?jogo=' + JOGO)).json();
    await parar();
    subir();
    const saude2 = await esperar(BASE, 10000);
    ok(!!saude2 && saude2.jogos.indexOf(JOGO) >= 0, 'subiu de novo e já reconheceu o jogo pelo arquivo');
    const depois = await (await fetch(BASE + '/resumo?jogo=' + JOGO)).json();
    ok(depois.eventos === antes.eventos, 'os eventos continuam os mesmos: ' + depois.eventos);
    ok(depois.sessoes === antes.sessoes, 'as sessões também: ' + depois.sessoes);
    ok(depois.mortes_por_fase['3'] === antes.mortes_por_fase['3'], 'e as mortes por fase');
    const sug = await (await fetch(BASE + '/sugestoes?jogo=' + JOGO)).json();
    ok(sug.sugestoes.some(x => /fase 3/.test(x.texto)), 'e as sugestões continuam as mesmas (reconstruídas do arquivo)');

    const pouquinho = await (await fetch(BASE + '/sugestoes?jogo=jogo-novo-sem-dado')).json();
    ok(pouquinho.sugestoes[0].nivel === 'sem-dado' && /pouco dado/.test(pouquinho.sugestoes[0].texto),
       'jogo sem dado: a resposta é "pouco dado", não uma conclusão inventada', pouquinho.sugestoes[0].texto);
  }

  console.log('\n=== 7) o publicador monta os pedidos certos (e conta o erro certo) ===\n');
  {
    const mem = {};
    const chamadas = [];
    let resposta = { ok: true, status: 200, json: async () => ({}) };
    let respostaGet = null;          /* quando o GET precisa responder diferente do PUT */
    const ctx = vm.createContext({
      console, Math, Date, JSON, Promise, setTimeout, clearTimeout, AbortController,
      location: { protocol: 'https:', origin: 'https://x' },
      btoa: s => Buffer.from(s, 'binary').toString('base64'),
      atob: s => Buffer.from(s, 'base64').toString('binary'),
      Uint8Array, Buffer, window: null,
      fetch: async (u, opt) => {
        chamadas.push({ url: String(u), opt: opt || {} });
        if (respostaGet && (!opt || !opt.method || opt.method === 'GET')) return respostaGet;
        return resposta;
      },
    });
    ctx.window = ctx;
    ctx.window.LS = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } };
    vm.runInContext(fs.readFileSync('arkher_publicar.js', 'utf8'), ctx, { filename: 'arkher_publicar.js' });
    const P = ctx.Publicar;

    P.salvar({ repo: 'dono/repo', gh: 'ghp_tok', rbxKey: 'rbx_tok', universo: '123', lugar: '456',
               tel: '100.64.0.9:8777', jogo: 'meu-jogo' });
    const cfg = P.cfg();
    ok(cfg.tel === '100.64.0.9:8777' && cfg.repo === 'dono/repo', 'guardou a configuração (local, no navegador)');
    ok(P.norm('100.64.0.9:8777') === 'http://100.64.0.9:8777', 'endereço sem esquema ganha http://');

    /* GitHub: cria e depois atualiza (precisa do sha) */
    chamadas.length = 0;
    respostaGet = { ok: false, status: 404, text: async () => '{"message":"Not Found"}', json: async () => null };
    resposta = { ok: true, status: 201, text: async () => '{}',
      json: async () => ({ commit: { sha: 'abcdef1', html_url: 'https://github.com/x/y/commit/abcdef1' } }) };
    const g1 = await P.paraGitHub('ARKHER-JOGO/LEIA-ME.md', '# oi', 'ARKHER: kit');
    ok(g1.ok === true && g1.criou === true, 'arquivo novo: cria (sem sha)');
    const put1 = chamadas.filter(c => c.opt.method === 'PUT')[0];
    ok(/api\.github\.com\/repos\/dono\/repo\/contents\/ARKHER-JOGO\/LEIA-ME\.md/.test(put1.url),
       'chamou a Contents API do GitHub no caminho certo', put1.url);
    ok(put1.opt.headers['Authorization'] === 'Bearer ghp_tok', 'com o token no cabeçalho (e só na API do GitHub)');
    const corpo1 = JSON.parse(put1.opt.body);
    ok(corpo1.content && !corpo1.sha, 'o corpo leva o arquivo em base64');
    ok(Buffer.from(corpo1.content, 'base64').toString('utf8') === '# oi', 'e o conteúdo volta igual (base64 correto)');

    chamadas.length = 0;
    respostaGet = { ok: true, status: 200, text: async () => '{"sha":"abc"}', json: async () => ({ sha: 'abc' }) };
    const g2 = await P.paraGitHub('ARKHER-JOGO/LEIA-ME.md', '# oi de novo', 'ARKHER: atualiza');
    const put2 = chamadas.filter(c => c.opt.method === 'PUT')[0];
    ok(g2.criou === false && JSON.parse(put2.opt.body).sha === 'abc',
       'arquivo que já existe: manda o sha para ATUALIZAR (não estoura 409)');

    /* erros honestos */
    resposta = { ok: false, status: 401, text: async () => '{"message":"Bad credentials"}', json: async () => null };
    const g3 = await P.paraGitHub('x.md', 'x', 'x');
    ok(g3.ok === false && /401/.test(g3.o_que_fazer), 'token errado: diz 401 e o que fazer', g3.o_que_fazer);
    resposta = { ok: false, status: 403, text: async () => '{"message":"Forbidden"}', json: async () => null };
    const g4 = await P.paraGitHub('x.md', 'x', 'x');
    ok(g4.ok === false && /403/.test(g4.o_que_fazer), 'sem permissão: diz 403 e o escopo que falta');

    /* Roblox Open Cloud */
    chamadas.length = 0;
    resposta = { ok: true, status: 200, text: async () => '{"versionNumber":7}', json: async () => ({ versionNumber: 7 }) };
    const rb = await P.paraRoblox(new Uint8Array([60, 114, 111, 98, 108, 111, 120]), false);
    ok(rb.ok === true && rb.versao === 7, 'publicou no Roblox e leu o número da versão devolvido');
    const post = chamadas[0];
    ok(/apis\.roblox\.com\/universes\/v1\/123\/places\/456\/versions\?versionType=Published/.test(post.url),
       'chamou o Open Cloud no lugar certo, com universo e lugar', post.url);
    ok(post.opt.headers['x-api-key'] === 'rbx_tok', 'com a chave no cabeçalho x-api-key');
    ok(post.opt.headers['Content-Type'] === 'application/octet-stream', 'e o arquivo como binário (não como texto)');

    chamadas.length = 0;
    await P.paraRoblox(new Uint8Array([1]), true);
    ok(/versionType=Saved/.test(chamadas[0].url), 'e sabe salvar (Saved) em vez de publicar (Published)');

    P.salvar({ rbxKey: '' });
    const semChaveR = await P.paraRoblox(new Uint8Array([1]), false);
    ok(semChaveR.ok === false && /Open Cloud/.test(semChaveR.motivo) && /universe-places/.test(semChaveR.o_que_fazer),
       'sem chave: diz que falta a chave e o escopo certo');
    P.salvar({ rbxKey: 'rbx_tok', universo: '123', lugar: '456' });
    const semArq = await P.paraRoblox(null, false);
    ok(semArq.ok === false && /Studio/.test(semArq.o_que_fazer),
       'sem arquivo: diz que quem salva o .rbxl é o Studio (não finge gerar)');

    /* telemetria pelo publicador */
    resposta = { ok: true, status: 200, text: async () => '{"ok":true}', json: async () => ({ ok: true }) };
    const tel = await P.telemetria('100.64.0.9:8777', 'meu-jogo');
    ok(tel.ok === true, 'o publicador lê a telemetria (health + resumo + sugestões)');
    const urls = chamadas.map(c => c.url).join(' ');
    ok(/\/health/.test(urls) && /\/resumo\?jogo=meu-jogo/.test(urls) && /\/sugestoes\?jogo=meu-jogo/.test(urls),
       'chamando as três rotas certas', urls);

    /* o código que vai para o jogo */
    const snip = P.snippet('100.64.0.9:8777', 'meu-jogo');
    ok(/http:\/\/100\.64\.0\.9:8777/.test(snip) && /meu-jogo/.test(snip), 'o código já vem com o endereço e o nome do jogo');
    ok(/ARKHER_Telemetria/.test(snip) && /HttpService/.test(snip), 'e usa o módulo de telemetria e o HttpService');
    ok(!/UserId.*=.*"|nome =|email/i.test(snip), 'e não pede identidade nenhuma no código do jogo');

    /* versões: marcar e comparar */
    P.salvar({ jogo: 'meu-jogo' });
    P.marcar({ versao: 'v1', resumo: { eventos: 100, mortes_por_fase: { 3: 60, 2: 40 }, minutos_por_sessao: 3.1 } });
    P.marcar({ versao: 'v2', resumo: { eventos: 120, mortes_por_fase: { 3: 30, 2: 45 }, minutos_por_sessao: 4.4 } });
    const l = P.versoes();
    ok(l.length === 2 && l[1].versao === 'v2', 'duas versões marcadas, na ordem');
    const cmp = P.comparar(l[0], l[1]);
    ok(cmp.ok === true && /fase 3: 60% → 40% \(melhorou\)/.test(cmp.texto),
       'a comparação mostra a fase 3 melhorando, com o número', cmp.texto);
    ok(/fase 2: 40% → 60% \(piorou\)/.test(cmp.texto), 'e a fase 2 piorando (não esconde o que piorou)');
    ok(/minutos por sessao: 3.1 → 4.4 \(melhorou\)/.test(cmp.texto), 'e o tempo por sessão');
    const cmpCurto = P.comparar(l[0], { versao: 'v3', resumo: { eventos: 0 } });
    ok(cmpCurto.ok === false, 'sem telemetria numa das versões, não compara (não inventa)');
    for (let i = 0; i < 40; i++) P.marcar({ versao: 'v' + i, resumo: {} });
    ok(P.versoes().length <= 30, 'e as versões têm teto (não cresce sem fim)');
  }

  console.log('\n=== 8) a interface liga isso de verdade ===\n');
  {
    const ui = fs.readFileSync('ui.js', 'utf8');
    const html = fs.readFileSync('index.html', 'utf8');
    ['pb-repo', 'pb-rbx-key', 'pb-ids', 'pb-tel', 'pb-jogo', 'pb-salvar', 'pb-snippet',
     'pb-gh', 'pb-rbx-arq', 'pb-tel-ver', 'pb-marcar', 'pb-comparar'].forEach(id =>
      ok(html.indexOf('id="' + id + '"') > 0, 'o campo/botão ' + id + ' existe no HTML'));
    ok(/#pb-gh'\)\.onclick/.test(ui) && /P\.paraGitHub/.test(ui), 'o botão do kit chama o GitHub de verdade');
    ok(/pb-rbx-arq/.test(ui) && /arq\.onchange/.test(ui) && /P\.paraRoblox/.test(ui),
       'o seletor de arquivo publica o .rbxl de verdade');
    ok(/#pb-tel-ver'\)\.onclick/.test(ui) && /P\.telemetria/.test(ui), 'o botão da telemetria lê o nó');
    ok(/#pb-marcar'\)\.onclick/.test(ui) && /P\.marcar/.test(ui), 'e marcar versão guarda o retrato');
    ok(/#pb-comparar'\)\.onclick/.test(ui) && /P\.comparar/.test(ui), 'e comparar mostra o antes e depois');
    ok(/Salvar como \.rbxl/.test(html) || /Salvar como \.rbxl/.test(ui),
       'e a tela diz que quem salva o .rbxl é o Studio');
  }

  console.log('\n=== 9) envios demais por minuto são barrados (429) — último, de propósito ===\n');
  {
    let b429 = 0, b200 = 0;
    for (let i = 0; i < 130; i++) {
      const r = await fetch(BASE + '/evento', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jogo: 'enchente', lote: [{ evento: 'x' }] }) });
      if (r.status === 429) b429++; else if (r.status === 200) b200++;
    }
    ok(b429 > 0, 'depois de muitos envios no mesmo minuto, o nó responde 429 (' + b429 + ' recusados)');
    ok(b200 <= 121, 'e o número de aceitos fica no teto declarado (aceitos: ' + b200 + ')');
  }

  console.log('\n=== 10) o que ele não faz, dito na cara ===\n');
  {
    const js = fs.readFileSync('arkher_publicar.js', 'utf8');
    ok(/Nao gera \.rbxl no navegador/.test(js), 'o publicador declara que não gera .rbxl');
    const py = fs.readFileSync('telemetria.py', 'utf8');
    ok(/sao descartados/.test(py) && /nao guarda identidade|Nao guarda identidade/i.test(py),
       'a telemetria declara que não guarda identidade');
    ok(/MIN_AMOSTRA/.test(py), 'e tem um mínimo de amostra antes de concluir qualquer coisa');
    ok(/O ARQUIVO E A VERDADE/.test(py), 'e declara que o arquivo é a verdade (memória é só cache)');
  }

  await parar();
  try { fs.rmSync(RAIZ, { recursive: true, force: true }); } catch (e) {}

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ PUBLICAR OK — telemetria de verdade (com arquivo como verdade) e publicação que diz o erro que voltou'));
  process.exitCode = falhou ? 1 : 0;
})();
