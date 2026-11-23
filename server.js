/**
 * ============================================================================
 * RA KART INDOOR — SERVIDOR MULTIPLAYER OFICIAL (NODE.JS + SOCKET.IO)
 * Compatível com Render.com, Cloudflare Pages e Node.js
 * URL Oficial: https://ra-kart-server.onrender.com
 * 
 * AUDITORIA E LOGS EXATOS DE SINCRONIZAÇÃO:
 *   [SERVER] Cliente conectado: <id>
 *   [SERVER] Cliente desconectado: <id>
 *   [SERVER] emit playerAssigned: <id> (<kartNumber>)
 *   [SERVER] emit playersUpdate: <total> pilotos online
 *   [SERVER] emit roomList: <total> salas
 *   [SERVER] createRoom recebido: <roomId> por <id>
 *   [SERVER] joinRoom recebido: <roomId> por <id>
 *   [SERVER] emit playerJoined: <id> (<kartNumber>) na sala <roomId>
 *   [SERVER] playerState recebido: <id> (<kartNumber>)
 *   [SERVER] emit playerState para: <destinatário>
 * 
 * ENDPOINTS HTTP:
 *   GET /       -> Health check status
 *   GET /debug  -> JSON com estado completo de players e rooms
 * ============================================================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// Middleware CORS universal sem dependência externa
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
// ESTADO EM MEMÓRIA CENTRAL DO SERVIDOR
// ==========================================
const rooms = {};
const players = {};

// 1. ENDPOINT DE HEALTH CHECK
app.get('/', (req, res) => {
  res.json({
    status: 'ONLINE',
    game: 'RA Kart Indoor Simulator',
    serverTime: new Date().toISOString(),
    playerCount: Object.keys(players).length,
    roomCount: Object.keys(rooms).length
  });
});

// 2. ENDPOINT TEMPORÁRIO DE DIAGNÓSTICO E AUDITORIA (GET /debug)
app.get('/debug', (req, res) => {
  res.json({
    playerCount: Object.keys(players).length,
    roomCount: Object.keys(rooms).length,
    players,
    rooms,
    timestamp: new Date().toISOString()
  });
});

/**
 * Retorna lista formatada de salas ativas
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
      hasPassword: Boolean(r.password),
      status: r.status,
      players: r.players.map((p) => ({
        playerId: p.playerId,
        id: p.playerId,
        playerName: p.playerName,
        kartNumber: p.kartNumber,
        numberInt: p.numberInt,
        isHost: p.isHost,
        isReady: p.isReady
      }))
    };
  });
}

/**
 * Aloca o próximo número único global (#1 a #5)
 */
function allocateGlobalKartNumber() {
  const used = new Set(Object.values(players).map((p) => p.numberInt).filter(Boolean));
  for (let i = 1; i <= 5; i++) {
    if (!used.has(i)) return i;
  }
  return Object.keys(players).length + 1;
}

/**
 * Aloca o próximo número de kart dentro de uma sala (#1 para host, #2 a #5 para os demais)
 */
function allocateRoomKartNumber(room, isHost = false) {
  if (isHost && !room.usedNumbers.includes(1)) {
    room.usedNumbers.push(1);
    return 1;
  }
  for (let n = 1; n <= room.maxPlayers; n++) {
    if (!room.usedNumbers.includes(n)) {
      room.usedNumbers.push(n);
      return n;
    }
  }
  const fallback = room.players.length + 1;
  room.usedNumbers.push(fallback);
  return fallback;
}

function releaseRoomKartNumber(room, numInt) {
  if (room && numInt) {
    const idx = room.usedNumbers.indexOf(numInt);
    if (idx !== -1) {
      room.usedNumbers.splice(idx, 1);
    }
  }
}

// ==========================================
// CICLO DE CONEXÃO SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
  console.log(`[SERVER] Cliente conectado: ${socket.id}`);

  // Atribuição de número autoritativo único do servidor
  const numInt = allocateGlobalKartNumber();
  const kartNumberStr = `#${numInt}`;

  const playerObj = {
    socketId: socket.id,
    id: socket.id,
    playerId: socket.id,
    kartNumber: kartNumberStr,
    numberInt: numInt,
    playerName: `Piloto ${numInt}`,
    roomId: null,
    isHost: false,
    isReady: false,
    position: { x: 0, y: 0, z: 0 },
    rotation: { heading: 0, steerAngle: 0 },
    speed: 0,
    currentLap: 1,
    bestLap: null
  };
  players[socket.id] = playerObj;

  console.log(`[SERVER] emit playerAssigned: ${socket.id} (${kartNumberStr})`);
  socket.emit('playerAssigned', playerObj);

  // Transmissão da lista atualizada de jogadores para todos os clientes
  const totalPlayers = Object.keys(players).length;
  console.log(`[SERVER] emit playersUpdate: ${totalPlayers} pilotos online`);
  io.emit('playersUpdate', players);
  io.emit('players', players); // compatibilidade retroativa

  // Envio imediato da lista de salas
  const publicRooms = getPublicRooms();
  console.log(`[SERVER] emit roomList: ${publicRooms.length} salas`);
  socket.emit('roomList', publicRooms);
  socket.emit('race:rooms_list', publicRooms);

  // Ping / Latência
  socket.on('client:ping', (timestamp) => {
    socket.emit('server:pong', timestamp);
  });

  // Atualização de perfil do piloto
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
    console.log(`[SERVER] emit roomList: ${list.length} salas para ${socket.id}`);
    socket.emit('roomList', list);
    socket.emit('race:rooms_list', list);
  };
  socket.on('getRoomList', sendRoomList);
  socket.on('requestRoomList', sendRoomList);
  socket.on('roomList', sendRoomList);
  socket.on('race:list_rooms', sendRoomList);

  // 2. CRIAR SALA (createRoom)
  const handleCreateRoom = (data = {}) => {
    const playerName = (data.playerName || players[socket.id].playerName || 'Piloto').slice(0, 22).trim();
    const rawName = (data.roomName || data.name || `RA-KART-${Math.floor(100 + Math.random() * 900)}`).slice(0, 26).trim();
    const maxPlayers = Math.min(5, Math.max(2, parseInt(data.maxPlayers, 10) || 5));
    const password = (data.password || '').trim();
    const kartWeight = Math.min(150, Math.max(40, Number(data.kartWeight) || 80));

    const roomId = `RA-KART-${Math.floor(100 + Math.random() * 900)}`;
    console.log(`[SERVER] createRoom recebido: ${roomId} por ${socket.id} (${playerName})`);

    const room = {
      roomId,
      roomName: rawName,
      hostId: socket.id,
      maxPlayers,
      password,
      status: 'WAITING',
      players: [],
      usedNumbers: []
    };

    // Host da sala recebe #1
    const hostNumberInt = allocateRoomKartNumber(room, true);
    const hostNumberStr = `#${hostNumberInt}`;

    const hostPlayer = {
      socketId: socket.id,
      id: socket.id,
      playerId: socket.id,
      playerName,
      kartNumber: hostNumberStr,
      numberInt: hostNumberInt,
      kartWeight,
      isHost: true,
      isReady: true,
      position: { x: 0, y: 0, z: 0 },
      rotation: { heading: 0, steerAngle: 0 },
      speed: 0,
      currentLap: 1,
      bestLap: null
    };

    room.players.push(hostPlayer);
    rooms[roomId] = room;

    players[socket.id].roomId = roomId;
    players[socket.id].kartNumber = hostNumberStr;
    players[socket.id].numberInt = hostNumberInt;
    players[socket.id].playerName = playerName;
    players[socket.id].isHost = true;

    socket.join(roomId);

    const roomPayload = {
      roomId,
      roomName: rawName,
      hostId: socket.id,
      maxPlayers,
      isHost: true,
      myKartNumber: hostNumberStr,
      kartNumber: hostNumberStr,
      players: room.players
    };

    socket.emit('roomCreated', roomPayload);
    socket.emit('race:room_created', { room: roomPayload });

    const updatedRooms = getPublicRooms();
    console.log(`[SERVER] emit roomList: ${updatedRooms.length} salas`);
    io.emit('roomList', updatedRooms);
    io.emit('race:rooms_list', updatedRooms);

    console.log(`[SERVER] emit playersUpdate: ${Object.keys(players).length} pilotos`);
    io.emit('playersUpdate', players);
    io.emit('players', players);
  };
  socket.on('createRoom', handleCreateRoom);
  socket.on('race:create_room', handleCreateRoom);

  // 3. ENTRAR EM SALA (joinRoom)
  const handleJoinRoom = (data = {}) => {
    const roomId = data.roomId || data.id;
    const playerName = (data.playerName || players[socket.id].playerName || 'Piloto').slice(0, 22).trim();
    const password = (data.password || '').trim();
    const kartWeight = Math.min(150, Math.max(40, Number(data.kartWeight) || 80));

    console.log(`[SERVER] joinRoom recebido: ${roomId} por ${socket.id} (${playerName})`);

    const room = rooms[roomId];
    if (!room) {
      socket.emit('roomError', { message: 'Sala não encontrada.' });
      return;
    }
    if (room.status !== 'WAITING') {
      socket.emit('roomError', { message: 'A corrida já foi iniciada nesta sala.' });
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

    // Atribui número exclusivo (#2, #3, #4, #5 sem repetição)
    const assignedNumberInt = allocateRoomKartNumber(room, false);
    const assignedNumberStr = `#${assignedNumberInt}`;

    const newPlayer = {
      socketId: socket.id,
      id: socket.id,
      playerId: socket.id,
      playerName,
      kartNumber: assignedNumberStr,
      numberInt: assignedNumberInt,
      kartWeight,
      isHost: false,
      isReady: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { heading: 0, steerAngle: 0 },
      speed: 0,
      currentLap: 1,
      bestLap: null
    };

    room.players.push(newPlayer);
    players[socket.id].roomId = roomId;
    players[socket.id].kartNumber = assignedNumberStr;
    players[socket.id].numberInt = assignedNumberInt;
    players[socket.id].playerName = playerName;
    players[socket.id].isHost = false;

    socket.join(roomId);

    const roomPayload = {
      roomId: room.roomId,
      roomName: room.roomName,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      isHost: false,
      myKartNumber: assignedNumberStr,
      kartNumber: assignedNumberStr,
      players: room.players
    };

    socket.emit('roomJoined', roomPayload);
    socket.emit('playerJoined', { player: newPlayer, room: roomPayload, isSelf: true });

    console.log(`[SERVER] emit playerJoined: ${socket.id} (${assignedNumberStr}) na sala ${roomId}`);
    socket.to(roomId).emit('playerJoined', { player: newPlayer, room: roomPayload, isSelf: false });

    io.emit('roomList', getPublicRooms());
    io.emit('race:rooms_list', getPublicRooms());
    io.emit('playersUpdate', players);
    io.emit('players', players);
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

  // 5. INICIAR CORRIDA (startRace)
  const handleStartRace = () => {
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

    room.status = 'RACING';
    console.log(`[SERVER] Corrida iniciada na sala: ${room.roomName}!`);

    const startPayload = {
      roomId: room.roomId,
      roomName: room.roomName,
      players: room.players,
      countdown: 3
    };

    io.to(room.roomId).emit('raceStarted', startPayload);
    io.to(room.roomId).emit('raceStart', startPayload);

    io.emit('roomList', getPublicRooms());
    io.emit('race:rooms_list', getPublicRooms());
  };
  socket.on('startRace', handleStartRace);
  socket.on('raceStart', handleStartRace);
  socket.on('race:start_countdown', handleStartRace);

  // 6. SINCRONIZAÇÃO DE TELEMETRIA (playerState / playerUpdate a 20 Hz)
  const handlePlayerState = (state = {}) => {
    const pInfo = players[socket.id];
    if (!pInfo) return;

    const kartNum = pInfo.kartNumber || state.kartNumber || '#1';
    console.log(`[SERVER] playerState recebido: ${socket.id} (${kartNum})`);

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
      console.log(`[SERVER] emit playerState para sala: ${pInfo.roomId}`);
      socket.to(room.roomId).emit('playerState', state);
      socket.to(room.roomId).emit('playerUpdate', state);
    } else {
      console.log(`[SERVER] emit playerState para broadcast`);
      socket.broadcast.emit('playerState', state);
      socket.broadcast.emit('playerUpdate', state);
    }
  };
  socket.on('playerState', handlePlayerState);
  socket.on('playerUpdate', handlePlayerState);
  socket.on('race:state', handlePlayerState);
  socket.on('timetrial:state', handlePlayerState);

  // 7. SAÍDA DE SALA (leaveRoom)
  const handleLeaveRoom = () => {
    const pInfo = players[socket.id];
    if (!pInfo || !pInfo.roomId) return;

    const roomId = pInfo.roomId;
    const room = rooms[roomId];
    if (room) {
      const idx = room.players.findIndex((p) => p.playerId === socket.id);
      if (idx !== -1) {
        const leaving = room.players[idx];
        releaseRoomKartNumber(room, leaving.numberInt);
        room.players.splice(idx, 1);

        console.log(`[SERVER] Jogador saiu da sala: ${leaving.playerName} (${leaving.kartNumber})`);

        if (room.players.length === 0) {
          delete rooms[roomId];
          console.log(`[SERVER] Sala removida: ${roomId} (vazia)`);
        } else {
          if (room.hostId === socket.id) {
            const nextHost = room.players[0];
            room.hostId = nextHost.playerId;
            nextHost.isHost = true;
            nextHost.isReady = true;
            io.to(roomId).emit('hostTransferred', {
              newHostId: nextHost.playerId,
              newHostName: nextHost.playerName
            });
          }
          io.to(roomId).emit('playerLeft', {
            playerId: socket.id,
            players: room.players
          });
        }
      }
    }

    socket.leave(roomId);
    pInfo.roomId = null;
    io.emit('roomList', getPublicRooms());
    io.emit('race:rooms_list', getPublicRooms());
    io.emit('playersUpdate', players);
    io.emit('players', players);
  };
  socket.on('leaveRoom', handleLeaveRoom);
  socket.on('race:leave', handleLeaveRoom);

  // 8. DESCONEXÃO
  socket.on('disconnect', () => {
    console.log(`[SERVER] Cliente desconectado: ${socket.id}`);

    handleLeaveRoom();
    delete players[socket.id];

    const totalRemaining = Object.keys(players).length;
    console.log(`[SERVER] emit playersUpdate: ${totalRemaining} pilotos online`);
    io.emit('playersUpdate', players);
    io.emit('players', players);
    io.emit('playerLeft', { playerId: socket.id });
    io.emit('playerDisconnected', socket.id);
  });

  // Time Trial Online
  socket.on('timetrial:join', (data = {}) => {
    const pInfo = players[socket.id];
    if (pInfo) {
      if (data.playerName) pInfo.playerName = String(data.playerName).slice(0, 22).trim();
      socket.emit('timetrial:joined', pInfo);
      io.emit('playersUpdate', players);
      io.emit('players', players);
    }
  });

  socket.on('timetrial:leave', () => {
    io.emit('playersUpdate', players);
    io.emit('players', players);
  });

  socket.on('timetrial:lap_record', (data) => {
    const pInfo = players[socket.id];
    if (pInfo && data && data.bestLap) {
      pInfo.bestLap = data.bestLap;
      io.emit('timetrial:leaderboard_update', {
        playerId: socket.id,
        playerName: pInfo.playerName,
        bestLap: data.bestLap
      });
    }
  });

  // Chat rápido
  socket.on('chat:quick', (data) => {
    const pInfo = players[socket.id];
    const senderName = (pInfo && pInfo.playerName) || data.playerName || 'Piloto';
    const message = data.message || '';
    if (pInfo && pInfo.roomId) {
      io.to(pInfo.roomId).emit('chat:quick_message', { senderName, message });
    } else {
      socket.broadcast.emit('chat:quick_message', { senderName, message });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`[SERVER] RA Kart Indoor Multiplayer Ativo na porta ${PORT}`);
  console.log(`[SERVER] URL Oficial: https://ra-kart-server.onrender.com`);
  console.log(`====================================================`);
});
