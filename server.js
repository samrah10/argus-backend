import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

app.get("/api/health", (req, res) => {
  res.send("OK");
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { image, goal } = req.body;

    const prompt = `
You are Argus, a navigation assistant for a blind user.

User goal: ${goal || "none"}

Analyze the image and:
- Identify obstacles in path
- Identify floor hazards (cables, mats, objects)
- Guide movement safely
- Use CLOCK directions only (12, 1–2, 3, 10–11)

Rules:
- Never say "turn" without reason
- If path clear: "Path clear, continue forward"
- If obstacle: give avoidance direction
- If goal visible: guide toward it
- If goal not visible: suggest scanning

Return JSON:

{
  "obstacles": [],
  "floor_hazards": [],
  "recommended_direction": "12 o'clock",
  "action": "move",
  "goal_seen": false,
  "spoken_text": ""
}

Spoken text must be under 8 words.
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              {
                type: "input_image",
                image_url: image
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    let text = data.output?.[0]?.content?.[0]?.text || "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        spoken_text: "Scanning environment",
        recommended_direction: "12 o'clock"
      };
    }

    // Fix dumb turning
    if (!parsed.obstacles?.length && parsed.recommended_direction !== "12 o'clock") {
      parsed.spoken_text = "Path clear, continue forward";
      parsed.recommended_direction = "12 o'clock";
    }

    res.json(parsed);

  } catch (err) {
    console.error(err);
    res.json({
      spoken_text: "Error analyzing",
      recommended_direction: "12 o'clock"
    });
  }
});

app.listen(PORT, () => {
  console.log("Argus running on port " + PORT);
});
