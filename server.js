const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server,{
    cors:{
        origin:"*"
    }
});

const players = {};

io.on('connection',(socket)=>{

    console.log('Jogador conectado:',socket.id);

    players[socket.id] = {
        id: socket.id
    };

    io.emit('players',players);

    socket.on('playerUpdate',(data)=>{

        players[socket.id] = {
            ...players[socket.id],
            ...data
        };

        socket.broadcast.emit('playerUpdate',{
            id:socket.id,
            ...data
        });
    });

    socket.on('disconnect',()=>{

        delete players[socket.id];

        io.emit('playerDisconnected',socket.id);

        console.log('Jogador saiu');
    });

});

app.get('/',(req,res)=>{

    res.send('RA Kart Multiplayer Online');

});

server.listen(process.env.PORT || 3000,()=>{

    console.log('Servidor iniciado');

});