// main.js — Entry point: connects network, UI, game, and audio

(function() {
    'use strict';

    const network = window.network;
    const game = window.game;
    const audio = window.audio;

    let inQueue = false;
    let matchFound = false;

    // ── DOM Elements ──
    const lobby = document.getElementById('lobby');
    const queueBtn = document.getElementById('queue-btn');
    const queueStatus = document.getElementById('queue-status');
    const matchFoundSection = document.getElementById('match-found-section');
    const opponentName = document.getElementById('opponent-name');
    const acceptBtn = document.getElementById('accept-btn');
    const usernameInput = document.getElementById('username-input');
    const loading = document.getElementById('loading');
    const gameUi = document.getElementById('game-ui');

    // ── Network Events ──
    network.on('connected', () => {
        console.log('[MAIN] Connected to server');
        // Send username if set
        const name = usernameInput.value.trim() || 'Player';
        network.setUsername(name);
    });

    network.on('queue_status', (msg) => {
        inQueue = msg.inQueue;
        queueStatus.classList.toggle('hidden', !msg.inQueue);
        queueBtn.textContent = msg.inQueue ? 'CANCEL' : 'FIND MATCH';
    });

    network.on('match_found', (msg) => {
        inQueue = false;
        matchFound = true;
        queueStatus.classList.add('hidden');
        matchFoundSection.classList.remove('hidden');
        opponentName.textContent = msg.opponent;
        queueBtn.textContent = 'FIND MATCH';
        // Reset accept button state for new match
        acceptBtn.disabled = false;
        acceptBtn.textContent = 'ACCEPT';
        acceptBtn.style.opacity = '1';
    });

    network.on('match_confirmed', () => {
        // Show visual feedback — player's accept was received
        acceptBtn.disabled = true;
        acceptBtn.textContent = 'WAITING...';
        acceptBtn.style.opacity = '0.5';
    });

    network.on('match_start', (msg) => {
        matchFound = false;
        matchFoundSection.classList.add('hidden');
        loading.classList.add('hidden');
        gameUi.classList.remove('hidden');

        // Initialize game if not already
        if (!game.renderer) {
            game.init();
        }

        game.onMatchStart(msg);
        game.gameLoop();
    });

    network.on('opponent_confirmed', () => {
        loading.classList.remove('hidden');
        matchFoundSection.classList.add('hidden');
    });

    network.on('opponent_disconnected', (msg) => {
        // Handled in game.js
    });

    // ── UI Events ──
    queueBtn.addEventListener('click', () => {
        if (inQueue) {
            network.leaveQueue();
        } else {
            if (!network.connected) {
                network.connect();
                setTimeout(() => network.joinQueue(), 500);
            } else {
                network.joinQueue();
            }
        }
    });

    acceptBtn.addEventListener('click', () => {
        if (network.connected) {
            network.confirmMatch();
        }
    });

    usernameInput.addEventListener('change', () => {
        const name = usernameInput.value.trim() || 'Player';
        if (network.connected) network.setUsername(name);
    });

    // ── Rematch Buttons ──
    document.getElementById('rematch-btn').addEventListener('click', () => {
        network.requestRematch();
    });

    document.getElementById('leave-btn').addEventListener('click', () => {
        network.declineRematch();
    });

    // ── Connect on page load ──
    function start() {
        network.connect();

        // Generate random default name
        const names = ['Phantom', 'Shadow', 'Echo', 'Ghost', 'Wraith', 'Specter', 'Shade', 'Void'];
        usernameInput.value = names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 100);

        console.log('[MAIN] Memory Mines v0.1 — Ready');
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
