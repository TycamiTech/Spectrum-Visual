/**
 * ========================================
 * SPECTRUM AUDIO VISUALIZER
 * Real-time Circular Audio Visualizer with 3D Perspective
 * ========================================
 */

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
    // Audio settings
    fftSize: 2048, // Increases resolution
    smoothingTimeConstant: 0.85, // Smoother movement
    audioBoost: 1.8,

    // Visualizer settings
    barCount: 160, // More bars for richer look
    innerRadius: 120,
    minBarHeight: 5,
    maxBarHeight: 250,
    barWidth: 2,

    // 3D Perspective
    perspectiveScale: 0.5,
    tiltAngle: 0,

    // Animation
    rotationSpeed: 0.002,
    smoothingFactor: 0.5,

    // Particle system
    particleCount: 50,
    particleBaseSpeed: 0.8,
    particleBassMultiplier: 5,

    // Visual effects
    glowEnabled: true, // Enabled for "Premium" look
    glowIntensity: 15,

    // Colors
    hueStart: 280, // Purple start
    hueRange: 320,

    // Performance
    maxDPR: 1.5,
    enableReflection: true
};

// ========================================
// PLAYLIST CONFIGURATION
// ========================================

const PLAYLIST = [
    { title: "2000 (Slowed)", artist: "vowl.", file: "music/2000 (slowed) - vowl..mp3" },
    { title: "Interlinked", artist: "Lonely Lies, GOLDKID", file: "music/Lonely Lies, GOLDKID - Interlinked.mp3" },
    { title: "Manasha (Slowed)", artist: "Ashreveal", file: "music/Manasha ( Slowed ) - Ashreveal.mp3" },
    { title: "Night Drive", artist: "Wilee", file: "music/Wilee - Night Drive.mp3" }
];

let currentTrackIndex = 0;

// ========================================
// GLOBAL VARIABLES
// ========================================

let audioContext = null;
let analyser = null;
let source = null;
let audioElement = null;
let dataArray = null;
let bufferLength = 0;

let visualizerCanvas = null;
let visualizerCtx = null;
let particleCanvas = null;
let particleCtx = null;

let particles = [];
let smoothedData = [];
let rotation = 0;
let isPlaying = false;
let animationId = null;
let currentVisualMode = 'circular';

// Cached dimensions
let cachedWidth = 0;
let cachedHeight = 0;
let cachedCenterX = 0;
let cachedCenterY = 0;

// Variables for FPS
let lastFrameTime = performance.now();
let frameCount = 0;

// Bass detection
let bassLevel = 0;
let lastBassHit = 0;
let bassThreshold = 220; // 0-255

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    initCanvases();
    initParticles();
    initPlayer();
    setupEventListeners();
    resizeCanvases();
    populateLandingOptions();

    // Start ambient particle animation
    animateParticlesOnly();
});

function populateLandingOptions() {
    const songSelect = document.getElementById('landing-song-select');
    if (!songSelect) return;

    PLAYLIST.forEach((track, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${track.title} - ${track.artist}`;
        option.classList.add('bg-gray-900', 'text-white'); // Tailwind classes for dropdown options
        songSelect.appendChild(option);
    });
}

function initCanvases() {
    visualizerCanvas = document.getElementById('visualizer-canvas');
    visualizerCtx = visualizerCanvas.getContext('2d');

    particleCanvas = document.getElementById('particle-canvas');
    particleCtx = particleCanvas.getContext('2d');
}

function initPlayer() {
    audioElement = document.getElementById('audio-player');

    // Auto-play next track
    audioElement.addEventListener('ended', () => {
        playNextTrack();
    });

    loadTrack(currentTrackIndex);
}

function resizeCanvases() {
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDPR);

    cachedWidth = window.innerWidth;
    cachedHeight = window.innerHeight;
    cachedCenterX = cachedWidth / 2;
    cachedCenterY = cachedHeight / 2;

    visualizerCanvas.width = cachedWidth * dpr;
    visualizerCanvas.height = cachedHeight * dpr;
    visualizerCtx.scale(dpr, dpr);

    particleCanvas.width = cachedWidth * dpr;
    particleCanvas.height = cachedHeight * dpr;
    particleCtx.scale(dpr, dpr);

    initParticles();
}

function setupEventListeners() {
    // Start Button (Landing Page)
    document.getElementById('start-btn').addEventListener('click', () => {
        const songSelect = document.getElementById('landing-song-select');
        const modeSelect = document.getElementById('landing-mode-select');

        // Set initial state from landing choices
        currentTrackIndex = parseInt(songSelect.value);
        currentVisualMode = modeSelect.value;

        // Update player mode selector to match
        document.getElementById('player-mode-select').value = currentVisualMode;

        loadTrack(currentTrackIndex);
        transitionToPlayer();
        togglePlay();
    });

    // Media Controls
    document.getElementById('play-btn').addEventListener('click', togglePlay);
    document.getElementById('prev-btn').addEventListener('click', playPrevTrack);
    document.getElementById('next-btn').addEventListener('click', playNextTrack);

    // Mode Selector Sync
    const landingMode = document.getElementById('landing-mode-select');
    const playerMode = document.getElementById('player-mode-select');

    if (landingMode && playerMode) {
        landingMode.addEventListener('change', (e) => {
            currentVisualMode = e.target.value;
            playerMode.value = e.target.value;
            smoothedData = new Array(CONFIG.barCount).fill(0);
        });

        playerMode.addEventListener('change', (e) => {
            currentVisualMode = e.target.value;
            landingMode.value = e.target.value;
            smoothedData = new Array(CONFIG.barCount).fill(0);
        });
    }

    // Window resize
    window.addEventListener('resize', resizeCanvases);

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            togglePlay();
        }
        if (e.code === 'ArrowRight') playNextTrack();
        if (e.code === 'ArrowLeft') playPrevTrack();
    });
}

function transitionToPlayer() {
    const landingUI = document.getElementById('landing-ui');
    const playerUI = document.getElementById('player-ui');

    // Fade out landing
    landingUI.classList.add('opacity-0', 'pointer-events-none', 'scale-95');

    // Fade in player after short delay
    setTimeout(() => {
        landingUI.style.display = 'none'; // Completely hide

        playerUI.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
        playerUI.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');
    }, 500);
}

// ========================================
// AUDIO SYSTEM
// ========================================

function ensureAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = CONFIG.fftSize;
        analyser.smoothingTimeConstant = CONFIG.smoothingTimeConstant;

        source = audioContext.createMediaElementSource(audioElement);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        smoothedData = new Array(CONFIG.barCount).fill(0);
    } else if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

function loadTrack(index) {
    if (index < 0) index = PLAYLIST.length - 1;
    if (index >= PLAYLIST.length) index = 0;

    currentTrackIndex = index;
    const track = PLAYLIST[index];

    audioElement.src = track.file;
    audioElement.load();

    updateSongInfo(track);
}

function updateSongInfo(track) {
    document.getElementById('song-title').textContent = track.title;
    document.getElementById('song-artist').textContent = track.artist;
}

async function togglePlay() {
    ensureAudioContext();

    if (audioElement.paused) {
        try {
            await audioElement.play();
            isPlaying = true;
            updatePlayButtonState(true);
            animate();
        } catch (e) {
            console.error("Playback failed:", e);
        }
    } else {
        audioElement.pause();
        isPlaying = false;
        updatePlayButtonState(false);
    }
}

function playNextTrack() {
    loadTrack(currentTrackIndex + 1);
    togglePlay();
}

function playPrevTrack() {
    loadTrack(currentTrackIndex - 1);
    togglePlay();
}

function updatePlayButtonState(playing) {
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');

    if (playing) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
        document.body.classList.add('visualizer-active');
    } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        document.body.classList.remove('visualizer-active');
    }
}

// ========================================
// AUDIO ANALYSIS
// ========================================

function getAudioData(mode) {
    if (!analyser || !dataArray) return new Array(CONFIG.barCount).fill(0);

    analyser.getByteFrequencyData(dataArray);

    const barCount = CONFIG.barCount;
    // Focus on bass and mids (0 - 15kHz roughly)
    const usableBins = Math.floor(bufferLength * 0.7);
    const step = usableBins / (mode === 'circular' ? barCount / 2 : barCount);

    const processed = [];

    // Extract and map frequency data
    const freqData = [];
    for (let i = 0; i < (mode === 'circular' ? barCount / 2 : barCount); i++) {
        const binIndex = Math.floor(i * step);
        // Simple average around bin
        let sum = 0;
        let count = 0;
        for (let j = 0; j < Math.max(1, step); j++) {
            if (binIndex + j < bufferLength) {
                sum += dataArray[binIndex + j];
                count++;
            }
        }

        let value = (count > 0 ? sum / count : 0) * CONFIG.audioBoost;
        freqData.push(Math.min(value, 255));
    }

    // Map to final bars
    for (let i = 0; i < barCount; i++) {
        let val = 0;
        if (mode === 'circular') {
            // Mirror
            if (i < barCount / 2) val = freqData[i];
            else val = freqData[barCount - 1 - i];
        } else {
            val = freqData[i] || 0;
        }

        // Smooth
        smoothedData[i] += (val - smoothedData[i]) * CONFIG.smoothingFactor;
        processed.push(smoothedData[i]);
    }

    // Detect bass
    let bassSum = 0;
    let bassCount = Math.floor(10); // First 10 bins
    for (let i = 0; i < bassCount; i++) bassSum += dataArray[i];
    bassLevel = (bassSum / bassCount) / 255;

    return processed;
}

// ========================================
// PARTICLE SYSTEM
// ========================================

class Particle {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = Math.random() * cachedWidth;
        this.y = Math.random() * cachedHeight;
        this.size = Math.random() * 2 + 0.5;
        this.speedX = (Math.random() - 0.5) * CONFIG.particleBaseSpeed;
        this.speedY = (Math.random() - 0.5) * CONFIG.particleBaseSpeed;
        this.hue = Math.random() * 60 + 260; // Purple/Pink range
        this.alpha = Math.random() * 0.5 + 0.1;
    }

    update() {
        this.x += this.speedX + (this.speedX * bassLevel * CONFIG.particleBassMultiplier);
        this.y += this.speedY + (this.speedY * bassLevel * CONFIG.particleBassMultiplier);

        if (this.x < 0) this.x = cachedWidth;
        if (this.x > cachedWidth) this.x = 0;
        if (this.y < 0) this.y = cachedHeight;
        if (this.y > cachedHeight) this.y = 0;
    }

    draw() {
        particleCtx.fillStyle = `hsla(${this.hue}, 80%, 60%, ${this.alpha + bassLevel * 0.3})`;
        particleCtx.beginPath();
        particleCtx.arc(this.x, this.y, this.size + bassLevel * 2, 0, Math.PI * 2);
        particleCtx.fill();
    }
}

function initParticles() {
    particles = [];
    for (let i = 0; i < CONFIG.particleCount; i++) {
        particles.push(new Particle());
    }
}

function animateParticlesOnly() {
    if (isPlaying) return;

    particleCtx.clearRect(0, 0, cachedWidth, cachedHeight);
    particles.forEach(p => {
        p.update();
        p.draw();
    });
    requestAnimationFrame(animateParticlesOnly);
}

// ========================================
// VISUALIZATION RENDERING
// ========================================

function animate() {
    if (!isPlaying) return;

    requestAnimationFrame(animate);

    const data = getAudioData(currentVisualMode);

    visualizerCtx.clearRect(0, 0, cachedWidth, cachedHeight);
    particleCtx.clearRect(0, 0, cachedWidth, cachedHeight);

    // Particles
    particles.forEach(p => {
        p.update();
        p.draw();
    });

    // Visualizer modes
    if (currentVisualMode === 'circular') drawCircular(data);
    else if (currentVisualMode === 'classic') drawClassic(data);
    else if (currentVisualMode === 'mirrored') drawMirrored(data);
}

function drawCircular(data) {
    const cx = cachedCenterX;
    const cy = cachedCenterY;

    visualizerCtx.save();
    visualizerCtx.translate(cx, cy);
    visualizerCtx.scale(1, CONFIG.perspectiveScale);
    rotation += CONFIG.rotationSpeed + (bassLevel * 0.01);

    const radius = CONFIG.innerRadius + (bassLevel * 20);
    const angleStep = (Math.PI * 2) / CONFIG.barCount;

    for (let i = 0; i < CONFIG.barCount; i++) {
        const val = data[i] / 255;
        const h = CONFIG.minBarHeight + val * CONFIG.maxBarHeight;
        const angle = i * angleStep + rotation;

        const x1 = Math.cos(angle) * radius;
        const y1 = Math.sin(angle) * radius;
        const x2 = Math.cos(angle) * (radius + h);
        const y2 = Math.sin(angle) * (radius + h);

        const hue = (CONFIG.hueStart + i * (CONFIG.hueRange / CONFIG.barCount)) % 360;

        visualizerCtx.beginPath();
        visualizerCtx.moveTo(x1, y1);
        visualizerCtx.lineTo(x2, y2);
        visualizerCtx.strokeStyle = `hsl(${hue}, 80%, 60%)`;
        visualizerCtx.lineWidth = CONFIG.barWidth;

        if (CONFIG.glowEnabled) {
            visualizerCtx.shadowBlur = CONFIG.glowIntensity * val;
            visualizerCtx.shadowColor = `hsl(${hue}, 80%, 60%)`;
        }

        visualizerCtx.stroke();
    }

    // Inner Glow
    visualizerCtx.shadowBlur = 0;
    visualizerCtx.beginPath();
    visualizerCtx.arc(0, 0, radius - 5, 0, Math.PI * 2);
    visualizerCtx.fillStyle = `rgba(100, 50, 200, ${0.1 + bassLevel * 0.2})`;
    visualizerCtx.fill();
    visualizerCtx.strokeStyle = `rgba(255, 255, 255, ${0.2 + bassLevel})`;
    visualizerCtx.stroke();

    visualizerCtx.restore();

    if (CONFIG.enableReflection) drawReflection(data, radius);
}

function drawReflection(data, radius) {
    visualizerCtx.save();
    visualizerCtx.translate(cachedCenterX, cachedCenterY + 150);
    visualizerCtx.scale(1, -CONFIG.perspectiveScale * 0.4);
    visualizerCtx.globalAlpha = 0.2;

    const angleStep = (Math.PI * 2) / CONFIG.barCount;

    for (let i = 0; i < CONFIG.barCount; i++) {
        if (i % 2 !== 0) continue; // Optimize: draw half lines for reflection

        const val = data[i] / 255;
        const h = val * CONFIG.maxBarHeight * 0.8;
        const angle = i * angleStep + rotation;

        const x1 = Math.cos(angle) * radius;
        const y1 = Math.sin(angle) * radius;
        const x2 = Math.cos(angle) * (radius + h);
        const y2 = Math.sin(angle) * (radius + h);

        const hue = (CONFIG.hueStart + i * 2) % 360;

        visualizerCtx.beginPath();
        visualizerCtx.moveTo(x1, y1);
        visualizerCtx.lineTo(x2, y2);
        visualizerCtx.strokeStyle = `hsl(${hue}, 70%, 50%)`;
        visualizerCtx.lineWidth = CONFIG.barWidth;
        visualizerCtx.stroke();
    }
    visualizerCtx.restore();
}

function drawClassic(data) {
    const padding = cachedWidth * 0.1;
    const width = cachedWidth - (padding * 2);
    const barWidth = (width / CONFIG.barCount) * 0.6;
    const gap = (width / CONFIG.barCount) * 0.4;

    visualizerCtx.save();
    for (let i = 0; i < CONFIG.barCount; i++) {
        const val = data[i] / 255;
        const h = val * (cachedHeight * 0.6);
        const x = padding + i * (barWidth + gap);
        const y = cachedHeight - h - (cachedHeight * 0.1);

        const hue = (i * 2 + rotation * 100) % 360;

        visualizerCtx.fillStyle = `hsl(${hue}, 80%, 60%)`;
        visualizerCtx.shadowBlur = CONFIG.glowEnabled ? 15 : 0;
        visualizerCtx.shadowColor = `hsl(${hue}, 80%, 60%)`;

        visualizerCtx.fillRect(x, y, barWidth, h);

        // Reflection
        visualizerCtx.fillStyle = `hsla(${hue}, 80%, 60%, 0.2)`;
        visualizerCtx.fillRect(x, cachedHeight - (cachedHeight * 0.1), barWidth, h * 0.3);
    }
    visualizerCtx.restore();
}

function drawMirrored(data) {
    const barWidth = (cachedWidth / CONFIG.barCount);

    visualizerCtx.save();
    for (let i = 0; i < CONFIG.barCount; i++) {
        const val = data[i] / 255;
        const h = val * (cachedHeight * 0.4);
        const x = i * barWidth;
        const cy = cachedHeight / 2;

        const hue = (i * 3 - rotation * 100) % 360;

        visualizerCtx.fillStyle = `hsl(${hue}, 90%, 60%)`;
        if (CONFIG.glowEnabled) {
            visualizerCtx.shadowBlur = 10;
            visualizerCtx.shadowColor = `hsl(${hue}, 90%, 60%)`;
        }

        visualizerCtx.fillRect(x, cy - h, barWidth - 1, h * 2);
    }

    visualizerCtx.beginPath();
    visualizerCtx.moveTo(0, cachedHeight / 2);
    visualizerCtx.lineTo(cachedWidth, cachedHeight / 2);
    visualizerCtx.strokeStyle = 'rgba(255,255,255,0.5)';
    visualizerCtx.stroke();

    visualizerCtx.restore();
}
