// api/analyze.js
// Free alternative using Google Gemini 1.5 Flash API
// Make sure to set GEMINI_API_KEY in your Vercel environment variables

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(401).json({ error: "Missing Gemini API key" });
  }

  try {
    const { text } = req.body;
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "No text provided" });
    }

    const prompt = `
You are an expert swim coach and workout analyzer.
Return ONLY valid JSON (no extra words, no markdown).

Analyze this swim workout and reply with:
{
  "totalYards": number,
  "sectionYards": {"Warmup": number, "Main Set": number, "Cool Down": number},
  "strokePercentages": {"Freestyle": number, "Backstroke": number, "Breaststroke": number, "Butterfly": number, "Drill": number, "Kick": number},
  "aiTip": string
}

Workout:
${text}
`;

Workout:
${text}
`;

    // Gemini endpoint
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    const output = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = { rawOutput: output };
    }

    res.status(200).json(parsed);
  } catch (error) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: "Server error: " + error.message });
  }
}
