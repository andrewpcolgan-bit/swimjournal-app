// api/analyze.js

export default async function handler(req, res) {
  // === CHANGE THIS ONE LINE IF YOU EVER SWITCH MODELS ===
  const MODEL = "models/gemini-2.5-flash";        // <- valid model per your ListModels output
  const ENDPOINT = `https://generativelanguage.googleapis.com/v1/${MODEL}:generateContent`;

  // quick diagnostics on GET so we can see what code is deployed
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      method: "GET",
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

    // prompt
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

    // call Gemini
    const resp = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    });

    const data = await resp.json();

    if (!data?.candidates?.length) {
      return res.status(500).json({ error: "Gemini returned no output", details: data });
    }

    const raw = data.candidates[0]?.content?.parts?.[0]?.text ?? "";
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { rawOutput: raw }; }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Gemini API Error:", err);
    return res.status(500).json({ error: "Server error: " + (err?.message || String(err)) });
  }
}
