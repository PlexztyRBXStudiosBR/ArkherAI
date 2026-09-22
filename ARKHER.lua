--[[ =====================================================================
     ARKHER — PACOTE PARA ROBLOX (Luau)
     =====================================================================
     O que e isto: o que o Roblox Studio NAO entrega pronto. Nao e uma
     engine (o Roblox ja e a engine) e nao e uma copia do Studio: e a
     base que todo jogo precisa e todo mundo reescreve na mao —
     personagem, inventario, missoes, NPC, salvamento, animacao, dialogo
     e a camada de servidor que impede trapaca.

     COMO USAR NO STUDIO
       Coloque este arquivo em ReplicatedStorage (ModuleScript chamado
       ARKHER) e, num Script do servidor:
           local ARKHER = require(game.ReplicatedStorage.ARKHER)
           local Jogo = ARKHER.novoJogo({ nome = "Meu Jogo" })
           Jogo:ligar()          -- liga os sistemas
       Do lado do cliente, para pedir uma compra, por exemplo:
           ARKHER.pedir("comprar", { item = "pocao", qtd = 1 })
       O cliente PEDE; quem decide e o servidor. Sempre.

     REGRA DE OURO DESTE ARQUIVO
       Toda a inteligencia (inventario, missoes, NPC, validacao) e Lua
       puro, sem depender do Roblox. A parte do Roblox e uma casca fina.
       Isso tem dois motivos: (1) da para TESTAR de verdade, fora do
       Studio; (2) se um dia sair do Roblox, a inteligencia vem junto.

     LIMITE HONESTO (dito na cara, como no resto do ARKHER)
       - O cliente NUNCA decide preco, dano, velocidade de ganho ou
         posicao final. Ele pede; o servidor confere e aplica.
       - Anti-trapaca aqui e o BASICO (limite de taxa, distancia,
         preco do servidor). Nao e anti-cheat de AAA: quem tem o
         aparelho na mao sempre pode tentar. O que existe e o servidor
         autoritativo — isso resolve a esmagadora maioria dos casos.
       - Este arquivo e Lua 5.1/Luau compativel de proposito: roda no
         Studio e roda em teste automatico. Sem tipo anotado, para nao
         travar quem for testar.
   ===================================================================== ]]

local ARKHER = {}

ARKHER.VERSAO = "1.0"
ARKHER.nome = "ARKHER"

-- =====================================================================
-- 1) INVENTARIO — somar, tirar, peso, pilha e ir e vir do salvamento
-- =====================================================================
local Inventario = {}
Inventario.__index = Inventario

function Inventario.novo(cfg)
  cfg = cfg or {}
  local itens = {}
  local maxPeso = tonumber(cfg.maxPeso) or 0      -- 0 = sem limite
  return setmetatable({ itens = itens, maxPeso = maxPeso, PESO = cfg.peso or {},
                        pilhaMax = tonumber(cfg.pilhaMax) or 99,
                        pilhas = cfg.pilhas or {} }, Inventario)   -- teto por item (ex: moeda)
end

function Inventario:peso()
  local t = 0
  for id, q in pairs(self.itens) do
    t = t + q * (tonumber(self.PESO[id]) or 0)
  end
  return t
end

-- devolve quanto REALMENTE entrou (pode entrar menos por peso ou pilha)
function Inventario:dar(id, q)
  q = math.floor(tonumber(q) or 0)
  if q <= 0 or type(id) ~= "string" or #id == 0 or #id > 64 then return 0 end
  local atual = self.itens[id] or 0
  local teto = tonumber(self.pilhas[id]) or self.pilhaMax    -- moeda tem o dela
  local cabe = math.min(q, teto - atual)
  if self.maxPeso > 0 then
    local p = tonumber(self.PESO[id]) or 0
    if p > 0 then
      local espaco = math.floor((self.maxPeso - self:peso()) / p)
      cabe = math.min(cabe, espaco)
    end
  end
  if cabe <= 0 then return 0 end
  self.itens[id] = atual + cabe
  return cabe
end

function Inventario:tirar(id, q)
  q = math.floor(tonumber(q) or 0)
  local atual = self.itens[id] or 0
  local sai = math.min(q, atual)
  if sai <= 0 then return 0 end
  self.itens[id] = atual - sai
  if self.itens[id] <= 0 then self.itens[id] = nil end
  return sai
end

function Inventario:tem(id, q)
  return (self.itens[id] or 0) >= (math.floor(tonumber(q) or 1))
end

function Inventario:saida()
  local l = {}
  for id, q in pairs(self.itens) do l[#l + 1] = { id = id, q = q } end
  table.sort(l, function(a, b) return a.id < b.id end)   -- ordem estavel
  return l
end

function Inventario:paraSalvar() return self:saida() end

function Inventario:deSalvar(l)
  self.itens = {}
  if type(l) ~= "table" then return self end
  for i = 1, math.min(#l, 200) do              -- teto: salvamento adulterado nao estoura
    local x = l[i]
    if type(x) == "table" and type(x.id) == "string" and tonumber(x.q) then
      self.itens[x.id] = math.min(math.floor(tonumber(x.q)), tonumber(self.pilhas[x.id]) or self.pilhaMax)
    end
  end
  return self
end

-- =====================================================================
-- 2) MISSOES — maquina de estado pura
-- =====================================================================
local Missoes = {}
Missoes.__index = Missoes

function Missoes.nova(lista)
  local m = {}
  for _, def in ipairs(lista or {}) do
    if type(def) == "table" and type(def.id) == "string" then
      m[def.id] = { def = def, estado = "livre", progresso = 0, alvo = tonumber(def.alvo) or 1 }
    end
  end
  return setmetatable({ m = m, ordem = {}, concluidas = 0 }, Missoes)
end

function Missoes:aceitar(id)
  local t = self.m[id]
  if not t or t.estado ~= "livre" then return false end
  -- respeita o "precisa" declarado (outra missao feita antes)
  for _, dep in ipairs(t.def.precisa or {}) do
    if not (self.m[dep] and self.m[dep].estado == "feita") then return false end
  end
  t.estado = "ativa"
  self.ordem[#self.ordem + 1] = id
  return true
end

-- registra um evento do jogo ("matou zumbi") e diz se a missao ficou pronta
function Missoes:registrar(tipoEvento, qtd)
  qtd = math.floor(tonumber(qtd) or 1)
  local prontas = {}
  for id, t in pairs(self.m) do
    if t.estado == "ativa" and t.def.evento == tipoEvento then
      t.progresso = math.min(t.alvo, t.progresso + qtd)
      if t.progresso >= t.alvo then
        t.estado = "pronta"
        prontas[#prontas + 1] = id
      end
    end
  end
  table.sort(prontas)
  return prontas
end

-- entregar SO se estiver pronta: evita "completei sem cumprir"
function Missoes:entregar(id, inventario, recompensas)
  local t = self.m[id]
  if not t or t.estado ~= "pronta" then return nil end
  local dados = {}
  if inventario and type(recompensas) == "table" then
    for _, r in ipairs(recompensas) do
      if r.item then dados[r.item] = inventario:dar(r.item, r.q or 1) end
    end
  end
  t.estado = "feita"
  self.concluidas = self.concluidas + 1
  return dados
end

function Missoes:listar()
  local l = {}
  for _, id in ipairs(self.ordem) do
    local t = self.m[id]
    l[#l + 1] = { id = id, estado = t.estado, progresso = t.progresso, alvo = t.alvo }
  end
  return l
end

-- =====================================================================
-- 3) NPC — tabela de comportamento (o que faz o NPC parecer vivo)
-- =====================================================================
local NPC = {}

NPC.padrao = {
  ver = 60,          -- distancia em que ele percebe o jogador
  perder = 90,       -- distancia em que ele desiste
  atacar = 8,        -- distancia de ataque
  fugirAbaixo = 0.25,-- foge com menos de 25% de vida
  memoria = 6,       -- segundos que ele lembra de ter visto o jogador
}

-- decidir() nao toca no Roblox: entra estado, sai a acao.
-- estado = { dist, vidaPct, ve, tempoSemVer, modo, posto, chegou }
function NPC.decidir(estado, cfg)
  cfg = setmetatable(cfg or {}, { __index = NPC.padrao })
  local modo = estado.modo or "patrulhar"
  if (estado.vidaPct or 1) <= cfg.fugirAbaixo then return "fugir" end
  if estado.ve then
    if estado.dist <= cfg.atacar then return "atacar" end
    return "perseguir"
  end
  if modo == "perseguir" and (estado.tempoSemVer or 0) < cfg.memoria then return "perseguir" end
  if estado.chegou and estado.posto == "fim" then return "esperar" end
  return "patrulhar"
end

-- proximo ponto da ronda; volta ao inicio quando acaba (ida e volta)
function NPC.proximoPosto(pontos, i, voltando)
  local n = #(pontos or {})
  if n == 0 then return nil, 1, false end
  i = math.floor(tonumber(i) or 1)
  if n == 1 then return pontos[1], 1, "fim" end
  if voltando then
    i = i - 1
    if i <= 1 then return pontos[1], 1, false end   -- chegou no primeiro: agora vai de novo
    return pontos[i], i, true                        -- continua VOLTANDO (era aqui que ele pulava)
  end
  i = i + 1
  if i > n then return pontos[n - 1], n - 1, true end
  if i == n then return pontos[n], n, "fim" end
  return pontos[i], i, false
end

-- =====================================================================
-- 4) SEGURANCA — o servidor decide (esta e a parte que protege o jogo)
-- =====================================================================
local Seguranca = {}
Seguranca.__index = Seguranca

function Seguranca.nova(cfg)
  cfg = cfg or {}
  return setmetatable({
    limite = tonumber(cfg.limite) or 12,       -- pedidos por segundo (por jogador)
    janela = tonumber(cfg.janela) or 1,
    maxDist = tonumber(cfg.maxDist) or 40,     -- metros por pedido (teleporte = recusa)
    baldes = {},
  }, Seguranca)
end

function Seguranca:permite(jogadorId, agora)
  agora = tonumber(agora) or os.clock()
  local b = self.baldes[jogadorId]
  if not b then b = { t0 = agora, n = 0 }; self.baldes[jogadorId] = b end
  if agora - b.t0 >= self.janela then b.t0 = agora; b.n = 0 end
  b.n = b.n + 1
  if b.n > self.limite then return false, "pedidos demais" end
  return true
end

-- posicao: o cliente diz onde esta; o servidor confere se da para ter
-- chegado ali no tempo decorrido (velocidade maxima de referencia)
function Seguranca:posicaoOK(a, b, segundos, velMax)
  if type(a) ~= "table" or type(b) ~= "table" then return false, "posicao invalida" end
  local dx, dy, dz = (b.x or 0) - (a.x or 0), (b.y or 0) - (a.y or 0), (b.z or 0) - (a.z or 0)
  local d = math.sqrt(dx * dx + dy * dy + dz * dz)
  if d > self.maxDist then return false, "salto longo demais" end
  local v = tonumber(velMax) or 60
  local s = math.max(0.05, tonumber(segundos) or 0.05)
  if d / s > v * 1.5 then return false, "rapido demais para o tempo" end          -- folga de 50%
  return true, d
end

-- compra: o PRECO vem do servidor. O cliente so diz o que quer.
function Seguranca:compraOK(inventario, item, preco, qtd)
  qtd = math.floor(tonumber(qtd) or 1)
  if qtd < 1 or qtd > 99 then return false, "quantidade fora do permitido" end
  local p = tonumber(preco)
  if not p or p < 0 then return false, "item sem preco no servidor" end
  if not inventario:tem("moeda", p * qtd) then return false, "moeda insuficiente" end
  return true, p * qtd
end

-- =====================================================================
-- 5) ANIMACAO — estado com prioridade (nao deixa a perna "piscar")
-- =====================================================================
local Animacao = {}
Animacao.estados = { parado = 0, andando = 1, correndo = 2, pulando = 3, caindo = 2, atacando = 4, ferido = 5 }

function Animacao.escolher(fatos)
  fatos = fatos or {}
  if fatos.ferido then return "ferido" end
  if fatos.atacando then return "atacando" end
  if fatos.noChao == false then return (fatos.subindo and "pulando") or "caindo" end
  if fatos.correndo then return "correndo" end
  local v = tonumber(fatos.velocidade) or 0
  if v > 0.5 then return "andando" end
  return "parado"
end

-- troca so quando faz sentido (evita reiniciar animacao a cada quadro)
function Animacao.deveTrocar(de, para, desde)
  if de == para then return false end
  local a = Animacao.estados[de] or 0
  local b = Animacao.estados[para] or 0
  if b < a then return (tonumber(desde) or 0) > 0.15 end   -- descer espera um pouco
  return true
end

-- =====================================================================
-- 6) DIALOGO — arvore com escolhas, sem repetir fala
-- =====================================================================
local Dialogo = {}
Dialogo.__index = Dialogo

function Dialogo.novo(arvore, raiz)
  return setmetatable({ arvore = arvore or {}, atual = raiz or "inicio", vistos = {} }, Dialogo)
end

function Dialogo:no()
  return self.arvore[self.atual]
end

function Dialogo:escolher(i)
  local n = self:no()
  if not n or type(n.opcoes) ~= "table" then return nil end
  local o = n.opcoes[math.floor(tonumber(i) or 0)]
  if not o or type(o.ir) ~= "string" then return nil end
  self.vistos[self.atual] = (self.vistos[self.atual] or 0) + 1
  self.atual = o.ir
  return self.atual
end

-- primeira vez que a fala aparece; depois disso o NPC pode dizer outra coisa
function Dialogo:primeiraVez()
  return (self.vistos[self.atual] or 0) == 0
end

-- =====================================================================
-- 7) SALVAMENTO — carga com versao, teto e checagem (nada de confiar)
-- =====================================================================
local Salvar = {}
Salvar.VERSAO = 3
Salvar.MAX_BYTES = 200 * 1024

function Salvar.montar(partes)
  return {
    v = Salvar.VERSAO,
    quando = os.time(),
    jogador = partes.jogador or "anon",
    inventario = partes.inventario or {},
    missoes = partes.missoes or {},
    mundo = partes.mundo or {},
  }
end

-- devolve dados validados, ou nil + motivo. Salvamento estranho e recusado.
function Salvar.ler(dados)
  if type(dados) ~= "table" then return nil, "salvamento vazio" end
  if type(dados.v) ~= "number" then return nil, "sem versao" end
  if dados.v > Salvar.VERSAO then return nil, "salvamento de versao futura" end
  local inv = dados.inventario
  if type(inv) ~= "table" or #inv > 200 then return nil, "inventario invalido" end
  for i = 1, #inv do
    local x = inv[i]
    if type(x) ~= "table" or type(x.id) ~= "string" or tonumber(x.q) == nil then
      return nil, "item invalido na posicao " .. i
    end
  end
  return dados
end

-- =====================================================================
-- 8) O JOGO — junta tudo e (se houver Roblox) liga de verdade
-- =====================================================================
local Jogo = {}
Jogo.__index = Jogo

function ARKHER.novoJogo(cfg)
  cfg = cfg or {}
  local j = {
    nome = cfg.nome or "Jogo ARKHER",
    cfg = cfg,
    inventarios = {},
    missoes = {},
    seguranca = Seguranca.nova(cfg.seguranca),
    npcs = {},
    ligado = false,
  }
  return setmetatable(j, Jogo)
end

function Jogo:inventarioDe(jogadorId)
  local inv = self.inventarios[jogadorId]
  if not inv then
    inv = Inventario.novo(self.cfg.inventario)
    self.inventarios[jogadorId] = inv
  end
  return inv
end

function Jogo:registrarNPC(id, cfg, pontos)
  self.npcs[id] = { cfg = cfg or {}, pontos = pontos or {}, i = 1, voltando = false,
                    modo = "patrulhar", tempoSemVer = 0 }
  return self.npcs[id]
end

-- um passo de NPC: entra o que o mundo diz, sai a acao. Sem Roblox aqui.
function Jogo:passoNPC(id, estado, dt)
  local n = self.npcs[id]
  if not n then return nil end
  dt = tonumber(dt) or 0
  if estado and estado.ve then n.tempoSemVer = 0 else n.tempoSemVer = n.tempoSemVer + dt end
  local acao = NPC.decidir({
    dist = estado and estado.dist, vidaPct = estado and estado.vidaPct,
    ve = estado and estado.ve, tempoSemVer = n.tempoSemVer,
    modo = n.modo, posto = n.posto, chegou = n.chegou,
  }, n.cfg)
  -- ver o jogador (mesmo so para atacar) mantem a memoria ligada
  if estado and estado.ve then n.modo = "perseguir" end
  if acao == "patrulhar" then n.modo = "patrulhar" end
  if acao == "patrulhar" then
    local ponto, i, voltando = NPC.proximoPosto(n.pontos, n.i, n.voltando)
    n.i, n.voltando, n.posto, n.chegou = i, voltando == true, ponto and ("posto" .. i) or nil,
      (voltando == "fim")
    return acao, ponto
  end
  return acao, nil
end

-- pedido vindo do cliente: SEMPRE passa pela seguranca do servidor
function Jogo:pedido(jogadorId, tipo, dados, agora)
  dados = dados or {}
  local pode, motivo = self.seguranca:permite(jogadorId, agora)
  if not pode then return false, motivo end
  local inv = self:inventarioDe(jogadorId)

  if tipo == "comprar" then
    local tabela = self.cfg.precos or {}
    local qtd = math.floor(tonumber(dados.qtd) or 1)      -- cliente sem qtd = 1 (nunca nil)
    if qtd < 1 then return false, "quantidade invalida" end
    local ok, valor = self.seguranca:compraOK(inv, dados.item, tabela[dados.item], qtd)
    if not ok then return false, valor end
    inv:tirar("moeda", valor)
    local entrou = inv:dar(dados.item, qtd)
    if entrou ~= qtd then                                 -- nao caberia: devolve o que sobrou do pago
      local volta = pcall(function() return valor - math.floor(valor * entrou / qtd) end)
      inv:dar("moeda", volta and (valor - math.floor(valor * entrou / qtd)) or valor)
      return false, "inventario cheio"
    end
    return true, { item = dados.item, qtd = entrou, pago = valor }
  end

  if tipo == "missoes" then
    return true, self.missoes[jogadorId] and self.missoes[jogadorId]:listar() or {}
  end

  if tipo == "aceitarMissao" then
    local m = self.missoes[jogadorId]
    if not m then return false, "sem missoes" end
    return m:aceitar(dados.id)
  end

  return false, "pedido desconhecido"
end

-- ligar(): a unica parte que fala com o Roblox. Casca fina de proposito.
function Jogo:ligar(servicos)
  local S = servicos or {}
  local RS = S.ReplicatedStorage
  if not RS then return false, "sem ReplicatedStorage (chame daqui do Studio)" end

  -- evento unico: o cliente pede, o servidor responde
  local pedidoRemoto = S.Instance and S.Instance.new("RemoteFunction") or nil
  if pedidoRemoto then
    pedidoRemoto.Name = "ARKHER_Pedido"
    pedidoRemoto.Parent = RS
    local eu = self
    pedidoRemoto.OnServerInvoke = function(jogador, tipo, dados)
      local id = (jogador and (jogador.UserId or jogador.Name)) or "anon"
      return eu:pedido(id, tipo, dados)
    end
    self.pedidoRemoto = pedidoRemoto
  end

  -- salvamento automatico, se houver DataStore
  if S.DataStoreService and S.coroutine then
    local store = S.DataStoreService:GetDataStore("ARKHER_" .. self.nome)
    self.store = store
    S.coroutine.wrap(function()
      while self.ligado do
        for id, inv in pairs(self.inventarios) do
          pcall(function()
            store:SetAsync("inv_" .. tostring(id), Salvar.montar({ jogador = tostring(id), inventario = inv:paraSalvar() }))
          end)
        end
        if S.Wait then S.Wait(120) else break end
      end
    end)()
  end

  self.ligado = true
  return true, "ligado"
end

ARKHER.Inventario = Inventario
ARKHER.Missoes = Missoes
ARKHER.NPC = NPC
ARKHER.Seguranca = Seguranca
ARKHER.Animacao = Animacao
ARKHER.Dialogo = Dialogo
ARKHER.Salvar = Salvar
ARKHER.Jogo = Jogo

return ARKHER
