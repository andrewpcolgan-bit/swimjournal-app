// api/analyze.js

export default async function handler(req, res) {
  const MODEL = "models/gemini-2.5-flash";
  const ENDPOINT = `https://generativelanguage.googleapis.com/v1/${MODEL}:generateContent`;

  // Simple diagnostics route
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      model: MODEL,
      endpoint: ENDPOINT,
      build: process.env.VERCEL_GIT_COMMIT_SHA || "local",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(401).json({ error: "Missing Gemini API key" });
  }

  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "No text provided" });
    }

    // Enhanced analysis prompt
    const prompt = `
You are an expert swim coach and workout analyzer. 
Your task is to read a swim practice text (often copied from a whiteboard or Commit Swimming printout)
and output a structured JSON analysis.

Follow these exact instructions:
- Return ONLY valid JSON. No markdown, no commentary.
- Always include the same 4 sections in this order:
  "Warmup", "Preset", "Main Set", "Cooldown"
- Estimate yardage for each section by summing all sets that fit these rules:

  Warmup:
    - Usually the first group of sets, often includes "swim", "kick", "drill", or "pull".
    - Light effort or easy pace.
  
  Preset:
    - Includes all "Preset", "Pre-set", "Drill", "Kick", or "Technique" sets before the main workout.
    - Group all such sets together (Kick Set, Drill Set, Pre Set, Technique Set), but keep them as distinct sets
  
  Main Set:
    - The longest, most intense part of the workout.
    - Often includes intervals (@1:30, descend, hold pace, race tempo, etc.).
    - If multiple main sets exist, sum them.
  
  Cooldown:
    - The final part with low yardage or words like "easy", "smooth", "warm down", "choice".

- Even if some sections are missing, include them in the JSON with value 0.

Also:
- totalYards = sum of all sections.
- strokePercentages should estimate proportions of each stroke mentioned in the text.
- aiTip should be a concise coaching insight (1-3 sentences) summarizing the workout’s focus and what the swimmer should pay attention to.

Return JSON in this exact structure:
{
  "totalYards": number,
  "sectionYards": {
    "Warmup": number,
    "Preset": number,
    "Main Set": number,
    "Cooldown": number
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

Workout text:
${text}
`;

    // Send to Gemini
    const resp = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    });

    const data = await resp.json();

    if (!data?.candidates?.length) {
      return res.status(500).json({
        error: "Gemini returned no output",
        details: data,
      });
    }

    const raw = data.candidates[0]?.content?.parts?.[0]?.text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { rawOutput: raw };
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Gemini API Error:", err);
    return res.status(500).json({
      error: "Server error: " + (err?.message || String(err)),
    });
  }
}
