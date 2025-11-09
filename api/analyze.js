// api/analyze.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const expected = process.env.GITHUB_API_KEY;
  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "");

  if (!expected || token.trim() !== expected.trim()) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Missing text" });

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Containers
  const sectionDetails = [];
  const strokeCounts = { freestyle: 0, backstroke: 0, breaststroke: 0, butterfly: 0, kick: 0, drill: 0 };
  const sectionTotals = { warmup: 0, preset: 0, mainset: 0, cooldown: 0 };

  let totalYards = 0;
  let currentSection = "mainset";
  let currentLines = [];

  const flushSection = (name) => {
    if (currentLines.length > 0) {
      sectionDetails.push({
        title: name.charAt(0).toUpperCase() + name.slice(1),
        lines: currentLines,
        totalYards: sectionTotals[name] || 0,
      });
      currentLines = [];
    }
  };

  for (let line of lines) {
    const lower = line.toLowerCase();

    if (lower.includes("warm")) {
      flushSection(currentSection);
      currentSection = "warmup";
    } else if (lower.includes("pre")) {
      flushSection(currentSection);
      currentSection = "preset";
    } else if (lower.includes("main")) {
      flushSection(currentSection);
      currentSection = "mainset";
    } else if (lower.includes("cool")) {
      flushSection(currentSection);
      currentSection = "cooldown";
    }

    // detect yardage like 8x50, 16x25, etc.
    const match = line.match(/(\d+)\s*[xX]\s*(\d+)/);
    if (match) {
      const reps = parseInt(match[1]);
      const dist = parseInt(match[2]);
      const yards = reps * dist;
      totalYards += yards;
      sectionTotals[currentSection] += yards;

      // detect stroke keywords
      let stroke = "freestyle";
      if (lower.includes("back")) stroke = "backstroke";
      else if (lower.includes("breast")) stroke = "breaststroke";
      else if (lower.includes("fly")) stroke = "butterfly";
      else if (lower.includes("kick")) stroke = "kick";
      else if (lower.includes("drill")) stroke = "drill";

      strokeCounts[stroke] += yards;
    }

    currentLines.push(line);
  }

  flushSection(currentSection);

  const strokePercentages = {};
  for (const [k, v] of Object.entries(strokeCounts)) {
    if (v > 0) strokePercentages[k] = +(v / totalYards).toFixed(2);
  }

  const sectionPercentages = {};
  for (const [k, v] of Object.entries(sectionTotals)) {
    if (v > 0) sectionPercentages[k] = +(v / totalYards).toFixed(2);
  }

  const aiSummary = `Detected ${lines.length} lines and total ${totalYards} yards. Dominant stroke: ${Object.keys(strokePercentages)[0] || "freestyle"}.`;

  res.status(200).json({
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    distanceYards: totalYards,
    durationMinutes: 90,
    sectionDetails,
    strokePercentages,
    sectionPercentages,
    aiSummary,
  });
}
