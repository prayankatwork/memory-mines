// audio.js — Procedural audio system for Memory Mines
// Web Audio API synthesis — no external files needed

class AudioManager {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.enabled = true;
        // Active sound instances for cleanup
        this.activeOscillators = new Set();
        this.activeNoises = new Set();
        // Mine proximity hum
        this.mineHumOsc = null;
        this.mineHumGain = null;
        this.mineHumRunning = false;
    }

    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.35;
            this.masterGain.connect(this.ctx.destination);
        } catch (e) {
            this.enabled = false;
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    // ── Footsteps ──
    footstep(surfaceType = 'stone') {
        if (!this.enabled) return;
        const now = this.ctx.currentTime;
        const bufferSize = this.ctx.sampleRate * 0.08;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            let val = (Math.random() * 2 - 1) * Math.exp(-t * 40);
            if (surfaceType === 'metal') val *= Math.sin(t * 200) * 0.5 + 0.5;
            else if (surfaceType === 'wood') val *= Math.sin(t * 80) * 0.3 + 0.7;
            else if (surfaceType === 'water') val *= Math.sin(t * 30) * 0.2 + 0.3;
            else if (surfaceType === 'dirt') val *= Math.sin(t * 50) * 0.3 + 0.5;
            else val *= Math.sin(t * 100) * 0.4 + 0.6;
            data[i] = val * 0.25;
        }
        this.playBuffer(buffer, 0.2);
    }

    // ── Gunshot ──
    gunshot() {
        if (!this.enabled) return;
        const bufferSize = this.ctx.sampleRate * 0.15;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 30) * 0.8;
            if (t < 0.02) data[i] *= 2; // Initial crack
            if (t > 0.02 && t < 0.06) data[i] += Math.sin(t * 2000) * Math.exp(-t * 20) * 0.3; // Ring
        }
        this.playBuffer(buffer, 0.35);
    }

    // ── Muzzle Flash Sound ──
    muzzleFlash() {
        if (!this.enabled) return;
        const bufferSize = this.ctx.sampleRate * 0.05;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.6;
        }
        this.playBuffer(buffer, 0.15);
    }

    // ── Hit ──
    hit() {
        if (!this.enabled) return;
        const bufferSize = this.ctx.sampleRate * 0.1;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            data[i] = Math.sin(t * 800) * Math.exp(-t * 30) * 0.5;
            data[i] += (Math.random() * 2 - 1) * Math.exp(-t * 20) * 0.2;
        }
        this.playBuffer(buffer, 0.3);
    }

    // ── Sonar Ping ──
    sonarPing() {
        if (!this.enabled) return;
        const duration = 0.8;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            const freq = 200 + t * 2000; // Ascending sweep
            const envelope = Math.max(0, 1 - t / duration) * Math.exp(-t * 2);
            // Fundamental
            data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
            // Harmonics for richness
            data[i] += Math.sin(2 * Math.PI * freq * 2.01 * t) * envelope * 0.15;
            data[i] += Math.sin(2 * Math.PI * freq * 0.5 * t) * envelope * 0.1;
        }
        this.playBuffer(buffer, 0.5);
    }

    // ── Mine Trigger Explosion ──
    mineExplosion(type = 'trigger') {
        if (!this.enabled) return;
        const duration = type === 'proximity' ? 0.6 : 0.4;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        const boomFreq = type === 'proximity' ? 60 : 80;
        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            const envelope = Math.max(0, 1 - t / duration) * Math.exp(-t * 5);
            // Low boom
            data[i] = Math.sin(2 * Math.PI * boomFreq * t) * envelope * 0.6;
            // Noise (explosive crackle)
            data[i] += (Math.random() * 2 - 1) * envelope * 0.4;
            // Metallic ring
            if (type === 'trigger') {
                data[i] += Math.sin(2 * Math.PI * 300 * t) * Math.exp(-t * 15) * 0.2;
            }
        }
        this.playBuffer(buffer, type === 'proximity' ? 0.7 : 0.55);
    }

    // ── Proximity Mine Beep ──
    proximityBeep(count, total) {
        if (!this.enabled) return;
        const duration = 0.15;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        // Beep pitch increases with each count (urgency)
        const pitch = 600 + count * 200;
        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            const envelope = Math.max(0, 1 - t / duration);
            data[i] = Math.sin(2 * Math.PI * pitch * t) * envelope * 0.4;
        }
        this.playBuffer(buffer, 0.3);
    }

    // ── Start Mine Proximity Hum (continuous) ──
    startMineHum(intensity = 1.0) {
        if (!this.enabled || !this.ctx || this.mineHumRunning) return;
        try {
            this.mineHumOsc = this.ctx.createOscillator();
            this.mineHumGain = this.ctx.createGain();

            this.mineHumOsc.type = 'sawtooth';
            this.mineHumOsc.frequency.value = 80 + intensity * 40;
            this.mineHumGain.gain.value = 0;
            this.mineHumGain.gain.linearRampToValueAtTime(0.06 * intensity, this.ctx.currentTime + 0.3);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 200 + intensity * 100;

            this.mineHumOsc.connect(filter);
            filter.connect(this.mineHumGain);
            this.mineHumGain.connect(this.masterGain);
            this.mineHumOsc.start();

            this.mineHumRunning = true;
            this.activeOscillators.add(this.mineHumOsc);
        } catch (e) { /* ignore */ }
    }

    updateMineHum(intensity) {
        if (!this.mineHumRunning || !this.mineHumOsc || !this.mineHumGain) return;
        try {
            this.mineHumOsc.frequency.value = 80 + intensity * 40;
            this.mineHumGain.gain.value = 0.06 * intensity;
        } catch (e) { /* ignore */ }
    }

    stopMineHum() {
        if (!this.mineHumRunning || !this.mineHumOsc || !this.mineHumGain) return;
        try {
            this.mineHumGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
            setTimeout(() => {
                try {
                    this.mineHumOsc.stop();
                    this.mineHumOsc.disconnect();
                    this.mineHumGain.disconnect();
                } catch (e) { /* ignore */ }
                this.mineHumRunning = false;
            }, 400);
        } catch (e) { /* ignore */ }
    }

    // ── Decoy Found ──
    decoyPing() {
        if (!this.enabled) return;
        const duration = 0.2;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            const envelope = Math.max(0, 1 - t / duration);
            data[i] = Math.sin(2 * Math.PI * 1200 * t) * envelope * 0.2;
        }
        this.playBuffer(buffer, 0.2);
    }

    // ── Death ──
    death() {
        if (!this.enabled) return;
        const duration = 1.0;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            const envelope = Math.max(0, 1 - t / duration) * Math.exp(-t * 2);
            // Heartbeat thud
            const heartbeat = Math.sin(2 * Math.PI * 40 * t) * Math.max(0, Math.sin(2 * Math.PI * 2 * t)) * envelope;
            data[i] = heartbeat * 0.5;
            // Flatline noise
            data[i] += (Math.random() * 2 - 1) * envelope * 0.08;
        }
        this.playBuffer(buffer, 0.5);
    }

    // ── Round Start ──
    roundStart() {
        if (!this.enabled) return;
        const duration = 0.5;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            const freq = 300 + t * 1200;
            const envelope = Math.max(0, 1 - t / duration);
            data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
            data[i] += Math.sin(2 * Math.PI * freq * 1.5 * t) * envelope * 0.15;
        }
        this.playBuffer(buffer, 0.5);
    }

    // ── Zone Wind (continuous) ──
    startZoneWind() {
        if (!this.enabled || !this.ctx) return;
        try {
            const bufferSize = this.ctx.sampleRate * 2;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                const t = i / this.ctx.sampleRate;
                data[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(t * 0.5));
            }
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = true;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 300;

            const gain = this.ctx.createGain();
            gain.gain.value = 0.03;

            source.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            source.start();
            this.zoneWindSource = source;
            this.zoneWindGain = gain;
            this.activeNoises.add(source);
        } catch (e) { /* ignore */ }
    }

    stopZoneWind() {
        if (this.zoneWindSource) {
            try {
                this.zoneWindSource.stop();
                this.zoneWindSource.disconnect();
            } catch (e) { /* ignore */ }
            this.zoneWindSource = null;
            this.zoneWindGain = null;
        }
    }

    // ── Zone Warning ──
    zoneWarning() {
        if (!this.enabled) return;
        const duration = 0.3;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            data[i] = Math.sin(2 * Math.PI * 100 * t) * 0.5;
            // Add wind-like noise
            data[i] += (Math.random() * 2 - 1) * Math.exp(-t * 15) * 0.2;
        }
        this.playBuffer(buffer, 0.2);
    }

    // ── Utility ──
    playBuffer(buffer, volume = 1) {
        if (!this.enabled || !this.ctx || !this.masterGain) return;
        try {
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            const gain = this.ctx.createGain();
            gain.gain.value = volume;
            source.connect(gain);
            gain.connect(this.masterGain);
            source.start(this.ctx.currentTime);
            source.onended = () => {
                try { source.disconnect(); gain.disconnect(); } catch (e) { /* ignore */ }
            };
        } catch (e) { /* ignore */ }
    }
}

// Global instance
window.audio = new AudioManager();
