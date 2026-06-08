// server/index.js — Main entry: HTTP server + WebSocket + static files

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const game = require('./game');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback to index.html (Express 5 compatible)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── WebSocket ──
wss.on('connection', (ws) => {
    const player = game.registerPlayer(ws);
    console.log(`[+] ${player.username} connected (${player.id})`);

    send(ws, { type: 'connected', playerId: player.id, username: player.username });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        switch (msg.type) {
            case 'set_username':
                game.setUsername(player.id, msg.username);
                send(ws, { type: 'username_set', username: msg.username });
                break;

            case 'join_queue':
                game.joinQueue(player.id);
                send(ws, { type: 'queue_status', inQueue: true });
                console.log(`[Q] ${player.username} joined queue (${getQueueSize()} in queue)`);
                break;

            case 'leave_queue':
                game.leaveQueue(player.id);
                send(ws, { type: 'queue_status', inQueue: false });
                break;

            case 'confirm_match':
                game.confirmMatch(player.id);
                break;

            case 'input':
                game.handleInput(player.id, {
                    forward: !!msg.forward,
                    backward: !!msg.backward,
                    left: !!msg.left,
                    right: !!msg.right,
                    shooting: !!msg.shooting,
                    ability: !!msg.ability,
                    mouseX: msg.mouseX,
                    mouseY: msg.mouseY
                });
                break;

            case 'rematch':
                game.handleRematch(player.id, msg.accept);
                break;

            default:
                break;
        }
    });

    ws.on('close', () => {
        console.log(`[-] ${player.username} disconnected`);
        game.removePlayer(player.id);
    });

    ws.on('error', () => {
        game.removePlayer(player.id);
    });
});

// ── Helpers ──
function send(ws, data) {
    try { if (ws.readyState === 1) ws.send(JSON.stringify(data)); } catch { /* ignore */ }
}

function getQueueSize() {
    return game.queue ? game.queue.length : 0;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`╔══════════════════════════════╗`);
    console.log(`║  MEMORY MINES — Server v0.1  ║`);
    console.log(`║  http://localhost:${PORT}        ║`);
    console.log(`╚══════════════════════════════╝`);
});
