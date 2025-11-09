// api/analyze.js
import OpenAI from "openai";

export default async function handler(req, res) {
  // Check that we're receiving a POST request
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Load OpenAI key from environment (set in Vercel)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(401).json({ error: "Missing OpenAI API key" });
  }

  const openai = new OpenAI({ apiKey });

  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "No text provided" });
    }

    // This is the “smart” prompt for workout parsing
    const prompt = `
You are an expert swim coach and data analyst.
Analyze the swim workout below. Return **two things**:
1️⃣ A formatted, human-readable breakdown (with emojis and clear section headers).
2️⃣ A valid JSON object summarizing totals, following this exact structure:

{
  "totalYards": number,
  "durationMinutes": number,
  "sectionYards": {
    "Warmup": number,
    "Kick": number,
    "Drill": number,
    "Main Set": number,
    "Pull": number,
    "Sprint Finisher": number,
    "Cool Down": number
  },
  "strokePercentages": {
    "Freestyle": number,
    "Backstroke": number,
    "Breaststroke": number,
    "Butterfly": number,
    "Drill": number,
    "Kick": number
  },
  "aiTip": string
}

The formatted breakdown should look like:
🏊‍♂️ Workout Breakdown
Warmup — 700 yards
Kick — 1000 yards
...
Then include total yardage and percentages summary at the bottom.

Text to analyze:
${text}
`;

    // Send the prompt to OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "You are a structured data extractor and swim coach." },
        { role: "user", content: prompt }
      ]
    });

    const message = completion.choices[0]?.message?.content || "";

    // Extract JSON block from AI output
    const jsonMatch = message.match(/\{[\s\S]*\}/);
    let jsonData = {};

    try {
      jsonData = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (err) {
      console.error("JSON parse error:", err);
    }

    // Send everything back to the app
    res.status(200).json({
      formattedText: message,
      ...jsonData
    });

  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: "Server error: " + error.message });
  }
}
