// api/analyze.js

// 🔁 --- RETRY HELPER ---
async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);

      // If it's NOT a 503 overload, just return it.
      if (res.status !== 503) {
        return res;
      }

      // 503 -> exponential backoff and retry
      const delay = 400 * Math.pow(2, attempt); // 400ms, 800ms, 1600ms...
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (err) {
      // Network failure — retry unless last attempt
      if (attempt === retries - 1) throw err;
    }
  }

  // Last attempt: just return whatever happens
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

- aiSummary should be a short (1–2 sentence) summary of this workout
  as if explaining to a competitive swimmer what this set focuses on.
  Keep it concise and motivational.

- intensity_summary:
  - Classify yardage into 5 intensity buckets:
    * easy: warmup, cooldown, easy swim, recovery
    * aerobic: steady state, moderate effort, base pace
    * threshold: hard aerobic, pace work, interval training
    * race: race pace efforts (100 pace, 200 pace)
    * sprint: max effort, all-out speed
  - Also calculate work vs recovery:
    * work_yards: main sets, threshold, race, sprint
    * recovery_yards: warmup, easy, drills, cooldown, easy kick

- insights:
  - difficulty_score: 1-10 based on volume and intensity.
  - strain_category: "Low", "Medium", or "High".
  - focus_tags: 2-4 tags describing the session (e.g. "Threshold", "Breaststroke", "Kick heavy").
  - highlight_bullets: 3-4 short, interesting bullet points about the practice. Examples:
    * "You did 1,800 yards of freestyle."
    * "Largest continuous swim: 800 yards."
    * "Breaststroke made up 35% of total yardage."

- recovery_plan:
  Design a personalized recovery plan for this specific practice based on:
    * Intensity and strain level
    * Focus areas (strokes, body regions emphasized)
    * Distance vs sprint work
  
  Return a structured array of recovery tasks with THREE timing buckets:
    * immediate: Right after practice (0-2 hours)
    * today: Later in the day (evening, before bed)
    * tomorrow: Next session or next day
  
  For each task, provide:
    * id: unique string identifier (e.g. "task_1", "task_2")
    * text: Short, actionable instruction (e.g. "Doorway chest stretch 2×30s per side")
    * bucket: one of "immediate", "today", "tomorrow"
    * body_region: one of "shoulders", "legs", "hips", "core", "full-body"
    * kind: one of "stretch", "mobility", "easy_swim", "activation", "lifestyle"
    * include_in_quick: boolean (true = include in a short 10-15 min recovery routine)
  
  Guidelines:
    * Immediate tasks: 3-5 quick stretches/cooldown activities
    * Today tasks: 2-3 recovery activities (foam rolling, light cardio, nutrition)
    * Tomorrow tasks: 1-2 activation or preparation items
    * Mark 4-6 total tasks as include_in_quick=true for a streamlined routine
    * Focus on body regions most stressed in this practice

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
  "intensity_summary": {
    "easy_yards": number,
    "aerobic_yards": number,
    "threshold_yards": number,
    "race_yards": number,
    "sprint_yards": number,
    "work_yards": number,
    "recovery_yards": number
  },
  "insights": {
    "difficulty_score": number, // 1-10
    "strain_category": string, // "Low", "Medium", "High"
    "focus_tags": [string], // e.g. ["Threshold", "Breaststroke"]
    "highlight_bullets": [string] // 3-4 short sentences
  },
  "recovery_plan": {
    "tasks": [
      {
        "id": string, // e.g. "task_1"
        "text": string, // actionable instruction
        "bucket": string, // "immediate" | "today" | "tomorrow"
        "body_region": string, // "shoulders" | "legs" | "hips" | "core" | "full-body"
        "kind": string, // "stretch" | "mobility" | "easy_swim" | "activation" | "lifestyle"
        "include_in_quick": boolean
      }
    ]
  },
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
  "aiTip": string,
  "aiSummary": string
}

Workout text:
${text}
`;

    // 🌊 MAIN ANALYSIS REQUEST (with retry)
    const resp = await fetchWithRetry(`${ENDPOINT}?key=${apiKey}`, {
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
        merged.recoverySuggestions
          .split("\n")
          .find((l) => l.trim().length > 0) ?? "";
      merged.aiTip = firstLine.trim();
    }

    // Ensure aiSummary exists
    if (!merged.aiSummary || !String(merged.aiSummary).trim()) {
      merged.aiSummary = "No summary available.";
    }

    // Ensure recovery_plan exists and is well-formed
    if (!merged.recovery_plan || typeof merged.recovery_plan !== 'object') {
      merged.recovery_plan = { tasks: [] };
    } else if (!Array.isArray(merged.recovery_plan.tasks)) {
      merged.recovery_plan.tasks = [];
    } else {
      // Validate each task has required fields
      merged.recovery_plan.tasks = merged.recovery_plan.tasks.filter(task => {
        return task &&
          typeof task.id === 'string' &&
          typeof task.text === 'string' &&
          typeof task.bucket === 'string' &&
          typeof task.body_region === 'string' &&
          typeof task.kind === 'string' &&
          typeof task.include_in_quick === 'boolean';
      });
    }

    // ✅ RETURN FINAL RESULT
    return res.status(200).json(merged);
  } catch (err) {
    console.error("Gemini API Error:", err);

    let message = "An unexpected error occurred. Please try again.";
    const text = typeof err.message === "string" ? err.message : "";

    if (text.includes("503") || text.toLowerCase().includes("overloaded")) {
      message = "Gemini servers are currently overloaded. Try again shortly.";
    } else if (text.includes("fetch failed")) {
      message = "Network error — please check your connection.";
    }

    return res.status(500).json({
      error: message,
      details: text,
    });
  }
}
