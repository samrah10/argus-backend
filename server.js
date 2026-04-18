import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

function cleanJsonText(text = "") {
  return String(text)
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function safeParseModelJson(text = "") {
  const cleaned = cleanJsonText(text);

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const sliced = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(sliced);
      } catch {
        return null;
      }
    }

    return null;
  }
}

function normalizeResult(parsed) {
  const spokenText =
    typeof parsed?.spoken_text === "string" && parsed.spoken_text.trim()
      ? parsed.spoken_text.trim()
      : "Unable to analyze clearly. Stop and scan again.";

  const recommendedDirection =
    typeof parsed?.recommended_direction === "string" && parsed.recommended_direction.trim()
      ? parsed.recommended_direction.trim()
      : "12 o'clock";

  return {
    spoken_text: spokenText,
    recommended_direction: recommendedDirection,
  };
}

app.get("/api/health", (req, res) => {
  res.send("OK");
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { image, goal } = req.body ?? {};

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        spoken_text: "No image received.",
        recommended_direction: "12 o'clock",
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        spoken_text: "OpenAI API key is missing on the server.",
        recommended_direction: "12 o'clock",
      });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4.1";
    const cleanedGoal = typeof goal === "string" ? goal.trim() : "";

    const systemPrompt = `
You are Argus, a navigation assistant for blind or low-vision users.
Analyze a live camera frame and return JSON only.

Your job:
- detect obstacles in the walking path
- detect floor hazards such as cables, cords, mats, carpet edges, bags, clutter, steps, curbs, puddles, or small objects
- guide with short spoken instructions
- use clock directions, never degrees
- assume:
  - 12 o'clock = straight ahead
  - 3 o'clock = right
  - 9 o'clock = left
  - 1 to 2 o'clock = slight right
  - 10 to 11 o'clock = slight left
- prefer the safest route
- if the path is clear, say "Path clear, continue forward" or very close wording
- if the path is blocked, say what direction to go to avoid it
- if a goal is provided and visible, guide toward it
- if a goal is provided and not visible, say it is not visible and suggest scanning
- keep spoken_text very short, simple, and natural for speech
- do not tell the user where the obstacle is, rather tell the user how to avoid the obstacle
- do not mention uncertainty unless the image is genuinely too unclear
- do not include markdown
- do not include any extra keys

Return exactly this JSON shape:
{
  "spoken_text": "short navigation instruction",
  "recommended_direction": "12 o'clock"
}
`.trim();

    const userText = cleanedGoal
      ? `User goal: "${cleanedGoal}". Prioritize helping the user find that goal while still warning about hazards and obstacles.`
      : "No specific goal was provided. Focus on safe navigation and obstacle avoidance.";

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 140,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userText,
              },
              {
                type: "image_url",
                image_url: {
                  url: image,
                  detail: "low",
                },
              },
            ],
          },
        ],
      }),
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      const apiError =
        data?.error?.message ||
        "OpenAI request failed.";

      return res.status(openAiResponse.status).json({
        spoken_text: apiError,
        recommended_direction: "12 o'clock",
      });
    }

    const rawContent = data?.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseModelJson(rawContent);

    if (!parsed) {
      return res.json({
        spoken_text: "Unable to analyze clearly. Stop and scan again.",
        recommended_direction: "12 o'clock",
      });
    }

    return res.json(normalizeResult(parsed));
  } catch (error) {
    console.error("Analyze error:", error);

    return res.status(500).json({
      spoken_text: "Analysis failed. Stop and scan again.",
      recommended_direction: "12 o'clock",
    });
  }
});

app.listen(port, () => {
  console.log(`Argus running locally at http://localhost:${port}`);
});
