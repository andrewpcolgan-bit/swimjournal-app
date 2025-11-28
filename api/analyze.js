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

  // ---------------------------------------------------------
  // TYPE DEFINITIONS (Reference for Response Shape)
  // ---------------------------------------------------------
  // type RecoveryExercise = {
  //   id: string;
  //   name: string;
  //   category: "STRETCH" | "MOBILITY" | "ROLLING";
  //   muscleGroups: string[];   // human-readable labels: ["Lats", "Mid back"]
  //   bodyRegions: string[];    // machine keys: ["LATS", "MID_BACK", "SHOULDERS", "LEGS", "HIPS", "CORE", "SPINE"]
  //   durationSec: number;
  //   sets: number | null;
  //   reps: number | null;
  //   sideSpecific: boolean;
  //   description: string;
  //   coachingCues: string[];
  // };
  //
  // type RecoveryBlock = {
  //   id: string;
  //   type: "STRETCH" | "MOBILITY" | "ROLLING";
  //   title: string;
  //   description: string;
  //   estimatedDurationSec: number;
  //   items: RecoveryExercise[];
  // };
  //
  // type RecoveryOtherStrategy = {
  //   id: string;
  //   type: "NUTRITION" | "HYDRATION" | "SLEEP" | "GENERAL";
  //   title: string;
  //   summary: string;
  // };
  //
  // type RecoveryPlan = {
  //   sessionSummary: {
  //     estimatedDurationSec: number;
  //     exerciseCount: number;
  //     focusRegions: string[];   // ["Low back", "Shins", "Mid back"]
  //     intensityTag: string;     // e.g. "Light recovery", "Moderate recovery"
  //   };
  //   blocks: RecoveryBlock[];
  //   otherStrategies: RecoveryOtherStrategy[];
  // };

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
    const { text, soreness } = req.body || {};
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

- aiTip should be a short 1–2 sentence coaching insight about recovery or how to approach the next similar session.
- aiSummary should be a short (1–2 sentence) summary of this workout.

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
  - focus_tags: 2-4 tags describing the session.
  - highlight_bullets: 3-4 short, interesting bullet points about the practice.

- recoveryPlan:
  Generate a JSON object called "recoveryPlan" that matches the schema below.
  
  CONTEXT:
  - Use the calculated totalYards, strokePercentages, and intensity_summary.
  - Soreness reported by user: ${soreness ? JSON.stringify(soreness) : "None reported."}
  
  STRATEGY:
  1. If yards or effort is high -> bias toward "Moderate recovery" with slightly more time and exercises.
  2. If it's a short or easy practice -> "Light recovery" with fewer total minutes.
  3. If there's no practice but soreness is logged -> gentle "Reset" session (mostly mobility + light stretches).
  4. Focus Regions:
     - FR/BK heavy -> shoulders, lats, hip flexors.
     - BR heavy -> groin, knees, low back.
     - Kick heavy -> shins, quads, hip flexors.
     - Pull heavy -> lats, upper back, shoulders.
     - Prioritize any reported soreness regions.
  5. Sets Strategy:
     - Assume 2 sets for every muscle group as the baseline.
     - Rank 2-4 muscle regions that need EXTRA work (assign 3-4 sets) because of high soreness or practice load.
     - Call out any regions that can stay LIGHT (1 set) because they were low priority / fresh.
     - Document this logic in a "setStrategy" array and mirror those numbers inside each exercise's "sets" field.
  
  STRUCTURE:
  - blocks:
    - "warmup-mobility": 1-2 MOBILITY moves (dynamic).
    - "targeted-stretch": 4-6 STRETCH moves (static holds).
    - "rolling": 1-2 ROLLING moves (optional).
  - otherStrategies:
    - Hydration, nutrition, sleep, light movement.
  
  SCHEMA:
  "recoveryPlan": {
    "sessionSummary": {
      "estimatedDurationSec": number, // 240-600 seconds (4-10 mins)
      "exerciseCount": number,
      "focusRegions": [string], // e.g. ["Low back", "Shins"]
      "intensityTag": string // "Light recovery", "Moderate recovery", "Deep recovery"
    },
    "setStrategy": [
      {
        "muscleGroup": string,      // e.g. "Lats"
        "recommendedSets": number,  // 1-4 (base 2)
        "reason": string            // short explanation
      }
    ],
    "blocks": [
      {
        "id": string, // "warmup-mobility", "targeted-stretch", "rolling"
        "type": string, // "MOBILITY", "STRETCH", "ROLLING"
        "title": string,
        "description": string,
        "estimatedDurationSec": number,
        "items": [
          {
            "id": string, // slug, e.g. "cat-cow"
            "name": string, // Display name
            "category": string, // "MOBILITY", "STRETCH", "ROLLING"
            "muscleGroups": [string], // Human readable: ["Lats", "Mid back"]
            "bodyRegions": [string], // Keys: ["LATS", "MID_BACK", "SHOULDERS", "LEGS", "HIPS", "CORE", "SPINE"]
            "durationSec": number, // usually 30-60
            "sets": number | null, // usually 1-2
            "reps": number | null, // null if time-based
            "sideSpecific": boolean, // true if needs to be done on both sides
            "description": string, // Short how-to
            "coachingCues": [string] // 1-2 tips
          }
        ]
      }
    ],
    "otherStrategies": [
      {
        "id": string,
        "type": string, // "NUTRITION", "HYDRATION", "SLEEP", "GENERAL"
        "title": string,
        "summary": string
      }
    ]
  }

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
  "intensity_summary": { ... },
  "insights": { ... },
  "recoveryPlan": { ... },
  "totalYards": number,
  "sectionYards": { ... },
  "strokePercentages": { ... },
  "practiceTag": string,
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

    let raw = data.candidates[0]?.content?.parts?.[0]?.text ?? "";
    
    // Strip markdown code blocks if present (Gemini often wraps JSON in ```json ... ```)
    raw = raw.trim();
    if (raw.startsWith("```json")) {
      raw = raw.slice(7); // Remove ```json
    } else if (raw.startsWith("```")) {
      raw = raw.slice(3); // Remove ```
    }
    if (raw.endsWith("```")) {
      raw = raw.slice(0, -3); // Remove trailing ```
    }
    raw = raw.trim();
    
    // Also handle case where it starts with just "json" label
    if (raw.toLowerCase().startsWith("json\n") || raw.toLowerCase().startsWith("json\r")) {
      raw = raw.slice(4).trim();
    }
    
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error("JSON Parse Error:", parseErr.message);
      console.error("Raw content (first 500 chars):", raw.substring(0, 500));
      parsed = { rawOutput: raw, parseError: parseErr.message };
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

    // Ensure recoveryPlan exists and is well-formed
    if (!merged.recoveryPlan || typeof merged.recoveryPlan !== 'object') {
      merged.recoveryPlan = {
        sessionSummary: {
          estimatedDurationSec: 0,
          exerciseCount: 0,
          focusRegions: [],
          intensityTag: "Light recovery"
        },
        setStrategy: [],
        blocks: [],
        otherStrategies: []
      };
    } else {
      // Validate sessionSummary
      if (!merged.recoveryPlan.sessionSummary) {
        merged.recoveryPlan.sessionSummary = {
          estimatedDurationSec: 0,
          exerciseCount: 0,
          focusRegions: [],
          intensityTag: "Light recovery"
        };
      }

      // Validate setStrategy
      if (!Array.isArray(merged.recoveryPlan.setStrategy)) {
        merged.recoveryPlan.setStrategy = [];
      }

      // Validate blocks
      if (!Array.isArray(merged.recoveryPlan.blocks)) {
        merged.recoveryPlan.blocks = [];
      } else {
        // Filter out invalid blocks and normalize items
        merged.recoveryPlan.blocks = merged.recoveryPlan.blocks
          .filter(
            (block) => block && typeof block.id === "string" && Array.isArray(block.items)
          )
          .map((block) => ({
            ...block,
            items: block.items.map((item) => {
              const normalizedSets =
                typeof item?.sets === "number" && item.sets > 0 ? item.sets : 2;
              return {
                ...item,
                sets: normalizedSets,
                coachingCues: Array.isArray(item?.coachingCues) ? item.coachingCues : [],
              };
            }),
          }));
      }

      // Validate otherStrategies
      if (!Array.isArray(merged.recoveryPlan.otherStrategies)) {
        merged.recoveryPlan.otherStrategies = [];
      }
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
