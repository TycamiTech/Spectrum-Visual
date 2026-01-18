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
    fftSize: 512,
    smoothingTimeConstant: 0.5,
    audioBoost: 2.5, // Audio sensitivity multiplier (1.0 = normal, 2.0+ = stronger)

    // Visualizer settings
    barCount: 120,
    innerRadius: 100,
    minBarHeight: 10, // Small minimum for subtle base
    maxBarHeight: 200, // Increased for more dramatic peaks
    barWidth: 2.5,

    // 3D Perspective
    perspectiveScale: 0.4,
    tiltAngle: 0,

    // Animation
    rotationSpeed: 0.001,
    smoothingFactor: 0.4, // Faster response

    // Particle system (LIGHTWEIGHT)
    particleCount: 30,
    particleBaseSpeed: 0.5,
    particleBassMultiplier: 3,

    // Visual effects (DISABLED for performance)
    glowEnabled: false,
    glowIntensity: 0,

    // Colors
    hueStart: 270,
    hueRange: 300,

    // Performance
    targetFPS: 60,
    maxDPR: 1,
    enableReflection: false
};

// ========================================
// GLOBAL VARIABLES
// ========================================

let audioContext = null;
let analyser = null;
let mediaSource = null;
let mediaStream = null;  // Store stream for cleanup
let dataArray = null;
let bufferLength = 0;

let visualizerCanvas = null;
let visualizerCtx = null;
let particleCanvas = null;
let particleCtx = null;

let particles = [];
let smoothedData = [];
let rotation = 0;
let isRunning = false;
let animationId = null;

// Cached dimensions (updated on resize)
let cachedWidth = 0;
let cachedHeight = 0;
let cachedCenterX = 0;
let cachedCenterY = 0;

// FPS tracking
let lastFrameTime = performance.now();
let frameCount = 0;
let fps = 60;

// Bass detection
let bassLevel = 0;
let lastBassHit = 0;

// Auto-hide UI
let mouseIdleTimer = null;
let isUIHidden = false;
const UI_HIDE_DELAY = 3000; // 3 seconds

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    initCanvases();
    initParticles();
    setupEventListeners();
    resizeCanvases();

    // Start ambient particle animation
    animateParticlesOnly();
});

function initCanvases() {
    visualizerCanvas = document.getElementById('visualizer-canvas');
    visualizerCtx = visualizerCanvas.getContext('2d');

    particleCanvas = document.getElementById('particle-canvas');
    particleCtx = particleCanvas.getContext('2d');
}

function resizeCanvases() {
    // Cap DPR for performance (use maxDPR from config)
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDPR);

    // Cache dimensions
    cachedWidth = window.innerWidth;
    cachedHeight = window.innerHeight;
    cachedCenterX = cachedWidth / 2;
    cachedCenterY = cachedHeight / 2;

    // Visualizer canvas
    visualizerCanvas.width = cachedWidth * dpr;
    visualizerCanvas.height = cachedHeight * dpr;
    visualizerCanvas.style.width = cachedWidth + 'px';
    visualizerCanvas.style.height = cachedHeight + 'px';
    visualizerCtx.scale(dpr, dpr);

    // Particle canvas
    particleCanvas.width = cachedWidth * dpr;
    particleCanvas.height = cachedHeight * dpr;
    particleCanvas.style.width = cachedWidth + 'px';
    particleCanvas.style.height = cachedHeight + 'px';
    particleCtx.scale(dpr, dpr);

    // Reinitialize particles on resize
    initParticles();
}

function setupEventListeners() {
    // Start button
    const startBtn = document.getElementById('start-btn');
    startBtn.addEventListener('click', startVisualizer);

    // Window resize
    window.addEventListener('resize', () => {
        resizeCanvases();
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !isRunning) {
            e.preventDefault();
            startVisualizer();
        }
        if (e.code === 'Escape' && isRunning) {
            stopVisualizer();
        }
    });

    // Mouse movement for auto-hide UI
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', handleMouseMove);
}

// ========================================
// AUDIO SETUP (System Audio via Display Media)
// ========================================

async function initAudio() {
    try {
        // Create audio context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Get display media with system audio
        // Note: User must select a tab/window with audio enabled
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,  // Required, but we won't use it
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        // Check if audio track exists
        const audioTracks = mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
            throw new Error('NO_AUDIO_TRACK');
        }

        // Stop video track - we only need audio
        const videoTracks = mediaStream.getVideoTracks();
        videoTracks.forEach(track => track.stop());

        // Create analyser
        analyser = audioContext.createAnalyser();
        analyser.fftSize = CONFIG.fftSize;
        analyser.smoothingTimeConstant = CONFIG.smoothingTimeConstant;

        // Connect system audio to analyser
        mediaSource = audioContext.createMediaStreamSource(mediaStream);
        mediaSource.connect(analyser);

        // Setup data array
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        // Initialize smoothed data array
        smoothedData = new Array(CONFIG.barCount).fill(0);

        // Listen for stream ending (user stops sharing)
        mediaStream.getAudioTracks()[0].addEventListener('ended', () => {
            console.log('Audio sharing stopped by user');
            stopVisualizer();
        });

        return true;
    } catch (error) {
        console.error('Error capturing system audio:', error);

        // Handle specific error cases
        if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
            alert('Izin ditolak: Anda harus memilih tab/window untuk menangkap audio sistem.');
        } else if (error.message === 'NO_AUDIO_TRACK') {
            alert('Error: Tidak ada audio track. Pastikan Anda mencentang opsi "Share audio" / "Bagikan audio" saat memilih tab.');
        } else {
            alert('Error: Tidak dapat menangkap audio sistem. Pastikan browser mendukung fitur ini.');
        }

        // Cleanup on error
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

        return false;
    }
}

// ========================================
// AUDIO DATA PROCESSING
// ========================================

function getAudioData() {
    if (!analyser || !dataArray) return null;

    analyser.getByteFrequencyData(dataArray);

    const barCount = CONFIG.barCount;
    const boost = CONFIG.audioBoost;
    const processedData = [];

    // Only use first 40% of frequency bins (where most audio data is)
    const usableBins = Math.floor(bufferLength * 0.4);

    // Half the bars will be filled, then mirrored
    const halfBars = Math.floor(barCount / 2);
    const step = usableBins / halfBars;

    // Process first half (spread frequency data)
    const firstHalf = [];
    for (let i = 0; i < halfBars; i++) {
        const binIndex = Math.floor(i * step);
        let sum = 0;
        let count = 0;

        // Average a few bins around this position for smoother data
        for (let j = -1; j <= 1; j++) {
            const idx = binIndex + j;
            if (idx >= 0 && idx < usableBins) {
                sum += dataArray[idx];
                count++;
            }
        }

        // Apply boost
        let value = (sum / count) * boost;
        value = Math.min(value, 255);
        firstHalf.push(value);
    }

    // Build full circle: first half + mirrored second half
    for (let i = 0; i < barCount; i++) {
        let value;
        if (i < halfBars) {
            value = firstHalf[i];
        } else {
            // Mirror: map back to first half
            value = firstHalf[barCount - 1 - i];
        }

        // Apply smoothing
        smoothedData[i] += (value - smoothedData[i]) * CONFIG.smoothingFactor;
        processedData.push(smoothedData[i]);
    }

    return processedData;
}

function getBassLevel() {
    if (!analyser || !dataArray) return 0;

    // Get low frequency data (bass)
    const bassRange = Math.floor(bufferLength * 0.1); // First 10% of frequencies
    let sum = 0;

    for (let i = 0; i < bassRange; i++) {
        sum += dataArray[i];
    }

    const average = sum / bassRange;
    return average / 255; // Normalize to 0-1
}

// ========================================
// PARTICLE SYSTEM
// ========================================

class Particle {
    constructor() {
        this.reset();
    }

    reset() {
        // Use cached dimensions
        this.x = Math.random() * cachedWidth;
        this.y = Math.random() * cachedHeight;
        this.size = Math.random() * 1.5 + 0.5; // Smaller particles
        this.speedX = (Math.random() - 0.5) * CONFIG.particleBaseSpeed;
        this.speedY = (Math.random() - 0.5) * CONFIG.particleBaseSpeed;
        this.opacity = Math.random() * 0.4 + 0.1;
        this.hue = Math.random() * 60 + 240;
    }

    update(bassLevel) {
        // Base movement
        this.x += this.speedX;
        this.y += this.speedY;

        // Simple bass reaction (reduced calculations)
        if (bassLevel > 0.6) {
            this.x += (Math.random() - 0.5) * CONFIG.particleBassMultiplier;
            this.y += (Math.random() - 0.5) * CONFIG.particleBassMultiplier;
        }

        // Wrap around screen (use cached dimensions)
        if (this.x < 0) this.x = cachedWidth;
        if (this.x > cachedWidth) this.x = 0;
        if (this.y < 0) this.y = cachedHeight;
        if (this.y > cachedHeight) this.y = 0;
    }

    draw(ctx, globalBass) {
        // Simple draw - no glow, no pulse animation
        const opacity = this.opacity + globalBass * 0.2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${this.hue}, 70%, 60%, ${opacity})`;
        ctx.fill();
    }
}

function initParticles() {
    particles = [];
    for (let i = 0; i < CONFIG.particleCount; i++) {
        particles.push(new Particle());
    }
}

function updateAndDrawParticles(bassLevel) {
    // Use cached dimensions
    particleCtx.clearRect(0, 0, cachedWidth, cachedHeight);

    // Update and draw particles
    const len = particles.length;
    for (let i = 0; i < len; i++) {
        const particle = particles[i];
        particle.update(bassLevel);
        particle.draw(particleCtx, bassLevel);
    }
}

// ========================================
// VISUALIZER DRAWING
// ========================================

function drawVisualizer(audioData) {
    // Use cached dimensions (no DOM access)
    const width = cachedWidth;
    const height = cachedHeight;
    const centerX = cachedCenterX;
    const centerY = cachedCenterY;

    // Clear canvas
    visualizerCtx.clearRect(0, 0, width, height);

    // Update rotation
    rotation += CONFIG.rotationSpeed;

    // Calculate dynamic inner radius based on bass
    const dynamicRadius = CONFIG.innerRadius + bassLevel * 30;

    // Pre-calculate commonly used values
    const barCount = CONFIG.barCount;
    const angleStep = (Math.PI * 2) / barCount;
    const hueStep = CONFIG.hueRange / barCount;
    const rotationHueOffset = rotation * 50;

    // Draw the circular spectrum
    visualizerCtx.save();
    visualizerCtx.translate(centerX, centerY);

    // Apply 3D perspective transformation
    visualizerCtx.scale(1, CONFIG.perspectiveScale);

    // Set common line properties once
    visualizerCtx.lineWidth = CONFIG.barWidth;
    visualizerCtx.lineCap = 'round';

    for (let i = 0; i < barCount; i++) {
        const angle = i * angleStep + rotation;
        const value = audioData ? audioData[i] : 0;
        const valueNorm = value * 0.00392156862; // value / 255

        // Map audio value to bar height (with minimum height for full circle)
        const barHeight = CONFIG.minBarHeight + valueNorm * (CONFIG.maxBarHeight - CONFIG.minBarHeight);

        // Pre-calculate cos/sin (used twice)
        const cosAngle = Math.cos(angle);
        const sinAngle = Math.sin(angle);

        // Calculate positions
        const innerX = cosAngle * dynamicRadius;
        const innerY = sinAngle * dynamicRadius;
        const outerRadius = dynamicRadius + barHeight;
        const outerX = cosAngle * outerRadius;
        const outerY = sinAngle * outerRadius;

        // Calculate color (rainbow gradient)
        const hue = (CONFIG.hueStart + i * hueStep + rotationHueOffset) % 360;
        const saturation = 80 + valueNorm * 20;
        const lightness = 50 + valueNorm * 20;

        // Draw bar with glow
        visualizerCtx.beginPath();
        visualizerCtx.moveTo(innerX, innerY);
        visualizerCtx.lineTo(outerX, outerY);

        // Set line style
        const colorStr = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        visualizerCtx.strokeStyle = colorStr;

        // Apply glow only if enabled (GPU intensive!)
        if (CONFIG.glowEnabled) {
            visualizerCtx.shadowBlur = CONFIG.glowIntensity + valueNorm * 10;
            visualizerCtx.shadowColor = colorStr;
        }

        visualizerCtx.stroke();
    }

    // Reset shadow for inner circle
    visualizerCtx.shadowBlur = 0;

    // Draw inner circle (simplified)
    drawInnerCircle(dynamicRadius);

    visualizerCtx.restore();

    // Draw reflection only if enabled
    if (CONFIG.enableReflection) {
        drawReflection(audioData, centerX, centerY, dynamicRadius);
    }
}

function drawInnerCircle(radius) {
    // Simple inner circle (no heavy gradients for performance)
    visualizerCtx.beginPath();
    visualizerCtx.arc(0, 0, radius, 0, Math.PI * 2);

    // Simple fill
    visualizerCtx.fillStyle = 'rgba(139, 92, 246, 0.05)';
    visualizerCtx.fill();

    // Simple border (no shadow)
    visualizerCtx.beginPath();
    visualizerCtx.arc(0, 0, radius, 0, Math.PI * 2);
    visualizerCtx.strokeStyle = `rgba(255, 255, 255, ${0.15 + bassLevel * 0.15})`;
    visualizerCtx.lineWidth = 1;
    visualizerCtx.stroke();
}

function drawReflection(audioData, centerX, centerY, radius) {
    visualizerCtx.save();
    visualizerCtx.translate(centerX, centerY + 150); // Offset for reflection
    visualizerCtx.scale(1, -CONFIG.perspectiveScale * 0.5); // Flipped and smaller
    visualizerCtx.globalAlpha = 0.15; // Faded reflection

    // Pre-calculate values
    const barCount = CONFIG.barCount;
    const angleStep = (Math.PI * 2) / barCount;
    const hueStep = CONFIG.hueRange / barCount;
    const rotationHueOffset = rotation * 50;
    const halfMaxBarHeight = CONFIG.maxBarHeight * 0.5;

    // Set common line properties once
    visualizerCtx.lineWidth = CONFIG.barWidth;
    visualizerCtx.lineCap = 'round';
    visualizerCtx.shadowBlur = 5;

    for (let i = 0; i < barCount; i++) {
        const angle = i * angleStep + rotation;
        const value = audioData ? audioData[i] : 0;
        const barHeight = (value * 0.00392156862) * halfMaxBarHeight;

        const cosAngle = Math.cos(angle);
        const sinAngle = Math.sin(angle);

        const innerX = cosAngle * radius;
        const innerY = sinAngle * radius;
        const outerRadius = radius + barHeight;
        const outerX = cosAngle * outerRadius;
        const outerY = sinAngle * outerRadius;

        const hue = (CONFIG.hueStart + i * hueStep + rotationHueOffset) % 360;
        const colorStr = `hsl(${hue}, 60%, 40%)`;

        visualizerCtx.beginPath();
        visualizerCtx.moveTo(innerX, innerY);
        visualizerCtx.lineTo(outerX, outerY);
        visualizerCtx.strokeStyle = colorStr;
        visualizerCtx.shadowColor = colorStr;
        visualizerCtx.stroke();
    }

    visualizerCtx.restore();
}

// ========================================
// ANIMATION LOOP
// ========================================

function animate() {
    if (!isRunning) return;

    // Request next frame first for smoother animation
    animationId = requestAnimationFrame(animate);

    // Calculate FPS (internal tracking only)
    const now = performance.now();
    frameCount++;
    if (now - lastFrameTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFrameTime = now;
    }

    // Get audio data
    const audioData = getAudioData();

    // Update bass level with faster response
    const currentBass = getBassLevel();
    bassLevel += (currentBass - bassLevel) * 0.4; // Faster bass response

    // Draw everything (core rendering)
    drawVisualizer(audioData);
    updateAndDrawParticles(bassLevel);

    // Check for bass hit (for particle explosion)
    if (bassLevel > 0.7 && now - lastBassHit > 100) {
        lastBassHit = now;
        triggerBassHit();
    }
}

function animateParticlesOnly() {
    if (isRunning) return; // Stop if main visualizer is running

    updateAndDrawParticles(0);
    requestAnimationFrame(animateParticlesOnly);
}

// ========================================
// UI UPDATES
// ========================================

function triggerBassHit() {
    // Add visual feedback for bass hit
    const background = document.getElementById('background-gradient');
    if (background) {
        background.classList.add('bass-hit');
        setTimeout(() => background.classList.remove('bass-hit'), 150);
    }
}

function showActiveUI() {
    const micStatus = document.getElementById('mic-status');
    const uiOverlay = document.getElementById('ui-overlay');
    const background = document.getElementById('background-gradient');

    // Hide start button area
    if (uiOverlay) uiOverlay.classList.add('minimized');

    // Show mic status
    if (micStatus) {
        setTimeout(() => {
            micStatus.style.opacity = '1';
        }, 500);
    }

    // Activate background
    if (background) background.classList.add('active');

    // Add active body class
    document.body.classList.add('visualizer-active');

    // Start auto-hide timer
    startAutoHideTimer();
}

function hideActiveUI() {
    const micStatus = document.getElementById('mic-status');
    const uiOverlay = document.getElementById('ui-overlay');
    const background = document.getElementById('background-gradient');

    // Hide mic status
    if (micStatus) micStatus.style.opacity = '0';

    // Show start button area
    if (uiOverlay) uiOverlay.classList.remove('minimized');

    // Deactivate background
    if (background) background.classList.remove('active');

    // Remove active body class
    document.body.classList.remove('visualizer-active');
}

// ========================================
// START / STOP CONTROLS
// ========================================

async function startVisualizer() {
    if (isRunning) return;

    const startBtn = document.getElementById('start-btn');
    startBtn.disabled = true;
    startBtn.querySelector('span').innerHTML = `
        <svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        MENGHUBUNGKAN...
    `;

    const success = await initAudio();

    if (success) {
        isRunning = true;
        showActiveUI();
        animate();
    } else {
        startBtn.disabled = false;
        startBtn.querySelector('span').innerHTML = `
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
            </svg>
            START VISUALIZER
        `;
    }
}

function stopVisualizer() {
    isRunning = false;

    // Clear auto-hide timer
    if (mouseIdleTimer) {
        clearTimeout(mouseIdleTimer);
        mouseIdleTimer = null;
    }
    isUIHidden = false;

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    // Stop all media tracks
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (mediaSource) {
        mediaSource.disconnect();
        mediaSource = null;
    }

    analyser = null;
    dataArray = null;

    hideActiveUI();

    // Reset button
    const startBtn = document.getElementById('start-btn');
    startBtn.disabled = false;
    startBtn.querySelector('span').innerHTML = `
        <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
        </svg>
        START VISUALIZER
    `;

    // Clear canvases
    visualizerCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Restart ambient particles
    animateParticlesOnly();
}

// ========================================
// AUTO-HIDE UI FUNCTIONS
// ========================================

function startAutoHideTimer() {
    // Clear existing timer
    if (mouseIdleTimer) {
        clearTimeout(mouseIdleTimer);
    }

    // Set new timer
    mouseIdleTimer = setTimeout(() => {
        if (isRunning) {
            hideUIElements();
        }
    }, UI_HIDE_DELAY);
}

function handleMouseMove() {
    if (!isRunning) return;

    // Show UI if hidden
    if (isUIHidden) {
        showUIElements();
    }

    // Restart auto-hide timer
    startAutoHideTimer();
}

function hideUIElements() {
    isUIHidden = true;
    const micStatus = document.getElementById('mic-status');
    if (micStatus) {
        micStatus.style.transition = 'opacity 0.5s ease-out';
        micStatus.style.opacity = '0';
    }
}

function showUIElements() {
    isUIHidden = false;
    const micStatus = document.getElementById('mic-status');
    if (micStatus) {
        micStatus.style.transition = 'opacity 0.3s ease-in';
        micStatus.style.opacity = '1';
    }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function lerp(start, end, factor) {
    return start + (end - start) * factor;
}

function map(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

// ========================================
// ERROR HANDLING
// ========================================

window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

// ========================================
// CLEANUP ON PAGE UNLOAD
// ========================================

window.addEventListener('beforeunload', () => {
    if (isRunning) {
        stopVisualizer();
    }
});
