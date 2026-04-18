const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const output = document.getElementById("output");

let goal = "";
let scanning = false;

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
}

function setGoal() {
  goal = prompt("Enter goal (example: find the door)");
  if (goal) {
    speak("Looking for " + goal);
  }
}

function speak(text) {
  const msg = new SpeechSynthesisUtterance(text);
  speechSynthesis.speak(msg);
}

function captureFrame() {
  const ctx = canvas.getContext("2d");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg");
}

async function scan() {
  const image = captureFrame();

  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ image, goal })
  });

  const data = await res.json();

  output.innerText = data.spoken_text;
  speak(data.spoken_text);
}

function startScan() {
  scanning = true;

  setInterval(() => {
    if (scanning) scan();
  }, 3000);
}
