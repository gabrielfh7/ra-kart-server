/**
 * ============================================================================
 * RA KART INDOOR — SERVIDOR MULTIPLAYER OFICIAL (NODE.JS + SOCKET.IO)
 * Compatível com Render.com, Cloudflare Pages e Node.js
 * URL Oficial: https://ra-kart-server.onrender.com
 * 
 * SISTEMAS COMPLETOS DE CAMPEONATO:
 *   • Salas Configuráveis (Voltas, Clima, Colisão, Qualificação, Tempo Quali)
 *   • Sessão de Qualificação (Cronômetro regressivo, voltas ilimitadas, melhor volta)
 *   • Grid de Largada Sincronizado (P1 Pole, P2, P3...) com tela GRID DEFINIDO
 *   • Contagem Regressiva Autoritativa do Servidor (3, 2, 1, GO)
 *   • Telemetria & Colisão Multiplayer (Bounding Boxes com conservação de momento)
 *   • Chat em Tempo Real (Histórico de 30 mensagens) + Chat Rápido
 *   • Recordes Gerais Globais (Top 100 Persistente em disco)
 *   • Estatísticas & Perfil do Piloto (Corridas, Vitórias, Poles, Pódios, Média)
 *   • Endpoints REST: GET /debug, GET /api/records, POST /api/records, GET /api/statistics
 * ============================================================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Middleware CORS universal
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 5000
});

// ==========================================
// PERSISTÊNCIA EM DISCO (RECORDES & STATS)
// ==========================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {}
}

const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
const STATS_FILE = path.join(DATA_DIR, 'statistics.json');

function loadPersistentRecords() {
  try {
    if (fs.existsSync(RECORDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.warn('[SERVER] Erro ao carregar records.json:', e.message);
  }
  return [
    { nome: 'Gabriel', peso: 80, melhorVolta: 21840, data: '22/11/2026', modo: 'ONLINE' },
    { nome: 'Piloto Pro', peso: 75, melhorVolta: 22105, data: '22/11/2026', modo: 'ONLINE' },
    { nome: 'Indoor Master', peso: 82, melhorVolta: 22450, data: '22/11/2026', modo: 'ONLINE' }
  ];
}

function savePersistentRecords(records) {
  try {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch (e) {
    console.warn('[SERVER] Erro ao salvar records.json:', e.message);
  }
}

function loadPersistentStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      if (typeof data === 'object' && data !== null) return data;
    }
  } catch (e) {
    console.warn('[SERVER] Erro ao carregar statistics.json:', e.message);
  }
  return {};
}

function savePersistentStats(stats) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
  } catch (e) {
    console.warn('[SERVER] Erro ao salvar statistics.json:', e.message);
  }
}

const globalRecords = loadPersistentRecords();
const globalStatistics = loadPersistentStats();
const globalChatHistory = []; // últimas 30 mensagens

// ==========================================
// ESTADO EM MEMÓRIA CENTRAL DO SERVIDOR
// ==========================================
const rooms = {};
const players = {};

// 1. ENDPOINT HEALTH CHECK
app.get('/', (req, res) => {
  res.json({
    status: 'ONLINE',
    game: 'RA Kart Indoor Simulator',
    serverTime: new Date().toISOString(),
    playerCount: Object.keys(players).length,
    roomCount: Object.keys(rooms).length,
    topRecord: globalRecords.length > 0 ? globalRecords[0] : null
  });
});

// 2. ENDPOINT DE DIAGNÓSTICO E AUDITORIA (GET /debug)
app.get('/debug', (req, res) => {
  res.json({
    playerCount: Object.keys(players).length,
    roomCount: Object.keys(rooms).length,
    players,
    rooms,
    chatHistoryCount: globalChatHistory.length,
    recordsCount: globalRecords.length,
    timestamp: new Date().toISOString()
  });
});

// 3. ENDPOINTS REST: RECORDES GERAIS (TOP 100 GLOBAL)
app.get('/api/records', (req, res) => {
  const top100 = globalRecords.slice(0, 100);
  res.json(top100);
});

app.post('/api/records', (req, res) => {
  const { nome, peso, melhorVolta, modo } = req.body || {};
  if (!melhorVolta || typeof melhorVolta !== 'number' || melhorVolta < 15000 || melhorVolta > 99999) {
    return res.status(400).json({ error: 'Tempo de volta inválido.' });
  }

  const newEntry = {
    nome: String(nome || 'Piloto').slice(0, 22).trim(),
    peso: Math.max(40, Math.min(150, Number(peso) || 80)),
    melhorVolta: Math.round(melhorVolta),
    data: new Date().toLocaleDateString('pt-BR'),
    modo: String(modo || 'ONLINE').slice(0, 20)
  };

  globalRecords.push(newEntry);
  globalRecords.sort((a, b) => a.melhorVolta - b.melhorVolta);

  if (globalRecords.length > 100) {
    globalRecords.length = 100;
  }
  savePersistentRecords(globalRecords);

  res.json({ success: true, record: newEntry, rank: globalRecords.indexOf(newEntry) + 1 });
});

// 4. ENDPOINTS REST: ESTATÍSTICAS E PERFIL DO PILOTO (RANKING GLOBAL)
app.get('/api/statistics', (req, res) => {
  const sortBy = req.query.sort || 'wins';
  const list = Object.values(globalStatistics).map((st) => {
    const finishes = st.finishPositions || [];
    const avgPos = finishes.length > 0
      ? (finishes.reduce((acc, v) => acc + v, 0) / finishes.length).toFixed(1)
      : '-';
    return {
      nome: st.nome,
      favoriteNumber: st.favoriteNumber || 17,
      races: st.races || 0,
      wins: st.wins || 0,
      poles: st.poles || 0,
      podiums: st.podiums || 0,
      bestLap: st.bestLap || null,
      avgPosition: avgPos
    };
  });

  if (sortBy === 'poles') {
    list.sort((a, b) => b.poles - a.poles || b.wins - a.wins);
  } else if (sortBy === 'races') {
    list.sort((a, b) => b.races - a.races || b.wins - a.wins);
  } else if (sortBy === 'bestLap') {
    list.sort((a, b) => (a.bestLap || 999999) - (b.bestLap || 999999));
  } else {
    // Padrão: mais vitórias
    list.sort((a, b) => b.wins - a.wins || b.podiums - a.podiums);
  }

  res.json(list.slice(0, 100));
});

app.get('/api/profile/:name', (req, res) => {
  const name = req.params.name;
  const profile = globalStatistics[name] || {
    nome: name,
    races: 0,
    wins: 0,
    poles: 0,
    podiums: 0,
    bestLap: null,
    finishPositions: [],
    history: []
  };
  res.json(profile);
});

/**
 * Registra resultado de corrida nas estatísticas
 */
function recordRaceStatistics(results, poleWinnerName) {
  results.forEach((entry, idx) => {
    const pName = entry.playerName || entry.nome || 'Piloto';
    const finishPos = idx + 1;

    if (!globalStatistics[pName]) {
      globalStatistics[pName] = {
        nome: pName,
        races: 0,
        wins: 0,
        poles: 0,
        podiums: 0,
        bestLap: null,
        finishPositions: [],
        history: []
      };
    }

    const st = globalStatistics[pName];
    st.races = (st.races || 0) + 1;
    if (finishPos === 1) st.wins = (st.wins || 0) + 1;
    if (finishPos <= 3) st.podiums = (st.podiums || 0) + 1;
    if (poleWinnerName && poleWinnerName === pName) st.poles = (st.poles || 0) + 1;

    if (entry.bestLapMs && (!st.bestLap || entry.bestLapMs < st.bestLap)) {
      st.bestLap = entry.bestLapMs;
    }

    if (!st.finishPositions) st.finishPositions = [];
    st.finishPositions.push(finishPos);
    if (st.finishPositions.length > 50) st.finishPositions.shift();

    if (!st.history) st.history = [];
    st.history.unshift({
      date: new Date().toLocaleDateString('pt-BR'),
      position: finishPos,
      totalDrivers: results.length,
      bestLapMs: entry.bestLapMs || null
    });
    if (st.history.length > 20) st.history.pop();
  });

  savePersistentStats(globalStatistics);
}

/**
 * Retorna lista de salas ativas
 */
function getPublicRooms() {
  return Object.values(rooms).map((r) => {
    const host = r.players.find((p) => p.playerId === r.hostId);
    return {
      roomId: r.roomId,
      id: r.roomId,
      roomName: r.roomName,
      name: r.roomName,
      hostId: r.hostId,
      hostName: host ? host.playerName : 'Piloto',
      playerCount: r.players.length,
      maxPlayers: r.maxPlayers,
      totalLaps: r.config ? r.config.totalLaps : 5,
      weather: r.config ? r.config.weather : 'indoor',
      collisionEnabled: r.config ? r.config.collisionEnabled : true,
      hasQualifying: r.config ? r.config.hasQualifying : false,
      qualifyingMinutes: r.config ? r.config.qualifyingMinutes : 3,
      hasPassword: Boolean(r.password),
      status: r.status,
      config: r.config,
      players: r.players.map((p, idx) => ({
        playerId: p.playerId,
        id: p.playerId,
        playerName: p.playerName,
        favoriteNumber: p.favoriteNumber || 17,
        kartNumber: p.kartNumber || '#17',
        gridSlot: p.gridSlot || `P${idx + 1}`,
        isHost: p.isHost,
        isReady: p.isReady
      }))
    };
  });
}

/**
 * DIAGNÓSTICO DO SERVIDOR
 * Registra periodicamente e em eventos-chave:
 * [SERVER] Players ativos:
 * [SERVER] Salas ativas:
 * [SERVER] Hosts ativos:
 */
function printServerDiagnostics() {
  const pCount = Object.keys(players).length;
  const rCount = Object.keys(rooms).length;
  const hosts = Object.values(rooms).map((r) => {
    const h = players[r.hostId];
    return h ? `${h.playerName} (${r.roomName})` : r.hostId;
  }).join(', ') || 'Nenhum';

  console.log(`[SERVER] Players ativos: ${pCount}`);
  console.log(`[SERVER] Salas ativas: ${rCount}`);
  console.log(`[SERVER] Hosts ativos: ${hosts}`);
}

/**
 * REMOÇÃO COMPLETA E IMEDIATA DE JOGADOR
 * Executada em: disconnect, disconnecting, timeout, fechamento de aba
 */
function removePlayerCompletely(socketId, reason = 'desconexão') {
  const pInfo = players[socketId];
  if (!pInfo) return;

  const playerName = pInfo.playerName || 'Piloto';
  const kartNum = pInfo.kartNumber || '#?';
  const roomId = pInfo.roomId;
  const mode = pInfo.mode;

  console.log(`[SERVER] Jogador removido: ${socketId} (${playerName} ${kartNum}) - Motivo: ${reason}`);

  // Se o jogador estava registrado em alguma sala de corrida:
  if (roomId && rooms[roomId]) {
    const room = rooms[roomId];
    const idx = room.players.findIndex((p) => p.playerId === socketId);
    if (idx !== -1) {
      room.players.splice(idx, 1);
      console.log(`[SERVER] Slot liberado: ${kartNum} na sala ${room.roomName}`);
      console.log(`[SERVER] Sala atualizada: ${roomId} (${room.players.length}/${room.maxPlayers})`);

      // Limpeza de leaderboard temporário, grid e finalistas
      if (room.qualiLeaderboard) room.qualiLeaderboard.delete(socketId);
      if (room.gridOrder) room.gridOrder = room.gridOrder.filter((g) => g.playerId !== socketId);
      if (room.finishedPlayers) room.finishedPlayers = room.finishedPlayers.filter((f) => f.playerId !== socketId);

      // DESTRUIÇÃO AUTOMÁTICA DE SALAS VAZIAS
      if (room.players.length === 0) {
        if (room.qualiInterval) clearInterval(room.qualiInterval);
        if (room.finishCountdownInterval) clearInterval(room.finishCountdownInterval);
        delete rooms[roomId];
        console.log(`[SALA] removida automaticamente: ${roomId}`);
      } else {
        // TRANSFERÊNCIA DE HOST AUTOMÁTICA
        if (room.hostId === socketId) {
          const nextHost = room.players[0];
          room.hostId = nextHost.playerId;
          nextHost.isHost = true;
          nextHost.isReady = true;
          console.log(`[SERVER] Novo Host: ${nextHost.playerName} na sala ${room.roomName}`);
          io.to(roomId).emit('hostTransferred', {
            newHostId: nextHost.playerId,
            newHostName: nextHost.playerName
          });
        }

        io.to(roomId).emit('playerLeft', {
          playerId: socketId,
          playerName,
          players: room.players
        });
        io.to(roomId).emit('roomConfigUpdated', { config: room.config, players: room.players });
      }
    }
  } else if (roomId === 'TIMETRIAL_ONLINE' || mode === 'ONLINE_TIMETRIAL') {
    io.to('TIMETRIAL_ONLINE').emit('playerLeft', {
      playerId: socketId,
      playerName
    });
    const ttCount = Object.values(players).filter((p) => p.mode === 'ONLINE_TIMETRIAL' && p.playerId !== socketId).length;
    io.to('TIMETRIAL_ONLINE').emit('onlineCount', ttCount);
  }

  // Remove da lista global de jogadores
  delete players[socketId];

  // Emite atualização autoritativa para TODOS os clientes em tempo real
  io.emit('playerDisconnected', socketId);
  io.emit('roomList', getPublicRooms());
  io.emit('race:rooms_list', getPublicRooms());

  printServerDiagnostics();
}

// AUDITORIA AUTOMÁTICA DE INTEGRIDADE (A cada 10 segundos)
// Valida se o socket ainda existe, responde heartbeat e está ativo. Remove automaticamente fantasmas.
setInterval(() => {
  const now = Date.now();
  const TIMEOUT_MS = 15000;

  for (const [socketId, p] of Object.entries(players)) {
    const clientSocket = io.sockets.sockets.get(socketId);
    const lastActive = p.lastSeen || p.lastActive || p.connectedAt || now;
    const elapsed = now - lastActive;

    if (!clientSocket || !clientSocket.connected || elapsed > TIMEOUT_MS) {
      console.log(`[SERVER] Jogador expirado: ${p.playerName} ${p.kartNumber || ''} (${socketId}) - Inativo há ${(elapsed / 1000).toFixed(1)}s`);
      if (clientSocket) {
        try { clientSocket.disconnect(true); } catch (e) {}
      }
      removePlayerCompletely(socketId, 'inativo / timeout / desconectado');
      console.log(`[SERVER] Slot liberado`);
    }
  }

  // Logs periódicos [DEBUG] exigidos na auditoria
  const activePlayersList = Object.values(players).map(p => `- ${p.playerName} #${p.favoriteNumber || 17} (ID: ${p.socketId}) [Modo: ${p.mode || 'ONLINE'}]`);
  const activeRoomsList = Object.values(rooms).map(r => `- ${r.roomName} (${r.roomId}) - ${r.players.length}/${r.maxPlayers} pilotos`);

  console.log(`[DEBUG]\nPlayers ativos:\n${activePlayersList.length > 0 ? activePlayersList.join('\n') : 'Nenhum player ativo'}`);
  console.log(`[DEBUG]\nSalas ativas:\n${activeRoomsList.length > 0 ? activeRoomsList.join('\n') : 'Nenhuma sala ativa'}`);
}, 10000);

// ==========================================
// SOCKET.IO EVENTOS E SINCRONIZAÇÃO
// ==========================================
io.on('connection', (socket) => {
  console.log(`[SERVER] Cliente conectado: ${socket.id}`);

  // IMPORTANTE: NÃO criar jogador no 'players' ao conectar!
  // O registro de jogador é criado SOMENTE após confirmação de entrada em modo online

  // Envia histórico de salas e chat para visualização nos menus
  const publicRooms = getPublicRooms();
  socket.emit('roomList', publicRooms);
  socket.emit('race:rooms_list', publicRooms);
  socket.emit('chat:history', globalChatHistory.slice(-30));

  // Intercepta qualquer evento para atualizar o heartbeat de atividade
  socket.onAny(() => {
    if (players[socket.id]) {
      players[socket.id].lastActive = Date.now();
    }
  });

  // Heartbeat do Cliente (a cada 5s)
  socket.on('heartbeat', (data) => {
    if (players[socket.id]) {
      const now = Date.now();
      players[socket.id].lastSeen = now;
      players[socket.id].lastActive = now;
    }
  });

  // Ping / Latência
  socket.on('client:ping', (timestamp) => {
    socket.emit('server:pong', timestamp);
  });

  // Atualização de perfil
  socket.on('updatePlayerProfile', (data) => {
    if (players[socket.id] && data) {
      if (data.playerName) {
        players[socket.id].playerName = String(data.playerName).slice(0, 22).trim();
      }
      io.emit('playersUpdate', players);
      io.emit('players', players);
    }
  });

  // 1. SOLICITAÇÃO DE SALAS
  const sendRoomList = () => {
    const list = getPublicRooms();
    socket.emit('roomList', list);
    socket.emit('race:rooms_list', list);
  };
  socket.on('getRoomList', sendRoomList);
  socket.on('requestRoomList', sendRoomList);
  socket.on('roomList', sendRoomList);
  socket.on('race:list_rooms', sendRoomList);

  // 2. CRIAR SALA (createRoom com PERFIL OFICIAL E CONFIGURAÇÃO COMPLETA)
  const handleCreateRoom = (data = {}) => {
    const playerName = String(data.playerName || 'Piloto').slice(0, 22).trim() || 'Piloto';
    const rawFav = parseInt(String(data.favoriteNumber || data.kartNumber || '17').replace('#', ''), 10);
    const favNum = (rawFav >= 1 && rawFav <= 99) ? rawFav : 17;
    const favNumStr = `#${favNum < 10 ? '0' + favNum : favNum}`;

    const rawName = (data.roomName || data.name || `RA-KART-${Math.floor(100 + Math.random() * 900)}`).slice(0, 26).trim();
    const maxPlayers = Math.min(5, Math.max(2, parseInt(data.maxPlayers, 10) || 5));
    const totalLaps = [1, 3, 5, 10, 15, 20].includes(Number(data.totalLaps)) ? Number(data.totalLaps) : 5;
    const weather = ['indoor', 'indoor_night', 'indoor_dim'].includes(data.weather) ? data.weather : 'indoor';
    const collisionEnabled = data.collisionEnabled !== false;
    const hasQualifying = Boolean(data.hasQualifying);
    const qualifyingMinutes = [1, 3, 5, 10].includes(Number(data.qualifyingMinutes)) ? Number(data.qualifyingMinutes) : 3;
    const password = (data.password || '').trim();
    const kartWeight = Math.min(150, Math.max(40, Number(data.kartWeight) || 80));

    const roomId = `RA-KART-${Math.floor(100 + Math.random() * 900)}`;
    console.log(`[SERVER] createRoom recebido: ${roomId} por ${socket.id} (${playerName} ${favNumStr})`);

    const roomConfig = {
      roomName: rawName,
      maxPlayers,
      totalLaps,
      weather,
      collisionEnabled,
      hasQualifying,
      qualifyingMinutes,
      password
    };

    const hostPlayer = {
      socketId: socket.id,
      id: socket.id,
      playerId: socket.id,
      playerName,
      favoriteNumber: favNum,
      kartNumber: favNumStr,
      gridSlot: 'P1',
      kartWeight,
      avatar: data.avatar || '🏎️',
      mode: 'ONLINE_RACE',
      roomId: roomId,
      isHost: true,
      isReady: true,
      position: { x: 0, y: 0, z: 0 },
      rotation: { heading: 0, steerAngle: 0 },
      speed: 0,
      currentLap: 1,
      bestLap: null,
      lastSeen: Date.now(),
      lastActive: Date.now(),
      connectedAt: Date.now()
    };

    const room = {
      roomId,
      roomName: rawName,
      hostId: socket.id,
      maxPlayers,
      password,
      config: roomConfig,
      status: 'WAITING',
      players: [hostPlayer],
      chatMessages: [],
      qualiLeaderboard: new Map(),
      qualiTimeRemaining: 0,
      gridOrder: [],
      finishedPlayers: []
    };

    rooms[roomId] = room;
    players[socket.id] = hostPlayer;

    socket.join(roomId);

    const roomPayload = {
      roomId,
      roomName: rawName,
      hostId: socket.id,
      maxPlayers,
      isHost: true,
      myKartNumber: favNumStr,
      kartNumber: favNumStr,
      favoriteNumber: favNum,
      gridSlot: 'P1',
      config: roomConfig,
      players: room.players
    };

    socket.emit('roomCreated', roomPayload);
    socket.emit('race:room_created', { room: roomPayload });

    const updatedRooms = getPublicRooms();
    io.emit('roomList', updatedRooms);
    io.emit('race:rooms_list', updatedRooms);
  };
  socket.on('createRoom', handleCreateRoom);
  socket.on('race:create_room', handleCreateRoom);

  // 2.1 ATUALIZAÇÃO DE CONFIGURAÇÃO DA SALA PELO HOST
  socket.on('room:update_config', (newConfig = {}) => {
    const pInfo = players[socket.id];
    if (!pInfo || !pInfo.roomId) return;
    const room = rooms[pInfo.roomId];
    if (!room || room.hostId !== socket.id) return;

    if (newConfig.totalLaps && [1, 3, 5, 10, 15, 20].includes(Number(newConfig.totalLaps))) {
      room.config.totalLaps = Number(newConfig.totalLaps);
    }
    if (newConfig.weather && ['indoor', 'indoor_night', 'indoor_dim'].includes(newConfig.weather)) {
      room.config.weather = newConfig.weather;
    }
    if (typeof newConfig.collisionEnabled === 'boolean') {
      room.config.collisionEnabled = newConfig.collisionEnabled;
    }
    if (typeof newConfig.hasQualifying === 'boolean') {
      room.config.hasQualifying = newConfig.hasQualifying;
    }
    if (newConfig.qualifyingMinutes && [1, 3, 5, 10].includes(Number(newConfig.qualifyingMinutes))) {
      room.config.qualifyingMinutes = Number(newConfig.qualifyingMinutes);
    }

    console.log(`[SERVER] Configuração da sala ${room.roomId} atualizada pelo Host:`, room.config);

    io.to(room.roomId).emit('roomConfigUpdated', {
      roomId: room.roomId,
      config: room.config
    });
    io.emit('roomList', getPublicRooms());
  });

  // 3. ENTRAR EM SALA (joinRoom com PERFIL OFICIAL)
  const handleJoinRoom = (data = {}) => {
    const roomId = data.roomId || data.id;
    const playerName = String(data.playerName || 'Piloto').slice(0, 22).trim() || 'Piloto';
    const rawFav = parseInt(String(data.favoriteNumber || data.kartNumber || '17').replace('#', ''), 10);
    const favNum = (rawFav >= 1 && rawFav <= 99) ? rawFav : 17;
    const favNumStr = `#${favNum < 10 ? '0' + favNum : favNum}`;
    const password = (data.password || '').trim();
    const kartWeight = Math.min(150, Math.max(40, Number(data.kartWeight) || 80));

    console.log(`[SERVER] joinRoom recebido: ${roomId} por ${socket.id} (${playerName} ${favNumStr})`);

    const room = rooms[roomId];
    if (!room) {
      socket.emit('roomError', { message: 'Sala não encontrada.' });
      return;
    }
    if (room.status !== 'WAITING') {
      socket.emit('roomError', { message: 'A sessão já foi iniciada nesta sala.' });
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      socket.emit('roomError', { message: 'Sala cheia. Limite de jogadores atingido.' });
      return;
    }
    if (room.password && room.password !== password) {
      socket.emit('roomError', { message: 'Senha incorreta para esta sala.' });
      return;
    }

    const gridSlot = `P${room.players.length + 1}`;
    const newPlayer = {
      socketId: socket.id,
      id: socket.id,
      playerId: socket.id,
      playerName,
      favoriteNumber: favNum,
      kartNumber: favNumStr,
      gridSlot,
      kartWeight,
      avatar: data.avatar || '🏎️',
      mode: 'ONLINE_RACE',
      roomId: roomId,
      isHost: false,
      isReady: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { heading: 0, steerAngle: 0 },
      speed: 0,
      currentLap: 1,
      bestLap: null,
      lastSeen: Date.now(),
      lastActive: Date.now(),
      connectedAt: Date.now()
    };

    room.players.push(newPlayer);
    players[socket.id] = newPlayer;

    socket.join(roomId);

    const roomPayload = {
      roomId: room.roomId,
      roomName: room.roomName,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      isHost: false,
      myKartNumber: favNumStr,
      kartNumber: favNumStr,
      favoriteNumber: favNum,
      gridSlot,
      config: room.config,
      players: room.players
    };

    socket.emit('roomJoined', roomPayload);
    socket.emit('playerJoined', { player: newPlayer, room: roomPayload, isSelf: true });

    console.log(`[SERVER] emit playerJoined: ${socket.id} (${playerName} ${favNumStr}) na sala ${roomId}`);
    socket.to(roomId).emit('playerJoined', { player: newPlayer, room: roomPayload, isSelf: false });

    io.emit('roomList', getPublicRooms());
    io.emit('race:rooms_list', getPublicRooms());
  };
  socket.on('joinRoom', handleJoinRoom);
  socket.on('race:join_room', handleJoinRoom);

  // 4. STATUS PRONTO (playerReady)
  socket.on('playerReady', () => {
    const pInfo = players[socket.id];
    if (!pInfo || !pInfo.roomId) return;
    const room = rooms[pInfo.roomId];
    if (!room) return;

    const player = room.players.find((p) => p.playerId === socket.id);
    if (!player) return;

    player.isReady = !player.isReady;
    console.log(`[SERVER] playerReady: ${player.playerName} = ${player.isReady} na sala ${room.roomName}`);

    const payload = {
      playerId: socket.id,
      isReady: player.isReady,
      players: room.players
    };
    io.to(room.roomId).emit('playerReady', payload);
  });

  // 5. INICIAR SESSÃO: QUALIFICAÇÃO OU CORRIDA DIRETA
  const handleStartSession = () => {
    const pInfo = players[socket.id];
    if (!pInfo || !pInfo.roomId) return;
    const room = rooms[pInfo.roomId];
    if (!room || room.hostId !== socket.id) return;

    if (room.players.length < 2) {
      socket.emit('roomError', { message: 'Mínimo de 2 jogadores necessário para iniciar.' });
      return;
    }

    const allReady = room.players.every((p) => p.isReady);
    if (!allReady) {
      socket.emit('roomError', { message: 'Todos os pilotos devem estar PRONTOS para iniciar!' });
      return;
    }

    // Se a sala tem qualificação ativada: inicia sessão de quali
    if (room.config && room.config.hasQualifying) {
      room.status = 'QUALIFYING';
      const durationSeconds = (room.config.qualifyingMinutes || 3) * 60;
      room.qualiTimeRemaining = durationSeconds;
      room.qualiLeaderboard = new Map();

      console.log(`[SERVER] Qualificação iniciada na sala ${room.roomName}! Duração: ${durationSeconds}s`);

      io.to(room.roomId).emit('qualifyingStarted', {
        roomId: room.roomId,
        roomName: room.roomName,
        durationSeconds,
        config: room.config,
        players: room.players
      });

      if (room.qualiInterval) clearInterval(room.qualiInterval);
      room.qualiInterval = setInterval(() => {
        room.qualiTimeRemaining -= 1;
        io.to(room.roomId).emit('qualifyingTick', {
          remainingSeconds: Math.max(0, room.qualiTimeRemaining)
        });

        if (room.qualiTimeRemaining <= 0) {
          clearInterval(room.qualiInterval);
          finishQualifyingSession(room);
        }
      }, 1000);
    } else {
      // Sem quali: gera grid direto
      setupAndStartRace(room);
    }

    io.emit('roomList', getPublicRooms());
  };
  socket.on('startRace', handleStartSession);
  socket.on('raceStart', handleStartSession);
  socket.on('race:start_countdown', handleStartSession);

  // 5.1 ENVIO DE VOLTA DE QUALIFICAÇÃO OU CORRIDA (session:lap_time)
  socket.on('session:lap_time', (data = {}) => {
    const pInfo = players[socket.id];
    if (!pInfo || !pInfo.roomId) return;
    const room = rooms[pInfo.roomId];
    if (!room) return;

    const lapMs = Math.round(Number(data.lapTimeMs) || 0);
    const isValid = Boolean(data.isValid);

    if (isValid && lapMs > 15000 && lapMs < 120000) {
      if (room.status === 'QUALIFYING') {
        const existing = room.qualiLeaderboard.get(socket.id);
        if (!existing || lapMs < existing.bestLapMs) {
          room.qualiLeaderboard.set(socket.id, {
            playerId: socket.id,
            playerName: pInfo.playerName,
            kartNumber: pInfo.kartNumber,
            bestLapMs: lapMs
          });

          // Transmite leaderboard da quali ordenado
          const sortedQuali = Array.from(room.qualiLeaderboard.values()).sort(
            (a, b) => a.bestLapMs - b.bestLapMs
          );
          io.to(room.roomId).emit('qualifyingLeaderboard', sortedQuali);
        }
      }

      // Registra recorde geral no Top 100 Global
      if (lapMs <= 26000) {
        const rec = {
          nome: pInfo.playerName,
          peso: pInfo.kartWeight || 80,
          melhorVolta: lapMs,
          data: new Date().toLocaleDateString('pt-BR'),
          modo: room.status === 'QUALIFYING' ? 'QUALIFICAÇÃO' : 'CORRIDA'
        };
        globalRecords.push(rec);
        globalRecords.sort((a, b) => a.melhorVolta - b.melhorVolta);
        if (globalRecords.length > 100) globalRecords.length = 100;
        savePersistentRecords(globalRecords);
      }
    }
  });

  // Finaliza a sessão de qualificação e monta o grid
  function finishQualifyingSession(room) {
    if (room.qualiInterval) clearInterval(room.qualiInterval);
    room.status = 'GRID_DEFINED';

    const ranked = Array.from(room.qualiLeaderboard.values()).sort(
      (a, b) => a.bestLapMs - b.bestLapMs
    );

    // Pilotos que não completaram volta válida ficam nas posições finais
    const unranked = room.players.filter(
      (p) => !ranked.some((r) => r.playerId === p.playerId)
    );

    const finalGrid = [];
    ranked.forEach((r, idx) => {
      finalGrid.push({
        positionLabel: `P${idx + 1}`,
        position: idx + 1,
        playerId: r.playerId,
        playerName: r.playerName,
        kartNumber: r.kartNumber,
        bestLapMs: r.bestLapMs
      });
    });

    unranked.forEach((u, idx) => {
      const pos = ranked.length + idx + 1;
      finalGrid.push({
        positionLabel: `P${pos}`,
        position: pos,
        playerId: u.playerId,
        playerName: u.playerName,
        kartNumber: u.kartNumber,
        bestLapMs: null
      });
    });

    room.gridOrder = finalGrid;
    console.log(`[SERVER] GRID DEFINIDO na sala ${room.roomName}:`, finalGrid);

    io.to(room.roomId).emit('gridDefined', {
      roomId: room.roomId,
      roomName: room.roomName,
      grid: finalGrid,
      config: room.config
    });

    // Registra Pole Position nas estatísticas
    if (finalGrid.length > 0 && finalGrid[0].bestLapMs) {
      const poleDriver = finalGrid[0].playerName;
      if (globalStatistics[poleDriver]) {
        globalStatistics[poleDriver].poles = (globalStatistics[poleDriver].poles || 0) + 1;
        savePersistentStats(globalStatistics);
      }
    }
  }

  // 5.2 DISPARAR CORRIDA A PARTIR DO GRID DEFINIDO
  socket.on('startRaceFromGrid', () => {
    const pInfo = players[socket.id];
    if (!pInfo || !pInfo.roomId) return;
    const room = rooms[pInfo.roomId];
    if (!room || room.hostId !== socket.id) return;
    setupAndStartRace(room);
  });

  function setupAndStartRace(room) {
    room.status = 'COUNTDOWN';
    console.log(`[SERVER] Iniciando contagem regressiva sincronizada na sala ${room.roomName}!`);

    // Atribui posições de largada conforme grid
    if (!room.gridOrder || room.gridOrder.length === 0) {
      room.gridOrder = room.players.map((p, idx) => ({
        positionLabel: `P${idx + 1}`,
        position: idx + 1,
        playerId: p.playerId,
        playerName: p.playerName,
        kartNumber: p.kartNumber,
        bestLapMs: null
      }));
    }

    io.to(room.roomId).emit('racePreGrid', {
      roomId: room.roomId,
      grid: room.gridOrder,
      config: room.config
    });

    // Contagem Regressiva Autoritativa Sincronizada: 3 -> 2 -> 1 -> GO!
    const countdownSteps = [
      { delay: 400, count: 3, text: '3' },
      { delay: 1400, count: 2, text: '2' },
      { delay: 2400, count: 1, text: '1' },
      { delay: 3400, count: 0, text: 'GO!' }
    ];

    countdownSteps.forEach((step) => {
      setTimeout(() => {
        io.to(room.roomId).emit('raceCountdownTick', {
          count: step.count,
          text: step.text
        });

        if (step.count === 0) {
          room.status = 'RACING';
          room.finishedPlayers = [];
          io.to(room.roomId).emit('raceStarted', {
            roomId: room.roomId,
            roomName: room.roomName,
            config: room.config,
            grid: room.gridOrder
          });
        }
      }, step.delay);
    });
  }

  // 5.3 CONCLUSÃO DA CORRIDA E BANDEIRADA
  socket.on('race:player_finish', (data = {}) => {
    const pInfo = players[socket.id];
    if (!pInfo || !pInfo.roomId) return;
    const room = rooms[pInfo.roomId];
    if (!room || room.status !== 'RACING') return;

    if (!room.finishedPlayers.some((p) => p.playerId === socket.id)) {
      const finishPos = room.finishedPlayers.length + 1;
      const finishEntry = {
        position: finishPos,
        playerId: socket.id,
        playerName: pInfo.playerName,
        kartNumber: pInfo.kartNumber,
        bestLapMs: data.bestLapMs || null,
        totalTimeMs: data.totalTimeMs || null,
        status: 'FINISHED'
      };
      room.finishedPlayers.push(finishEntry);

      console.log(`[SERVER] Piloto completou a corrida: ${finishPos}º ${pInfo.playerName} (${pInfo.kartNumber})`);

      io.to(room.roomId).emit('playerFinishedRace', finishEntry);

      // 1. O PRIMEIRO JOGADOR COMPLETA TODAS AS VOLTAS (Líder finalizou)
      if (room.finishedPlayers.length === 1) {
        console.log(`[SERVER] 🏁 Líder finalizou na sala ${room.roomName}! Iniciando contagem regressiva de 30s.`);
        room.finishCountdown = 30;
        io.to(room.roomId).emit('race:leader_finished', {
          leaderName: pInfo.playerName,
          remainingSeconds: 30
        });

        if (room.finishCountdownInterval) clearInterval(room.finishCountdownInterval);
        room.finishCountdownInterval = setInterval(() => {
          if (!rooms[room.roomId]) {
            clearInterval(room.finishCountdownInterval);
            return;
          }
          room.finishCountdown -= 1;
          io.to(room.roomId).emit('race:finish_countdown_tick', {
            remainingSeconds: Math.max(0, room.finishCountdown)
          });

          if (room.finishCountdown <= 0) {
            clearInterval(room.finishCountdownInterval);
            room.finishCountdownInterval = null;
            concludeRace(room);
          }
        }, 1000);
      }

      // Se todos os jogadores completaram a corrida:
      if (room.finishedPlayers.length >= room.players.length) {
        if (room.finishCountdownInterval) {
          clearInterval(room.finishCountdownInterval);
          room.finishCountdownInterval = null;
        }
        concludeRace(room);
      }
    }
  });

  // Função centralizada para finalização da corrida, montagem de resultados e retorno ao lobby
  function concludeRace(room) {
    if (room.status === 'FINISHED') return;
    room.status = 'FINISHED';
    if (room.finishCountdownInterval) {
      clearInterval(room.finishCountdownInterval);
      room.finishCountdownInterval = null;
    }

    console.log(`[SERVER] Corrida finalizada na sala ${room.roomName}! Montando resultados oficiais...`);

    const leaderEntry = room.finishedPlayers[0];
    const leaderTimeMs = leaderEntry ? leaderEntry.totalTimeMs : 0;

    const finalResults = [];
    room.finishedPlayers.forEach((fp, idx) => {
      const deltaMs = (idx === 0 || !fp.totalTimeMs || !leaderTimeMs)
        ? 0
        : Math.max(0, fp.totalTimeMs - leaderTimeMs);
      finalResults.push({
        position: idx + 1,
        playerId: fp.playerId,
        playerName: fp.playerName,
        kartNumber: fp.kartNumber,
        bestLapMs: fp.bestLapMs,
        totalTimeMs: fp.totalTimeMs,
        deltaMs: deltaMs,
        deltaFormatted: idx === 0 ? 'LÍDER' : `+${(deltaMs / 1000).toFixed(3)}s`,
        status: 'FINISHED'
      });
    });

    // Quem não finalizou a tempo recebe status DNF
    const finishedIds = new Set(room.finishedPlayers.map((p) => p.playerId));
    let nextPos = finalResults.length + 1;
    room.players.forEach((p) => {
      if (!finishedIds.has(p.playerId)) {
        finalResults.push({
          position: nextPos++,
          playerId: p.playerId,
          playerName: p.playerName,
          kartNumber: p.kartNumber,
          bestLapMs: p.bestLap || null,
          totalTimeMs: null,
          deltaMs: null,
          deltaFormatted: 'DNF',
          status: 'DNF'
        });
      }
    });

    // Encontra a melhor volta geral da corrida
    let bestLapOverall = null;
    finalResults.forEach((r) => {
      if (r.bestLapMs && (!bestLapOverall || r.bestLapMs < bestLapOverall.bestLapMs)) {
        bestLapOverall = {
          playerName: r.playerName,
          bestLapMs: r.bestLapMs
        };
      }
    });

    const poleWinner = (room.gridOrder && room.gridOrder[0]) ? room.gridOrder[0].playerName : null;
    recordRaceStatistics(finalResults, poleWinner);

    io.to(room.roomId).emit('raceAllFinished', {
      roomId: room.roomId,
      roomName: room.roomName,
      totalLaps: room.config ? room.config.totalLaps : 5,
      results: finalResults,
      bestLapOverall
    });

    // 6. Aguarda 10 segundos na tela de resultados
    // 7. Retorna todos os jogadores automaticamente para o Lobby da sala (mantendo a sala e jogadores intactos)
    setTimeout(() => {
      if (!rooms[room.roomId]) return;
      console.log(`[SERVER] Retornando todos os jogadores ao lobby da sala ${room.roomName}...`);
      room.status = 'WAITING';
      room.finishedPlayers = [];
      room.gridOrder = [];
      room.players.forEach((p) => {
        p.isReady = false;
        p.currentLap = 1;
      });

      io.to(room.roomId).emit('race:return_to_lobby', {
        roomId: room.roomId,
        roomName: room.roomName,
        hostId: room.hostId,
        players: room.players,
        config: room.config
      });

      io.emit('roomList', getPublicRooms());
      io.emit('race:rooms_list', getPublicRooms());
    }, 10000);
  }

  // 6. SINCRONIZAÇÃO DE TELEMETRIA (playerState / playerUpdate a 20 Hz)
  const handlePlayerState = (state = {}) => {
    const pInfo = players[socket.id];
    if (!pInfo) return;

    const kartNum = pInfo.kartNumber || state.kartNumber || '#1';
    state.id = socket.id;
    state.playerId = socket.id;
    state.socketId = socket.id;
    state.playerName = state.playerName || pInfo.playerName;
    state.kartNumber = kartNum;

    if (typeof state.speed === 'number') {
      state.speed = Math.min(105, Math.max(0, state.speed));
    }

    Object.assign(pInfo, state);

    if (pInfo.roomId && rooms[pInfo.roomId]) {
      const room = rooms[pInfo.roomId];
      const regPlayer = room.players.find((p) => p.playerId === socket.id);
      if (regPlayer) {
        Object.assign(regPlayer, state);
      }
      socket.to(room.roomId).emit('playerState', state);
      socket.to(room.roomId).emit('playerUpdate', state);
    } else if (pInfo.roomId === 'TIMETRIAL_ONLINE' || pInfo.mode === 'ONLINE_TIMETRIAL') {
      socket.to('TIMETRIAL_ONLINE').emit('playerState', state);
      socket.to('TIMETRIAL_ONLINE').emit('playerUpdate', state);
    }
  };
  socket.on('playerState', handlePlayerState);
  socket.on('playerUpdate', handlePlayerState);
  socket.on('race:state', handlePlayerState);
  socket.on('timetrial:state', handlePlayerState);

  // 7. CHAT EM TEMPO REAL (Máximo 120 caracteres, anti-spam, filtro de vazios)
  socket.on('chat:send', (data = {}) => {
    const pInfo = players[socket.id];
    const rawMsg = String(data.message || '').trim().slice(0, 120);
    if (!rawMsg) return; // Impede envio de mensagens vazias

    // Filtro anti-spam: limite de frequência e repetição
    const now = Date.now();
    if (pInfo) {
      if (pInfo.lastChatTime && (now - pInfo.lastChatTime < 400)) {
        return; // Taxa rápida ignorada
      }
      if (pInfo.lastChatMsg === rawMsg && (now - pInfo.lastChatTime < 2500)) {
        return; // Duplicada consecutiva ignorada
      }
      pInfo.lastChatTime = now;
      pInfo.lastChatMsg = rawMsg;
    }

    const senderName = (pInfo && pInfo.playerName) || data.playerName || 'Piloto';
    const kartNum = (pInfo && pInfo.kartNumber) || '#1';
    const isHost = Boolean(pInfo && pInfo.isHost);

    const chatMsg = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      senderName,
      playerName: senderName,
      playerId: socket.id,
      kartNumber: kartNum,
      message: rawMsg,
      isHost,
      timestamp: Date.now()
    };

    globalChatHistory.push(chatMsg);
    if (globalChatHistory.length > 30) globalChatHistory.shift();

    if (pInfo && pInfo.roomId) {
      io.to(pInfo.roomId).emit('chat:message', chatMsg);
    } else {
      io.emit('chat:message', chatMsg);
    }
  });

  // 8. SAÍDA DE SALA (leaveRoom)
  const handleLeaveRoom = () => {
    removePlayerCompletely(socket.id, 'saída de sala');
  };
  socket.on('leaveRoom', handleLeaveRoom);
  socket.on('race:leave', handleLeaveRoom);

  // 9. DESCONEXÃO (disconnecting e disconnect)
  socket.on('disconnecting', () => {
    removePlayerCompletely(socket.id, 'disconnecting / aba fechada');
  });

  socket.on('disconnect', () => {
    removePlayerCompletely(socket.id, 'desconexão');
  });

  // Time Trial Online - Entrada e Saída
  socket.on('timetrial:join', (data = {}) => {
    const cleanName = String(data.playerName || 'Piloto').slice(0, 22).trim() || 'Piloto';
    const rawFav = parseInt(String(data.favoriteNumber || data.kartNumber || '17').replace('#', ''), 10);
    const favNum = (rawFav >= 1 && rawFav <= 99) ? rawFav : 17;
    const favNumStr = `#${favNum < 10 ? '0' + favNum : favNum}`;
    const kartWeight = Math.max(40, Math.min(150, Number(data.kartWeight) || 80));

    const playerObj = {
      socketId: socket.id,
      id: socket.id,
      playerId: socket.id,
      playerName: cleanName,
      favoriteNumber: favNum,
      kartNumber: favNumStr,
      kartWeight,
      avatar: data.avatar || '🏎️',
      mode: 'ONLINE_TIMETRIAL',
      roomId: 'TIMETRIAL_ONLINE',
      isHost: false,
      isReady: true,
      position: { x: 0, y: 0, z: 0 },
      rotation: { heading: 0, steerAngle: 0 },
      speed: 0,
      currentLap: 1,
      bestLap: null,
      lastSeen: Date.now(),
      lastActive: Date.now(),
      connectedAt: Date.now()
    };

    players[socket.id] = playerObj;
    socket.join('TIMETRIAL_ONLINE');

    console.log(`[SERVER] Piloto cadastrado no Time Trial Online: ${cleanName} ${favNumStr} (${socket.id})`);

    socket.emit('playerAssigned', playerObj);
    socket.emit('timetrial:joined', playerObj);

    // Envia ao novo jogador APENAS os pilotos que já estavam no Time Trial Online (excluindo ele mesmo)
    const existingTT = Object.values(players).filter((p) => p.mode === 'ONLINE_TIMETRIAL' && p.playerId !== socket.id);
    socket.emit('playersUpdate', existingTT);

    // Transmite para os outros pilotos da sala que este jogador entrou
    socket.to('TIMETRIAL_ONLINE').emit('playerJoined', playerObj);

    // Atualiza contagem online de Time Trial
    const totalTT = Object.values(players).filter((p) => p.mode === 'ONLINE_TIMETRIAL').length;
    io.to('TIMETRIAL_ONLINE').emit('onlineCount', totalTT);
  });

  socket.on('timetrial:leave', () => {
    if (players[socket.id] && players[socket.id].mode === 'ONLINE_TIMETRIAL') {
      const p = players[socket.id];
      console.log(`[SERVER] Piloto saiu do Time Trial: ${p.playerName} (${socket.id})`);
      socket.leave('TIMETRIAL_ONLINE');
      delete players[socket.id];
      socket.to('TIMETRIAL_ONLINE').emit('playerLeft', { playerId: socket.id, playerName: p.playerName });
      const totalTT = Object.values(players).filter((x) => x.mode === 'ONLINE_TIMETRIAL').length;
      io.to('TIMETRIAL_ONLINE').emit('onlineCount', totalTT);
    }
  });

  socket.on('timetrial:lap_record', (data) => {
    const pInfo = players[socket.id];
    if (pInfo && data && data.bestLap) {
      const bestLap = Math.round(data.bestLap);
      pInfo.bestLap = bestLap;
      io.emit('timetrial:leaderboard_update', {
        playerId: socket.id,
        playerName: pInfo.playerName,
        bestLap
      });

      if (bestLap > 15000 && bestLap <= 26000) {
        const rec = {
          nome: pInfo.playerName,
          peso: pInfo.kartWeight || 80,
          melhorVolta: bestLap,
          data: new Date().toLocaleDateString('pt-BR'),
          modo: 'TIME TRIAL ONLINE'
        };
        globalRecords.push(rec);
        globalRecords.sort((a, b) => a.melhorVolta - b.melhorVolta);
        if (globalRecords.length > 100) globalRecords.length = 100;
        savePersistentRecords(globalRecords);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`[SERVER] RA Kart Indoor Multiplayer Ativo na porta ${PORT}`);
  console.log(`[SERVER] URL Oficial: https://ra-kart-server.onrender.com`);
  console.log(`[SERVER] Top Recordes Carregados: ${globalRecords.length}`);
  console.log(`====================================================`);
});
