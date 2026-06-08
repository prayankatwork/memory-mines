// audio.js — Procedural audio system using Web Audio API
// No external audio files needed

class AudioManager {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.enabled = true;
    }

    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.3;
            this.masterGain.connect(this.ctx.destination);
        } catch (e) {
            this.enabled = false;
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    // ── Footstep ──
    footstep(surfaceType = 'stone') {
        if (!this.enabled) return;
        const now = this.ctx.currentTime;
        const bufferSize = this.ctx.sampleRate * 0.08;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        // Noise burst shaped by surface type
        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            let val = (Math.random() * 2 - 1) * Math.exp(-t * 40);
            // Surface characteristics
            if (surfaceType === 'metal') val *= Math.sin(t * 200) * 0.5 + 0.5;
            else if (surfaceType === 'wood') val *= Math.sin(t * 80) * 0.3 + 0.7;
            else if (surfaceType === 'water') val *= Math.sin(t * 30) * 0.2 + 0.3;
            else val *= Math.sin(t * 100) * 0.4 + 0.6; // stone
            data[i] = val * 0.3;
        }

        this.playBuffer(buffer, 0.15);
    }

    // ── Gunshot ──
    gunshot() {
        if (!this.enabled) return;
        const now = this.ctx.currentTime;
        const bufferSize = this.ctx.sampleRate * 0.15;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 30) * 0.8;
            // Add crack
            if (t < 0.02) data[i] *= 2;
        }
        this.playBuffer(buffer, 0.4);
    }

    // ── Hit ──
    hit() {
        if (!this.enabled) return;
        const now = this.ctx.currentTime;
        const bufferSize = this.ctx.sampleRate * 0.1;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            data[i] = Math.sin(t * 800) * Math.exp(-t * 30) * 0.5;
        }
        this.playBuffer(buffer, 0.3);
    }

    // ── Sonar Ping ──
    sonarPing() {
        if (!this.enabled) return;
        const now = this.ctx.currentTime;
        const duration = 0.6;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            const freq = 200 + t * 3000; // Frequency sweep up
            const envelope = Math.max(0, 1 - t / duration) * Math.exp(-t * 3);
            data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.5;
        }
        this.playBuffer(buffer, 0.5);
    }

    // ── Death ──
    death() {
        if (!this.enabled) return;
        const now = this.ctx.currentTime;
        const duration = 0.8;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            const freq = 400 - t * 300; // Descending
            const envelope = Math.max(0, 1 - t / duration) * Math.exp(-t * 2);
            data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
            data[i] += (Math.random() * 2 - 1) * envelope * 0.1; // Noise
        }
        this.playBuffer(buffer, 0.6);
    }

    // ── Zone Warning ──
    zoneWarning() {
        if (!this.enabled) return;
        const now = this.ctx.currentTime;
        const duration = 0.3;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            data[i] = Math.sin(2 * Math.PI * 100 * t) * 0.5;
        }
        this.playBuffer(buffer, 0.2);
    }

    // ── Round Start ──
    roundStart() {
        if (!this.enabled) return;
        const now = this.ctx.currentTime;
        const duration = 0.5;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / this.ctx.sampleRate;
            const freq = 300 + t * 1200;
            const envelope = Math.max(0, 1 - t / duration);
            data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
        }
        this.playBuffer(buffer, 0.5);
    }

    // ── Utility ──
    playBuffer(buffer, volume = 1) {
        if (!this.enabled || !this.ctx || !this.masterGain) return;
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        const gain = this.ctx.createGain();
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(this.masterGain);
        source.start(this.ctx.currentTime);
        // Auto-cleanup
        source.onended = () => { source.disconnect(); gain.disconnect(); };
    }
}

// Global instance
window.audio = new AudioManager();
