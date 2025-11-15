// api/analyze.js

// 🔁 --- RETRY HELPER ---
async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);

      // Success OR a real error that's not retryable
      if (res.status !== 503) {
        return res;
      }

      // Otherwise retry after exponential backoff
      const delay = 400 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (err) {
      // Network failure — retry unless last attempt
      if (attempt === retries - 1) throw err;
    }
  }

  // Last attempt
  return fetch(url, options);
}

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
- practiceTag should be a short phrase summarizing the workout type, like:
  "sprint set", "threshold free", "aerobic IM", "kick-heavy", "pull-heavy", "race-pace", etc.

- recoverySuggestions must be a MULTI-LINE text block describing individual stretches and recovery items.
  Each line must describe exactly ONE stretch or recovery item, using this format:

  Stretch Name (Main Area, Secondary Area): Short how-to sentence. • dose

  Where:
    - Stretch Name = concise name like "Doorway Chest Stretch"
    - Main/Secondary Area = 1–3 body areas, e.g. "Pectorals, Shoulders"
    - Short how-to sentence = 1 short sentence on how to do the stretch
    - dose = how many sets/seconds, like "2×30s", "3×20s per side", "60s easy swim"

  Examples of valid lines:
    Doorway Chest Stretch (Pectorals, Shoulders): Stand in a doorway, forearms on the frame at shoulder height, gently lean chest forward. • 2×30s
    Overhead Lat Stretch (Lats, Obliques): Reach one arm overhead and gently bend to the opposite side. • 2×30s per side
    Child’s Pose (Back, Hips): Kneel on your heels, fold forward with arms extended, breathe slowly. • 2×45s

  - You are NOT limited by word count. Include as many lines as are useful (usually 4–7).
  - Prioritize body areas that are most stressed by this workout:
      * shoulders and lats for freestyle/backstroke
      * hips and adductors for breaststroke
      * shoulders/chest/core for butterfly
      * hips/legs for kick-heavy sets
  - It’s okay if you occasionally include a short cool-down swim as one "stretch line" following the same format.

- aiTip should be a short 1–2 sentence coaching insight about recovery or how to approach the next similar session.
  It should be separate from recoverySuggestions.

Identify strokes by keywords:
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
  "practiceTag": string,
  "recoverySuggestions": string,
  "aiTip": string
}

Workout text:
${text}
`;

    // 🌊 STEP 1: MAIN ANALYSIS REQUEST
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

    const merged =
      parsed && typeof parsed === "object" ? { ...parsed } : { rawOutput: raw };

    // Normalize aiTip: if missing, derive a tiny hint from the first recovery line
    if (
      (!merged.aiTip || !String(merged.aiTip).trim()) &&
      typeof merged.recoverySuggestions === "string"
    ) {
      const firstLine =
        merged.recoverySuggestions.split("\n").find((l) => l.trim().length > 0) ??
        "";
      merged.aiTip = firstLine.trim();
    }

    // 🧩 STEP 2: AI SUMMARY GENERATION (with retry)
    const summaryPrompt = `
You are an elite swim coach. Write a short (1–2 sentence) summary of this workout
as if explaining to a competitive swimmer what this set focuses on.
Keep it concise and motivational.

Workout:
${text}
`;

    const summaryResp = await fetchWithRetry(`${ENDPOINT}?key=${apiKey}`, {
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
      ...merged,
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
