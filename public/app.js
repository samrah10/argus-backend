let video = document.getElementById("video");
let statusText = document.getElementById("status");

let lastText = "";
let lastTime = 0;
let userGoal = "";

const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.lang = "en-US";

function startListening() {
  recognition.start();
}

recognition.onresult = (event) => {
  userGoal = event.results[0][0].transcript;
  statusText.textContent = "Goal: " + userGoal;
  speak("Looking for " + userGoal);
};

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
}

function speak(text) {
  if (!text) return;

  if (text !== lastText && Date.now() - lastTime > 1500) {
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
    lastText = text;
    lastTime = Date.now();
  }
}

async function analyzeFrame() {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  const image = canvas.toDataURL("image/jpeg");

  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      image,
      goal: userGoal
    })
  });

  const data = await res.json();

  statusText.textContent = data.spoken_text;
  speak(data.spoken_text);
}

function startScan() {
  setInterval(analyzeFrame, 700);
}
