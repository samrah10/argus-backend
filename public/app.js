const elements = {
  video: document.getElementById('video'),
  canvas: document.getElementById('captureCanvas'),
  startCameraBtn: document.getElementById('startCameraBtn'),
  testVoiceBtn: document.getElementById('testVoiceBtn'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  autoScanBtn: document.getElementById('autoScanBtn'),
  intervalSelect: document.getElementById('intervalSelect'),
  qualitySelect: document.getElementById('qualitySelect'),
  healthPill: document.getElementById('healthPill'),
  cameraState: document.getElementById('cameraState'),
  scanState: document.getElementById('scanState'),
  urgencyBadge: document.getElementById('urgencyBadge'),
  spokenText: document.getElementById('spokenText'),
  recommendedValue: document.getElementById('recommendedValue'),
  actionValue: document.getElementById('actionValue'),
  blockedValue: document.getElementById('blockedValue'),
  alternativesValue: document.getElementById('alternativesValue'),
  angleValue: document.getElementById('angleValue'),
  distanceValue: document.getElementById('distanceValue'),
  pathValue: document.getElementById('pathValue'),
  reasonValue: document.getElementById('reasonValue'),
  obstacleList: document.getElementById('obstacleList'),
  floorHazardList: document.getElementById('floorHazardList')
};

let mediaStream = null;
let autoScanTimer = null;
let isAnalyzing = false;
let lastAnalysis = null;
let lastSpokenText = '';
let lastSpokenAt = 0;

bootstrap();

function bootstrap() {
  bindEvents();
  loadHealth();
}

function bindEvents() {
  elements.startCameraBtn.addEventListener('click', startCamera);
  elements.testVoiceBtn.addEventListener('click', () => speak('Argus voice check. Obstacle ahead. Move 20 degrees right for 10 feet.'));
  elements.analyzeBtn.addEventListener('click', analyzeCurrentFrame);
  elements.autoScanBtn.addEventListener('click', toggleAutoScan);
  elements.intervalSelect.addEventListener('change', () => {
    if (autoScanTimer) {
      stopAutoScan(false);
      startAutoScan();
    }
  });
}

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    if (!data.ok) throw new Error('Health check failed.');
    elements.healthPill.textContent = data.mockMode ? 'Mock mode' : `Live · ${data.model}`;
  } catch (error) {
    console.error(error);
    elements.healthPill.textContent = 'Server offline';
  }
}

async function startCamera() {
  try {
    if (mediaStream) {
      updateStatusText('Camera already running.');
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    elements.video.srcObject = mediaStream;
    elements.cameraState.textContent = 'On';
    updateStatusText('Camera started.');
  } catch (error) {
    console.error(error);
    updateStatusText('Camera access failed.');
    speak('Camera access failed.');
  }
}

async function analyzeCurrentFrame() {
  if (!mediaStream) {
    updateStatusText('Start the camera first.');
    speak('Start the camera first.');
    return;
  }

  if (isAnalyzing) return;
  isAnalyzing = true;
  elements.scanState.textContent = 'Analyzing…';
  elements.analyzeBtn.disabled = true;

  try {
    const imageDataUrl = captureFrameDataUrl();
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl, previousAnalysis: lastAnalysis })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Analyze request failed.');
    }

    renderAnalysis(data.analysis);
    if (shouldSpeakAnalysis(data.analysis)) {
      speak(buildSpeechText(data.analysis, lastAnalysis));
    }
    lastAnalysis = data.analysis;
  } catch (error) {
    console.error(error);
    updateStatusText(error.message || 'Analyze failed.');
    speak('Analyze failed.');
  } finally {
    isAnalyzing = false;
    elements.scanState.textContent = autoScanTimer ? 'Auto scanning every 1 second' : 'Idle';
    elements.analyzeBtn.disabled = false;
  }
}

function captureFrameDataUrl() {
  const video = elements.video;
  const canvas = elements.canvas;
  const maxWidth = 960;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const quality = Number(elements.qualitySelect.value || '0.6');

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

function renderAnalysis(analysis) {
  elements.spokenText.textContent = analysis.spoken_text;
  elements.recommendedValue.textContent = analysis.recommended_direction;
  elements.actionValue.textContent = analysis.action;
  elements.blockedValue.textContent = analysis.blocked_directions.length ? analysis.blocked_directions.join(', ') : 'none';
  elements.alternativesValue.textContent = analysis.alternative_directions.length ? analysis.alternative_directions.join(', ') : 'none';
  elements.angleValue.textContent = `${analysis.walking_angle_degrees}°`;
  elements.distanceValue.textContent = `${analysis.move_distance_feet} ft`;
  elements.pathValue.textContent = analysis.path_status;
  elements.reasonValue.textContent = analysis.reason;
  elements.urgencyBadge.textContent = capitalize(analysis.urgency);
  elements.urgencyBadge.className = `urgency ${analysis.urgency}`;

  if (!analysis.obstacles.length) {
    elements.obstacleList.innerHTML = '<li>No major obstacle detected.</li>';
  } else {
    elements.obstacleList.innerHTML = analysis.obstacles
      .map((obstacle) => `<li><strong>${escapeHtml(obstacle.type)}</strong> · ${escapeHtml(obstacle.position)} · ${escapeHtml(obstacle.distance)} · ${escapeHtml(obstacle.severity)}${obstacle.floor_hazard === 'yes' ? ' · floor hazard' : ''}</li>`)
      .join('');
  }

  if (!analysis.floor_hazards.length) {
    elements.floorHazardList.innerHTML = '<li>No floor hazard detected.</li>';
  } else {
    elements.floorHazardList.innerHTML = analysis.floor_hazards
      .map((hazard) => `<li><strong>${escapeHtml(hazard.type)}</strong> · ${escapeHtml(hazard.position)} · ${escapeHtml(hazard.distance)} · ${escapeHtml(hazard.warning)}</li>`)
      .join('');
  }
}

function updateStatusText(text) {
  elements.spokenText.textContent = text;
}

function toggleAutoScan() {
  if (autoScanTimer) {
    stopAutoScan();
    return;
  }
  startAutoScan();
}

function startAutoScan() {
  if (!mediaStream) {
    updateStatusText('Start the camera before auto scan.');
    speak('Start the camera before auto scan.');
    return;
  }

  const intervalMs = Number(elements.intervalSelect.value || '1000');
  autoScanTimer = window.setInterval(() => {
    if (!isAnalyzing) analyzeCurrentFrame();
  }, intervalMs);

  elements.autoScanBtn.textContent = 'Stop Auto Scan';
  elements.scanState.textContent = 'Auto scanning every 1 second';
  speak('Auto scan started.');
}

function stopAutoScan(announce = true) {
  if (autoScanTimer) {
    window.clearInterval(autoScanTimer);
    autoScanTimer = null;
  }

  elements.autoScanBtn.textContent = 'Start Auto Scan';
  elements.scanState.textContent = 'Idle';
  if (announce) speak('Auto scan stopped.');
}

function shouldSpeakAnalysis(next) {
  if (!lastAnalysis) return true;

  const changed =
    next.recommended_direction !== lastAnalysis.recommended_direction ||
    next.action !== lastAnalysis.action ||
    next.urgency !== lastAnalysis.urgency ||
    next.path_status !== lastAnalysis.path_status ||
    next.walking_angle_degrees !== lastAnalysis.walking_angle_degrees ||
    next.move_distance_feet !== lastAnalysis.move_distance_feet ||
    firstObstacleKey(next) !== firstObstacleKey(lastAnalysis) ||
    firstFloorHazardKey(next) !== firstFloorHazardKey(lastAnalysis) ||
    next.blocked_directions.join('|') !== lastAnalysis.blocked_directions.join('|');

  if (changed) return true;

  const now = Date.now();
  return now - lastSpokenAt > 7000 && next.action !== 'move';
}

function buildSpeechText(next, previous) {
  if (!previous) return next.spoken_text;

  const sameGuidance =
    next.recommended_direction === previous.recommended_direction &&
    next.action === previous.action &&
    next.path_status === previous.path_status &&
    next.walking_angle_degrees === previous.walking_angle_degrees &&
    next.move_distance_feet === previous.move_distance_feet &&
    firstObstacleKey(next) === firstObstacleKey(previous) &&
    firstFloorHazardKey(next) === firstFloorHazardKey(previous);

  if (sameGuidance) {
    if (next.recommended_direction === 'forward') return `Keep forward for ${next.move_distance_feet} feet.`;
    if (next.recommended_direction === 'stop') return 'Still blocked. Stop.';
    return `Keep ${Math.abs(next.walking_angle_degrees)} degrees ${next.walking_angle_degrees < 0 ? 'left' : 'right'} for ${next.move_distance_feet} feet.`;
  }

  return next.spoken_text;
}

function firstObstacleKey(analysis) {
  const first = analysis?.obstacles?.[0];
  if (!first) return 'none';
  return `${first.type}|${first.position}|${first.distance}|${first.severity}|${first.floor_hazard}`;
}

function firstFloorHazardKey(analysis) {
  const first = analysis?.floor_hazards?.[0];
  if (!first) return 'none';
  return `${first.type}|${first.position}|${first.distance}|${first.warning}`;
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;

  const now = Date.now();
  const normalized = String(text || '').trim();
  if (!normalized) return;

  if (normalized === lastSpokenText && now - lastSpokenAt < 4000) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(normalized);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);

  lastSpokenText = normalized;
  lastSpokenAt = now;
}

function capitalize(value) {
  if (!value) return 'Unknown';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
