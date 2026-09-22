--[[ =====================================================================
     ARKHER TELEMETRIA — o jogo conta o que aconteceu (e melhora por isso)
     =====================================================================
     Por que existe: o Studio entrega "testar" e para. Ninguem sabe onde o
     jogador morre, onde trava, em que fase ele desiste — e quem nao sabe
     isso esta adivinhando. Aqui o jogo MANDA esses fatos para o seu no,
     e o no devolve o que corrigir na proxima versao.

     COMO USAR NO STUDIO (dentro de um Script do servidor)
         local T = require(game.ReplicatedStorage.ARKHER_Telemetria)
         local tel = T.novo({ url = "http://100.x.y.z:8777", jogo = "meu-jogo" })
         tel:ligar(game:GetService("HttpService"))
         tel:registrar("morte", { fase = 3, x = 120, y = 8, z = -44, causa = "queda" })

     REGRAS QUE ESTE ARQUIVO CUMPRE
     1. NUNCA quebra o jogo: tudo em pcall; se o no estiver fora do ar, o
        evento e descartado em silencio e o jogo segue.
     2. NUNCA manda identidade: o nome e o UserId do jogador entram numa
        mistura com um sal aleatorio do servidor. O que sai e um codigo
        curto e irrastreavel — da para agrupar por jogador sem saber quem
        e. Nome, e-mail, conversa e qualquer texto pessoal sao BLOQUEADOS.
     3. NUNCA estoura o limite do Roblox: fila com teto, envio em lote e
        um teto de envios por minuto. Pedido demais e jogado fora, nao
        acumulado.
     4. Tudo o que decide (fila, limites, limpeza, anonimizacao) e Lua puro
        e testado fora do Studio. A casca do Roblox e so o envio.

     LIMITE HONESTO
       Isto e telemetria de jogo, nao espionagem: nao manda posicao quadro a
       quadro, nao manda chat, nao manda identidade. E amostra de fatos —
       o suficiente para consertar o jogo, e nada alem disso.
   ===================================================================== ]]

local T = {}
T.VERSAO = "1.0"

-- chaves que NUNCA podem sair do jogo (bloqueadas antes de qualquer envio)
T.PROIBIDAS = {
  nome = true, name = true, username = true, user = true, usuario = true,
  email = true, mail = true, telefone = true, phone = true, ip = true,
  senha = true, password = true, token = true, chat = true, mensagem = true,
  userId = true, userid = true, displayname = true, conta = true, documento = true,
}

T.MAX_TEXTO = 80          -- texto maior que isso e cortado (nao queremos fala)
T.MAX_CHAVES = 12
T.MAX_EVENTOS_POR_ENVIO = 40
T.MAX_FILA = 300
T.ENVIOS_POR_MINUTO = 30

local function agora() return os.clock() end

-- anonimizacao: mistura estavel de sal + id, sem guardar o id.
-- Nao e criptografia forte; e o suficiente para nao guardar identidade.
function T.apelido(sal, id)
  local s = tostring(sal or "") .. "|" .. tostring(id or "anon")
  local h1, h2 = 5381, 52711
  for i = 1, #s do
    local c = s:byte(i)
    h1 = (h1 * 33 + c) % 4294967296
    h2 = (h2 * 31 + c * 7) % 4294967296
  end
  return string.format("%08x%04x", h1, h2 % 65536)
end

-- limpeza dos dados: chave desconhecida ou proibida, texto longo e tabela
-- funda demais nao passam. Devolve uma copia limpa (nao mexe no original).
function T.limparDados(dados, profundidade)
  profundidade = profundidade or 1
  if type(dados) ~= "table" then return nil end
  if profundidade > 2 then return nil end
  local saida, n = {}, 0
  for k, v in pairs(dados) do
    if T.PROIBIDAS[tostring(k):lower()] then
      -- bloqueado por regra, e nao por acaso
    elseif type(k) == "string" and #k <= 32 then
      n = n + 1
      if n > T.MAX_CHAVES then break end
      local tv = type(v)
      if tv == "number" then
        if v ~= v or v == math.huge or v == -math.huge then v = nil end   -- nan/inf nunca
      elseif tv == "boolean" then
        -- ok
      elseif tv == "string" then
        v = v:sub(1, T.MAX_TEXTO)
      elseif tv == "table" then
        v = T.limparDados(v, profundidade + 1)
      else
        v = nil
      end
      if v ~= nil then saida[k] = v end
    end
  end
  return saida
end

function T.novo(cfg)
  cfg = cfg or {}
  return {
    url = tostring(cfg.url or ""):gsub("/+$", ""),
    jogo = tostring(cfg.jogo or "jogo"),
    sal = tostring(cfg.sal or (tostring(agora()):gsub("%D", "") .. tostring(math.random(100000, 999999)))),
    fila = {},
    erros = 0,
    enviados = 0,
    descartados = 0,
    envios = {},              -- marcas de tempo dos envios (limite por minuto)
    http = nil,
    loteMax = tonumber(cfg.loteMax) or T.MAX_EVENTOS_POR_ENVIO,
    filaMax = tonumber(cfg.filaMax) or T.MAX_FILA,
    limiteEnvio = tonumber(cfg.limiteEnvio) or T.ENVIOS_POR_MINUTO,
  }
end

local Metodos = {}
Metodos.__index = Metodos

-- registra um fato. Se a fila estourou, joga o mais velho fora (nunca cresce sem fim).
function Metodos:registrar(evento, dados, quem)
  if type(evento) ~= "string" or #evento == 0 or #evento > 40 then return false, "evento invalido" end
  local e = { t = math.floor(agora() * 1000) / 1000, evento = evento }
  if quem ~= nil then e.quem = T.apelido(self.sal, quem) end
  local limpos = T.limparDados(dados)
  if limpos then e.dados = limpos end
  if #self.fila >= self.filaMax then
    table.remove(self.fila, 1)          -- o mais antigo sai
    self.descartados = self.descartados + 1
  end
  self.fila[#self.fila + 1] = e
  return true
end

function Metodos:pendente() return #self.fila end

-- pode enviar agora? (teto por minuto, para nao bater no limite do Roblox)
function Metodos:podeEnviar(quando)
  quando = tonumber(quando) or agora()
  local vivas = {}
  for i = 1, #self.envios do
    if quando - self.envios[i] < 60 then vivas[#vivas + 1] = self.envios[i] end
  end
  self.envios = vivas
  return #vivas < self.limiteEnvio
end

function Metodos:lote()
  local l, n = {}, math.min(#self.fila, self.loteMax)
  for i = 1, n do l[i] = table.remove(self.fila, 1) end
  return l
end

-- enviar(): espera um "http" com .Post (o HttpService do Roblox, ou um
-- dublê no teste). Devolve ok + o que aconteceu. NUNCA levanta erro.
function Metodos:enviar(http, encode, quando)
  if #self.fila == 0 then return true, { enviados = 0, motivo = "nada na fila" } end
  if not self:podeEnviar(quando) then return false, { motivo = "limite por minuto" } end
  local h = http or self.http
  if not h then return false, { motivo = "sem http" } end
  local lote = self:lote()
  local corpo = { jogo = self.jogo, lote = lote, v = T.VERSAO }
  local ok, texto = pcall(function() return encode(corpo) end)
  if not ok or type(texto) ~= "string" then
    self.erros = self.erros + 1
    return false, { motivo = "nao consegui montar o pedido" }
  end
  local funcionou, resposta = pcall(function()
    return h:Post(self.url .. "/evento", texto, Enum and Enum.HttpContentType and Enum.HttpContentType.ApplicationJson or nil, false)
  end)
  self.envios[#self.envios + 1] = tonumber(quando) or agora()
  if not funcionou then
    self.erros = self.erros + 1
    -- devolve para a fila o que nao saiu? NAO: telemetria nao volta para a
    -- fila, senao um no fora do ar faz o jogo acumular lixo sem fim.
    self.descartados = self.descartados + #lote
    return false, { motivo = "falha de rede", perdidos = #lote }
  end
  self.enviados = self.enviados + #lote
  return true, { enviados = #lote }
end

function Metodos:ligar(http)
  if http then self.http = http end
  return true
end

function Metodos:stats()
  return { naFila = #self.fila, enviados = self.enviados, erros = self.erros,
           descartados = self.descartados, apelidoExemplo = T.apelido(self.sal, 12345) }
end

function T.novoCliente(cfg)
  return setmetatable(T.novo(cfg), Metodos)
end

-- helper: a linha que o jogo chama de qualquer lugar, sem passar o cliente
function T.linha(cliente, http, encode)
  local m = setmetatable(cliente, Metodos)
  return function(evento, dados, quem)
    local ok = m:registrar(evento, dados, quem)
    if ok and m:pendente() >= 10 and m:podeEnviar() then m:enviar(http, encode) end
  end
end

return T
