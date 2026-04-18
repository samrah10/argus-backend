import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

app.get("/api/health", (req, res) => {
  res.send("OK");
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { image, goal } = req.body;

    if (!image) {
      return res.json({
        spoken_text: "No image received",
        recommended_direction: "12 o'clock"
      });
    }

    const systemPrompt = `
You are Argus, a navigation assistant for blind users.

Rules:
- Detect obstacles and floor hazards
- Give short spoken instructions
- Use clock directions (12, 3, 6, 9)
- If clear: say "Path clear, continue forward"
- If blocked: suggest safe direction
- If goal visible: guide toward it
- If goal not visible: say not visible

Return ONLY JSON:
{
 "spoken_text": "",
 "recommended_direction": "12 o'clock"
}
`;

    const userText = goal
      ? `User goal: ${goal}`
      : "No goal provided";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: image } }
            ]
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        spoken_text: "Scan unclear, try again",
        recommended_direction: "12 o'clock"
      };
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

app.listen(port, () => {
  console.log(`Running at http://localhost:${port}`);
});
