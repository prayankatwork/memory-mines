// main.js — Entry point: connects network, UI, game, and audio

(function() {
    'use strict';

    const network = window.network;
    const game = window.game;
    const audio = window.audio;

    let inQueue = false;
    let matchFound = false;

    // DOM Elements
    const lobby = document.getElementById('lobby');
    const queueBtn = document.getElementById('queue-btn');
    const queueStatus = document.getElementById('queue-status');
    const matchFoundSection = document.getElementById('match-found-section');
    const opponentName = document.getElementById('opponent-name');
    const acceptBtn = document.getElementById('accept-btn');
    const usernameInput = document.getElementById('username-input');
    const loading = document.getElementById('loading');
    const gameUi = document.getElementById('game-ui');

    // Network Events
    network.on('connected', () => {
        console.log('[MAIN] Connected to server');
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
        acceptBtn.disabled = false;
        acceptBtn.textContent = 'ACCEPT';
        acceptBtn.style.opacity = '1';
        document.getElementById('opponent-accepted').classList.add('hidden');
    });

    network.on('match_confirmed', () => {
        acceptBtn.disabled = true;
        acceptBtn.textContent = 'WAITING...';
        acceptBtn.style.opacity = '0.5';
    });

    network.on('match_start', (msg) => {
        matchFound = false;
        matchFoundSection.classList.add('hidden');
        loading.classList.add('hidden');
        gameUi.classList.remove('hidden');

        if (!game.renderer) {
            game.init();
        }

        // Reset UI state
        document.getElementById('death-screen').classList.add('hidden');
        document.getElementById('round-end-screen').classList.add('hidden');
        document.getElementById('match-end-screen').classList.add('hidden');
        document.getElementById('rematch-section').classList.add('hidden');
        document.getElementById('kill-feed').textContent = '';
        document.getElementById('score-mines').classList.remove('hidden');

        game.onMatchStart(msg);
        game.gameLoop();
    });

    network.on('opponent_confirmed', () => {
        document.getElementById('opponent-accepted').classList.remove('hidden');
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

    // Rematch buttons
    document.getElementById('rematch-btn').addEventListener('click', () => {
        network.requestRematch();
    });
    document.getElementById('leave-btn').addEventListener('click', () => {
        network.declineRematch();
    });

    // ── Mine counter during MEMORIZE phase ──
    // Track when visible mines update to show counter
    let totalMines = 0;
    network.on('match_start', (msg) => {
        if (msg.map && msg.map.mines) {
            totalMines = msg.map.mines.length;
            document.getElementById('mines-memorized').textContent = totalMines;
        }
    });
    network.on('new_round', (msg) => {
        if (msg.mines) {
            totalMines = msg.mines.length;
            document.getElementById('mines-memorized').textContent = totalMines;
        }
    });

    // ── Connect on page load ──
    function start() {
        network.connect();

        const names = ['Phantom', 'Shadow', 'Echo', 'Ghost', 'Wraith', 'Specter', 'Shade', 'Void'];
        usernameInput.value = names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 100);

        console.log('[MAIN] Memory Mines v1.0 — Ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
