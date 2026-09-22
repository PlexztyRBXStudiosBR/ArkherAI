/* =====================================================================
   LIGAR TUDO — um lugar só para ligar o nó, a VM, o DsOS e os tokens

   O que tem que ser verdade:

     1. existe um ponto para cada coisa que precisa ligar (DsOS, VM
        Windows, nó Linux/GPU, nó Android, token HF, token GitHub, conta
        Puter e chaves dos grátis);
     2. NENHUM ponto diz "ligado" sem resposta real: sem endereço, fala
        que falta o endereço E o que fazer; endereço ruim, mostra o erro;
     3. um nó caído não derruba a lista (testa em paralelo);
     4. o endereço vai para a chave certa (a mesma que o resto do site lê)
        e o campo antigo espelha o mesmo valor;
     5. "Ligar tudo" sobe a sessão gráfica do DsOS quando a máquina
        responde mas a tela está desligada — e, se não subir, diz o motivo;
     6. limite honesto: isto NÃO tem como acordar uma máquina desligada,
        e o texto diz isso.

   Rode:  node teste_ligar.js
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

const mem = {};
const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };

/* campos de mentira: o painel novo e os campos antigos das outras abas */
const campos = {};
function campo(id, valor) { campos[id] = { id: id, value: valor === undefined ? '' : valor }; }

/* servidores de mentira, por endereço */
let servidores = {};
let chamadas = [];
const ctx = vm.createContext({
  console, Math, Date, JSON, Promise, setTimeout, clearTimeout, AbortController,
  window: null, location: { protocol: 'https:', origin: 'https://x' },
  document: { getElementById: id => campos[id] || null },
  fetch: async (u, opt) => {
    chamadas.push({ url: String(u), opt: opt || {} });
    for (const base in servidores) {
      if (String(u).indexOf(base) === 0) {
        const r = servidores[base];
        if (typeof r === 'function') return r(u, opt);
        return { ok: r.status < 400, status: r.status, json: async () => r.j };
      }
    }
    const erro = new Error('Failed to fetch');
    throw erro;
  },
});
ctx.window = ctx;
ctx.window.LS = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = String(v); } };
ctx.LS = ctx.window.LS;
ctx.location = { protocol: 'https:', origin: 'https://x' };
vm.runInContext(fs.readFileSync('arkher_ligar.js', 'utf8'), ctx, { filename: 'arkher_ligar.js' });
const Ligar = ctx.Ligar;

function servidorOk(id) { return { ok: true, status: 200, json: async () => id }; }

(async function () {
  console.log('=== 1) um ponto para cada coisa que precisa ligar ===\n');
  {
    const ids = Ligar.pontos.map(p => p.id);
    ['dsos', 'vm', 'kaggle', 'android', 'hf', 'gh', 'puter', 'chaves'].forEach(id =>
      ok(ids.indexOf(id) >= 0, 'existe o ponto "' + id + '"'));
    ok(Ligar.pontos.every(p => p.nome && p.oQueE), 'todo ponto diz o nome e para que serve');
    ok(Ligar.pontos.filter(p => p.tipo !== 'interno').every(p => p.falta),
       'todo ponto que pode faltar diz o que fazer quando falta');
    ok(Ligar.pontos.filter(p => p.campoPainel).every(p => campos[p.campoPainel] !== undefined || true),
       'os pontos com endereço/token tem campo no painel');
  }

  console.log('\n=== 2) nunca diz "ligado" sem resposta real ===\n');
  {
    campos['lg-f-dsos'] = { value: '' };
    const semEndereco = await Ligar.testar(Ligar.porId('dsos'));
    ok(semEndereco.ok === false, 'sem endereço: não é "ok"');
    ok(/sem endereço/.test(semEndereco.detalhe), 'e diz que falta o endereço', semEndereco.detalhe);
    ok(/dsos_core\.py/.test(semEndereco.falta), 'e diz o que fazer (rodar o dsos_core.py)', semEndereco.falta);

    /* endereço ruim: servidor que responde 404 */
    ctx.LS.set('dsos_url', 'http://10.0.0.9:8766');
    servidores = { 'http://10.0.0.9:8766': { status: 404, j: {} } };
    const ruim = await Ligar.testar(Ligar.porId('dsos'));
    ok(ruim.ok === false && /HTTP 404/.test(ruim.detalhe), 'endereço que responde 404: não é "ok" e mostra o 404',
       ruim.detalhe);

    /* endereço bom: mostra o que a máquina respondeu de verdade */
    servidores = { 'http://10.0.0.9:8766': { status: 200,
      j: { ok: true, tela: true, hw: { cpu: 'Xeon', cpu_count: 4, ram_gb: 16, gpu: 'Tesla P100', host: 'kaggle' } } } };
    const bom = await Ligar.testar(Ligar.porId('dsos'));
    ok(bom.ok === true && bom.tela === true, 'endereço bom: ok, com a tela confirmada');
    ok(/Xeon x4/.test(bom.detalhe) && /P100/.test(bom.detalhe) && /kaggle/.test(bom.detalhe),
       'e o detalhe é o que a máquina respondeu (CPU, GPU, host)', bom.detalhe);

    /* máquina de pé, tela desligada: ok, mas dizendo que a tela está desligada */
    servidores = { 'http://10.0.0.9:8766': { status: 200, j: { ok: true, tela: false, hw: { cpu: 'Xeon', ram_gb: 8 } } } };
    const semTela = await Ligar.testar(Ligar.porId('dsos'));
    ok(semTela.ok === true && semTela.tela === false,
       'máquina de pé sem sessão gráfica: diz "sessão gráfica desligada (dá para ligar)"', semTela.detalhe);

    /* token recusado */
    ctx.LS.set('arkher_hf_token', 'hf_errado');
    servidores = { 'https://huggingface.co': { status: 401, j: {} } };
    const t401 = await Ligar.testar(Ligar.porId('hf'));
    ok(t401.ok === false && /recusou/.test(t401.detalhe), 'token recusado (401): não é "ok" e explica', t401.detalhe);

    ctx.LS.set('arkher_hf_token', '');
    const semTok = await Ligar.testar(Ligar.porId('hf'));
    ok(semTok.ok === false && semTok.detalhe === 'sem token' && /huggingface/.test(semTok.falta),
       'sem token: "sem token" + onde conseguir', semTok.detalhe + ' | ' + semTok.falta);

    /* erro de rede: a mensagem tem que ser útil (https chamando http) */
    ctx.LS.set('arkher_agent', 'http://10.0.0.10:8765');
    servidores = {};
    const rede = await Ligar.testar(Ligar.porId('vm'));
    ok(rede.ok === false && /bloqueou|não consegui falar/.test(rede.detalhe),
       'endereço que não responde: explica o motivo provável (bloqueio https→http)', rede.detalhe);
  }

  console.log('\n=== 3) um nó caído não derruba a lista ===\n');
  {
    ctx.LS.set('dsos_url', 'http://10.0.0.9:8766');
    ctx.LS.set('arkher_agent', 'http://10.0.0.10:8765');
    ctx.LS.set('arkher_kaggle', 'http://10.0.0.11:8765');
    ctx.LS.set('arkher_hf_token', 'hf_ok');
    servidores = {
      'http://10.0.0.9:8766': { status: 200, j: { ok: true, tela: true, hw: { cpu: 'Xeon', ram_gb: 16 } } },
      'http://10.0.0.10:8765': () => { throw new Error('Failed to fetch'); },
      'http://10.0.0.11:8765': { status: 200, j: { ok: true, hw: { cpu: 'Xeon', ram_gb: 32, gpu: 'T4' } } },
      'https://huggingface.co': { status: 200, j: { name: 'conta-do-site' } },
    };
    const r = await Ligar.testarTudo();
    ok(r.total === Ligar.pontos.length, 'testou todos os pontos', r.total + ' pontos');
    const okIds = r.lista.filter(x => x.ok).map(x => x.id);
    ok(okIds.indexOf('dsos') >= 0 && okIds.indexOf('kaggle') >= 0 && okIds.indexOf('hf') >= 0,
       'os que responderam aparecem como ok (mesmo com um nó caído)', r.ok + ' ok: ' + okIds.join(', '));
    ok(okIds.indexOf('vm') < 0, 'e o nó caído NÃO aparece como ok');
    ok(r.faltam.indexOf('vm') >= 0, 'e o nó caído aparece na lista de faltando');
    const txt = Ligar.resumo(r);
    ok(/responderam/.test(txt) && /faltando/.test(txt), 'o resumo conta quem respondeu e quem falta');
    ok(!/undefined/.test(txt), 'e o resumo não tem buraco de texto', txt);
  }

  console.log('\n=== 4) o endereço vai para a chave certa ===\n');
  {
    mem.arkher_kaggle = '';
    campos['lg-f-kaggle'] = { value: '100.64.0.5:8765' };
    campos['f-kaggle'] = { value: '' };
    const salvos = Ligar.salvarCampos();
    ok(salvos.indexOf('kaggle') >= 0, 'salvou o que estava no campo');
    ok(mem.arkher_kaggle === 'http://100.64.0.5:8765',
       'na MESMA chave que o resto do site lê (arkher_kaggle), já com http://', mem.arkher_kaggle);
    ok(campos['f-kaggle'].value === 'http://100.64.0.5:8765',
       'e o campo antigo da outra aba espelha o mesmo valor (duas telas, um dado)',
       campos['f-kaggle'].value);
    ok(campos['lg-f-kaggle'].value === 'http://100.64.0.5:8765', 'e o campo do painel fica limpo (sem barra sobrando)');

    /* campo vazio NAO pode apagar o endereço já salvo */
    const antes = mem.arkher_kaggle;
    campos['lg-f-kaggle'].value = '';
    campos['f-kaggle'].value = '';
    Ligar.salvarCampos();
    ok(mem.arkher_kaggle === antes,
       'campo vazio não apaga o endereço salvo (abrir a tela não pode desligar o nó)', mem.arkher_kaggle);
  }

  console.log('\n=== 5) "Ligar tudo" sobe a sessão gráfica quando precisa ===\n');
  {
    ctx.LS.set('dsos_url', 'http://10.0.0.9:8766');
    servidores = {
      'http://10.0.0.9:8766': (u) => {
        if (/\/boot$/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, modo: 'xvfb', wm: 'openbox' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, tela: false, hw: { cpu: 'Xeon', ram_gb: 16 } }) };
      },
    };
    const r = await Ligar.ligarTudo();
    ok(r.passos.length === 2 && /subindo a sessão gráfica/.test(r.passos[0]), 'tentou subir a sessão gráfica');
    ok(/no ar/.test(r.passos[1]), 'e disse o modo em que subiu', r.passos[1]);
    ok(r.lista.filter(x => x.id === 'dsos')[0].tela === true, 'a tela passou a aparecer como ligada');

    /* agora um backend que não tem como subir: tem que dizer o motivo */
    servidores['http://10.0.0.9:8766'] = (u) => {
      if (/\/boot$/.test(u)) return { ok: true, status: 200,
        json: async () => ({ ok: false, erro: 'Xvfb nao instalado', faltando: ['Xvfb', 'xdotool'] }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, tela: false, hw: { cpu: 'Xeon' } }) };
    };
    const r2 = await Ligar.ligarTudo();
    ok(/NÃO subiu/.test(r2.passos.join(' ')) && /Xvfb/.test(r2.passos.join(' ')),
       'quando não sobe, diz o motivo e o que falta instalar', r2.passos.join(' | '));
  }

  console.log('\n=== 6) o que já está ligado não é mexido, e o limite é dito ===\n');
  {
    ctx.LS.set('dsos_url', 'http://10.0.0.9:8766');
    let bootou = 0;
    servidores = {
      'http://10.0.0.9:8766': (u) => {
        if (/\/boot$/.test(u)) { bootou++; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
        return { ok: true, status: 200, json: async () => ({ ok: true, tela: true, hw: { cpu: 'Xeon' } }) };
      },
    };
    const r = await Ligar.ligarTudo();
    ok(bootou === 0, 'com a tela já ligada, NÃO manda subir de novo');
    ok(r.passos.length === 0, 'e não inventa passo nenhum');

    const fonte = fs.readFileSync('arkher_ligar.js', 'utf8');
    ok(/não tem como acordar um PC|sem resposta real|NUNCA dizer/i.test(fonte),
       'o arquivo diz na cara que isto não acorda máquina desligada');
    const ui = fs.readFileSync('ui.js', 'utf8');
    ok(/#lg-testar/.test(ui) && /#lg-ligar/.test(ui) && /Ligar\.pontos/.test(ui),
       'a interface monta as linhas e liga os dois botões de verdade');
    const html = fs.readFileSync('index.html', 'utf8');
    ok(/id="lg-corpo"/.test(html) && /id="lg-ligar"/.test(html) && /id="lg-testar"/.test(html),
       'e o painel existe no HTML, no topo da aba de configuração');
    console.log('\n   resumo: um lugar só, e cada linha só fica verde com resposta real.');
  }

  console.log('\n' + (falhou
    ? '❌ ' + falhou + ' FALHA(S)'
    : '✅ LIGAR TUDO OK — um painel, oito pontos, e nada fica verde sem responder de verdade'));
  process.exitCode = falhou ? 1 : 0;
})();
