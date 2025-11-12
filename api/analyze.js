// api/analyze.js

export default async function handler(req, res) {
  const MODEL = "models/gemini-2.5-flash";
  const ENDPOINT = `https://generativelanguage.googleapis.com/v1/${MODEL}:generateContent`;

  // Diagnostics route
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

    // -----------------------
    // 🧠 MAIN ANALYSIS PROMPT
    // -----------------------
    const prompt = `
You are an expert swim coach and workout analyzer.
Your task is to read a swim practice text (often copied from a whiteboard or Commit Swimming printout)
and output a structured JSON analysis.

Follow these exact instructions:
- Return ONLY valid JSON. No markdown, no commentary.
- Always include the same 5 sections in this order:
  "Warmup", "Preset", "Main Set", "Post-Set", "Cooldown"
- Estimate yardage for each section by summing all sets that fit these rules:

Warmup:
  - Usually the first group of sets, often includes "swim", "kick", "drill", or "pull".
  - Light effort or easy pace.

Preset:
  - Includes all "Preset", "Pre-set", "Drill", "Kick", or "Technique" sets before the main workout.
  - Group all such sets together (Kick Set, Drill Set, Pre Set, Technique Set).
  - Typically lighter and shorter than the main set but more structured than warmup.

Main Set:
  - Appears AFTER warm-up and pre-set sections.
  - Usually the longest and most intense block with multiple rounds, intervals (@1:30, @:50, etc.), and pacing cues (descend, build, threshold, etc.).
  - May include several sub-blocks or race-pace work.
  - Contains the majority of the total yardage.

Post-Set:
  - Any work that appears AFTER the main set but BEFORE the final easy swim or cooldown.
  - Could be labeled “Post Set”, “Pull”, “Technique”, or similar.
  - Sometimes includes short speed work, recovery, or skill-based drills.
  - Treat as a separate section if it’s clearly not cooldown.

Cooldown:
  - Appears at the VERY END of the workout.
  - Usually low yardage (100–400), easy pace.
  - Look for words like “easy”, “smooth”, “choice”, “EZ”, or “warm down”.
  - Typically includes simple short distances (25s, 50s, 100s).

Even if some sections are missing, include them in the JSON with value 0.

Also:
- totalYards = sum of all section yardages.
- strokePercentages should estimate proportions of each stroke mentioned in the text.
- aiTip should be a concise coaching insight (1–3 sentences) summarizing the workout’s focus and what the swimmer should pay attention to.
- Identify strokes by keywords:
  * Freestyle: "free", "fr", "aerobic", "descend", "build" (if unlabeled, assume free)
  * Backstroke: "back", "bk"
  * Breaststroke: "breast", "br"
  * Butterfly: "fly"
  * IM: "IM", "individual medley"
  * Kick: "kick"
  * Drill: "drill"
  * Drill/Swim: "drill/swim", "sw/dr"
  * Pull: "pull", "paddles"
  * Choice: "choice", "any stroke"

Return JSON in this exact structure:
{
  "totalYards": number,
  "sectionYards": {
    "Warmup": number,
    "Preset": number,
    "Main Set": number,
    "Post-Set": number,
    "Cooldown": number
  },
  "strokePercentages": {
    "Freestyle": number,
    "Backstroke": number,
    "Breaststroke": number,
    "Butterfly": number,
    "Kick": number,
    "Drill": number,
    "Drill/Swim": number,
    "Pull": number,
    "Choice": number,
    "IM": number
  },
  "aiTip": string
}

Workout text:
${text}
`;

    // 🌊 STEP 1: MAIN ANALYSIS REQUEST (single attempt)
    const resp = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Gemini API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();

    if (!data?.candidates?.length) {
      return res.status(503).json({
        error: "Gemini is temporarily unavailable. Please try again shortly.",
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

    // 🧩 STEP 2: AI SUMMARY GENERATION (single attempt)
    const summaryPrompt = `
You are an elite swim coach. Write a short (1–2 sentence) summary of this workout
as if explaining to a competitive swimmer what this set focuses on.
Keep it concise and motivational.

Workout:
${text}
`;

    const summaryResp = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: summaryPrompt }] }],
      }),
    });

    const summaryData = await summaryResp.json();
    const aiSummary =
      summaryData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No summary available.";

    // ✅ STEP 3: RETURN MERGED RESULT
    return res.status(200).json({
      ...parsed,
      aiSummary,
    });
  } catch (err) {
    console.error("Gemini API Error:", err);

    let message = "An unexpected error occurred. Please try again.";
    if (err.message.includes("503") || err.message.includes("overloaded")) {
      message = "Gemini servers are currently overloaded. Try again shortly.";
    } else if (err.message.includes("fetch failed")) {
      message = "Network error — please check your connection.";
    }

    return res.status(500).json({
      error: message,
      details: err.message,
    });
  }
}
