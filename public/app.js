const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const startCameraBtn = document.getElementById("startCameraBtn");
const autoScanBtn = document.getElementById("autoScanBtn");
const setGoalBtn = document.getElementById("setGoalBtn");
const stopScanBtn = document.getElementById("stopScanBtn");
const statusText = document.getElementById("statusText");
const goalText = document.getElementById("goalText");
const spokenText = document.getElementById("spokenText");
const directionText = document.getElementById("directionText");

const ctx = canvas.getContext("2d");

let stream = null;
let isScanning = false;
let scanTimer = null;
let inFlight = false;
let currentGoal = "";
let goalConfirmedFor = "";
let lastSpokenMessage = "";
let lastSpokenTime = 0;

const SCAN_INTERVAL_MS = 10000;
const DUPLICATE_SPEECH_WINDOW_MS = 8000;

function setStatus(message, kind = "warn") {
  statusText.textContent = message;
  statusText.className = `value ${kind === "ok" ? "status-ok" : "status-warn"}`;
}

function updateGoalDisplay() {
  goalText.textContent = currentGoal || "None";
}

function updateAnalysisDisplay(message, direction) {
  spokenText.textContent = message || "Nothing spoken yet.";
  directionText.textContent = direction || "12 o'clock";
}

function normalizeGoal(text) {
  return String(text || "")
    .trim()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

function speak(text, force = false) {
  const message = String(text || "").trim();
  if (!message || !("speechSynthesis" in window)) {
    return;
  }

  const now = Date.now();
  const isDuplicate = message === lastSpokenMessage && now - lastSpokenTime < DUPLICATE_SPEECH_WINDOW_MS;

  if (isDuplicate && !force) {
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);

  lastSpokenMessage = message;
  lastSpokenTime = now;
}

async function startCamera() {
  if (stream) {
    setStatus("Camera already running.", "ok");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera API is not supported in this browser.");
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    setStatus("Camera started.", "ok");
  } catch (error) {
    console.error("Camera error:", error);
    setStatus("Could not access camera.");
  }
}

function stopScan() {
  isScanning = false;

  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }

  setStatus("Auto scan stopped.");
}

function captureFrame() {
  if (!video.videoWidth || !video.videoHeight) {
    return null;
  }

  const maxWidth = 640;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

async function analyzeFrame() {
  if (inFlight) {
    return;
  }

  const image = captureFrame();
  if (!image) {
    setStatus("Waiting for video frame.");
    return;
  }

  inFlight = true;
  setStatus("Analyzing view...", "ok");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        image,
        goal: currentGoal
      })
    });

    const data = await response.json();
    const message = typeof data?.spoken_text === "string" ? data.spoken_text.trim() : "";
    const direction = typeof data?.recommended_direction === "string" ? data.recommended_direction.trim() : "12 o'clock";

    updateAnalysisDisplay(message, direction);

    if (message) {
      speak(message);
    }

    if (response.ok) {
      setStatus("Scan complete.", "ok");
    } else {
      setStatus("Server returned an error.");
    }
  } catch (error) {
    console.error("Analyze error:", error);
    setStatus("Failed to reach local server.");
    updateAnalysisDisplay("Analysis failed.", "12 o'clock");
  } finally {
    inFlight = false;
  }
}

async function startAutoScan() {
  if (isScanning) {
    setStatus("Auto scan already running.", "ok");
    return;
  }

  if (!stream) {
    await startCamera();
  }

  if (!stream) {
    return;
  }

  isScanning = true;
  setStatus("Auto scan running.", "ok");

  await analyzeFrame();

  scanTimer = setInterval(() => {
    analyzeFrame();
  }, SCAN_INTERVAL_MS);
}

function applyGoal(goal) {
  const normalized = normalizeGoal(goal);

  if (!normalized) {
    currentGoal = "";
    goalConfirmedFor = "";
    updateGoalDisplay();
    setStatus("Goal cleared.");
    return;
  }

  currentGoal = normalized;
  updateGoalDisplay();
  setStatus(`Goal set: ${currentGoal}`, "ok");

  if (goalConfirmedFor !== currentGoal) {
    const confirmation = `Looking for ${currentGoal}`;
    speak(confirmation, true);
    goalConfirmedFor = currentGoal;
  }
}

function setGoalFromPrompt() {
  const manualGoal = window.prompt("Enter a goal, for example: find the door");
  if (manualGoal !== null) {
    applyGoal(manualGoal);
  }
}

function setGoalByVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    setGoalFromPrompt();
    return;
  }

  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  window.speechSynthesis?.cancel();
  setStatus("Listening for goal...", "ok");

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    applyGoal(transcript);
  };

  recognition.onerror = () => {
    setStatus("Voice goal input failed. Using manual input.");
    setGoalFromPrompt();
  };

  recognition.onend = () => {
    if (!currentGoal) {
      setStatus("Voice input ended.");
    }
  };

  recognition.start();
}

startCameraBtn.addEventListener("click", startCamera);
autoScanBtn.addEventListener("click", startAutoScan);
stopScanBtn.addEventListener("click", stopScan);
setGoalBtn.addEventListener("click", setGoalByVoice);

window.addEventListener("beforeunload", () => {
  stopScan();

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
});

updateGoalDisplay();
updateAnalysisDisplay("", "12 o'clock");
