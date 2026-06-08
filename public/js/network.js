// network.js — WebSocket client for Memory Mines

class NetworkManager {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.playerId = null;
        this.username = 'Player';
        this.listeners = {};
        this.reconnectAttempts = 0;
        this.maxReconnect = 5;
    }

    connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${location.host}`;

        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            console.error('WebSocket connection failed:', e);
            return;
        }

        this.ws.onopen = () => {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.emit('connected');
            console.log('[NET] Connected');
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            } catch (e) {
                console.error('[NET] Parse error:', e);
            }
        };

        this.ws.onclose = () => {
            this.connected = false;
            this.emit('disconnected');
            console.log('[NET] Disconnected');
            this.tryReconnect();
        };

        this.ws.onerror = () => {
            console.error('[NET] Error');
        };
    }

    tryReconnect() {
        if (this.reconnectAttempts >= this.maxReconnect) return;
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
        console.log(`[NET] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => this.connect(), delay);
    }

    send(data) {
        if (!this.connected || !this.ws) return;
        try {
            this.ws.send(JSON.stringify(data));
        } catch (e) { /* ignore */ }
    }

    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
        if (!this.listeners[event]) return;
        for (const cb of this.listeners[event]) cb(data);
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'connected':
                this.playerId = msg.playerId;
                this.username = msg.username;
                this.emit('connected', msg);
                break;

            case 'username_set':
                this.username = msg.username;
                break;

            case 'queue_status':
                this.emit('queue_status', msg);
                break;

            case 'match_found':
                this.emit('match_found', msg);
                break;

            case 'match_confirmed':
                this.emit('match_confirmed');
                break;

            case 'opponent_confirmed':
                this.emit('opponent_confirmed');
                break;

            case 'match_start':
                this.emit('match_start', msg);
                break;

            case 'darkness':
                this.emit('darkness');
                break;

            case 'state_update':
                this.emit('state_update', msg);
                break;

            case 'sonar_pulse':
                this.emit('sonar_pulse', msg);
                break;

            case 'hit_confirmed':
                this.emit('hit_confirmed', msg);
                break;

            case 'you_were_hit':
                this.emit('you_were_hit', msg);
                break;

            case 'you_died':
                this.emit('you_died', msg);
                break;

            case 'enemy_killed':
                this.emit('enemy_killed', msg);
                break;

            case 'round_end':
                this.emit('round_end', msg);
                break;

            case 'new_round':
                this.emit('new_round', msg);
                break;

            case 'match_end':
                this.emit('match_end', msg);
                break;

            case 'rematch_available':
                this.emit('rematch_available', msg);
                break;

            case 'rematch_requested':
                this.emit('rematch_requested');
                break;

            case 'rematch_declined':
                this.emit('rematch_declined');
                break;

            case 'zone_update':
                this.emit('zone_update', msg);
                break;

            case 'opponent_disconnected':
                this.emit('opponent_disconnected', msg);
                break;

            default:
                break;
        }
    }

    // ── API Methods ──
    setUsername(name) {
        this.send({ type: 'set_username', username: name });
    }

    joinQueue() {
        this.send({ type: 'join_queue' });
    }

    leaveQueue() {
        this.send({ type: 'leave_queue' });
    }

    confirmMatch() {
        this.send({ type: 'confirm_match' });
    }

    sendInput(input) {
        this.send({ type: 'input', ...input });
    }

    requestRematch() {
        this.send({ type: 'rematch', accept: true });
    }

    declineRematch() {
        this.send({ type: 'rematch', accept: false });
    }
}

// Global instance
window.network = new NetworkManager();
