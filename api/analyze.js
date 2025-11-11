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

    // -----------------------
    // 🧠 MAIN ANALYSIS PROMPT
    // -----------------------
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
  
  Presets:
    - Includes all "Preset", "Pre-set", "Drill", "Kick", or "Technique" sets before the main workout.
    - Group all such sets together (Kick Set, Drill Set, Pre Set, Technique Set), but keep them as distinct sets
    - There is usually the first group of sets and that is the warm up, and then 
      there will the pre sets and before the mainset, even though they are seperated by spaces, 
      they are all still presets even if not labelled. Also look at the contents and dificullty 
      of the sets relative to other sets in the set to help determine where the distinction is between
      the pre-sets and the main set
      
  
  Main Set:
    "You are analyzing handwritten swim practice workout sheets from college-level competitive swimming. Your task is to identify and extract the MAIN SET section.
    Identification Rules:
        	1.	Location: The main set appears AFTER warm-up and pre-set sections, typically in the latter half of the workout
        	2.	Markers: Look for explicit labels like ‘Main Set’, ‘–Main Set–’, ‘Main’, or the numerical start after clearly marked pre-set sections end
        	3.	Duration: It’s the longest continuous workout block with multiple components
        	4.	Structure: Contains multiple repeated sets (X2, X3, X4, X5, X6, etc.) with distances ranging typically from 50-200 yards
        	5.	Complexity: Includes intensity variations within rounds (descend patterns, mixed strokes, pace percentages like ‘85%’, ‘fast’, ‘moderate’, ‘build’)
        	6.	Intervals: Contains explicit rest/pace intervals in format @X:XX or @:XX (e.g., @1:10, @:50)
        What to Include:
        	•	All repeating segment information (quantities, distances, stroke types, intensity cues)
        	•	Interval timing and rest periods
        	•	Any modifiers (descend 1-3, fast on odd rounds, etc.)
        	•	Supplementary work (kick, pull, drill variations within the set)
        What to Exclude:
        	•	Warm-up sections at the top
        	•	Pre-set sections
        	•	Easy cool-down yardage at the end
        	•	Technique/recovery sections marked separately"
  Post-Sets
          - Look for anyting after the mainset but before the last easy block of yards at the end
          - Could be marked "post sets" "pull" or similiar
          - Sometimes also a technique set 
        Cooldown:
          Identification Rules:
      	1.	Location: The cool-down appears at the VERY END of the workout, after all main sets, technique work, and supplementary sets are complete
      	2.	Explicit Labels: Look for these section headers:
      	•	“Warm Down” or “Warm-Down”
      	•	“Cool Down” or “Cool-Down”
      	•	Sometimes appears without a label as the final 2-4 lines of the workout
      	3.	Distance Characteristics:
      	•	Total yardage typically ranges from 100-400 yards
      	•	Individual distances are small: 25s, 50s, 100s, or 200s
      	•	Usually 2-4 simple exercises total
      	4.	Intensity Markers: Look for these key descriptors (CRITICAL indicators):
      	•	“easy” or “Easy”
      	•	“smooth”
      	•	“choice”
      	•	“EZ” or “Ez”
      	•	Slow intervals or no intervals listed
      	•	Breath-focused work (e.g., “4, 3, 2, 1 breath”)
      	5.	Content Simplicity:
      	•	No complex interval structures
      	•	No descending sets or intensity progressions
      	•	No “fast,” “race pace,” “max,” or high-effort descriptors
      	•	Often includes recovery-oriented drills or stretch-focused movements
      	•	May include “scull,” “drill,” or gentle technique work
      	6.	Structural Position:
      	•	Follows all “EZ” recovery periods from the main set
      	•	Appears after any “Technique & Recovery” or supplementary sections
      	•	May be preceded by “200 EZ” or similar short recovery swim
      Common Cool-Down Patterns:
      	•	“200 easy” or “200 EZ”
      	•	“100 easy” or “100 Easy”
      	•	“4x50 easy choice”
      	•	“200 swim smooth”
      	•	“4x50 4, 3, 2, 1 breath @ :20 RI”
      	•	“100 easy + stretch”
      	•	Combinations like “200 easy, 100 easy, 50 scull”
      What to EXCLUDE (these are NOT cool-down):
      	•	“200 EZ” appearing BETWEEN main set rounds (this is active recovery, not cool-down)
      	•	Easy swimming that appears in the middle of the workout with more sets following
      	•	Pre-set recovery periods
      	•	Easy intervals within the main set structure
- Even if some sections are missing, include them in the JSON with value 0.

Also:
- totalYards = sum of all sections.
- strokePercentages should estimate proportions of each stroke mentioned in the text.
- aiTip should be a concise coaching insight (1-3 sentences) summarizing the workout’s focus and what the swimmer should pay attention to.
- strokePercentages should reflect the proportion of total yardage for each stroke type.
- Identify strokes by words in the text:
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
  * Swim: "swim" - If unclear, assign yardage here

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

    // -----------------------
    // 🌊 STEP 1: MAIN ANALYSIS REQUEST
    // -----------------------
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

    // -----------------------
    // 🧩 STEP 2: ADD AI SUMMARY GENERATION
    // -----------------------
    const summaryPrompt = `
You are an elite swim coach. Write a short (1-2 sentence) summary of this workout 
as if explaining to a competitive swimmer what this set focuses on. 
Keep it concise and natural.

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

    // -----------------------
    // ✅ STEP 3: RETURN MERGED RESULT
    // -----------------------
    return res.status(200).json({
      ...parsed,
      aiSummary, // ← NEW
    });
  } catch (err) {
    console.error("Gemini API Error:", err);
    return res.status(500).json({
      error: "Server error: " + (err?.message || String(err)),
    });
  }
}
