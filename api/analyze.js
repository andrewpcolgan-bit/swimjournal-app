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
  const strokeCounts = {
    freestyle: 0, backstroke: 0, breaststroke: 0, butterfly: 0, kick: 0, drill: 0
  };
  const sectionTotals = { warmup: 0, preset: 0, mainset: 0, pull: 0, sprint: 0, cooldown: 0 };

  let totalYards = 0;
  let currentSection = "mainset";
  let currentLines = [];

  const titleFor = (key) => {
    const map = {
      warmup: "Warmup",
      preset: "Preset",
      mainset: "Main Set",
      pull: "Pull",
      sprint: "Sprint Finisher",
      cooldown: "Cool Down"
    };
    return map[key] || key;
  };

  const flushSection = (name) => {
    if (currentLines.length > 0) {
      sectionDetails.push({
        title: titleFor(name),
        lines: currentLines,
        totalYards: sectionTotals[name] || 0,
      });
      currentLines = [];
    }
  };

  for (let line of lines) {
    const lower = line.toLowerCase();

    // detect block headers
    if (lower.includes("warm")) { flushSection(currentSection); currentSection = "warmup"; }
    else if (lower.includes("pre")) { flushSection(currentSection); currentSection = "preset"; }
    else if (lower.includes("main")) { flushSection(currentSection); currentSection = "mainset"; }
    else if (lower.includes("pull")) { flushSection(currentSection); currentSection = "pull"; }
    else if (lower.includes("sprint")) { flushSection(currentSection); currentSection = "sprint"; }
    else if (lower.includes("cool")) { flushSection(currentSection); currentSection = "cooldown"; }

    // yardage like 8x50, 16 x 25, 2 X 100 etc.
    const match = line.match(/(\d+)\s*[xX]\s*(\d+)/);
    if (match) {
      const reps = parseInt(match[1], 10);
      const dist = parseInt(match[2], 10);
      const yards = reps * dist;
      totalYards += yards;
      if (sectionTotals[currentSection] !== undefined) {
        sectionTotals[currentSection] += yards;
      }

      // stroke rough guess
      let stroke = "freestyle";
      if (lower.includes("back")) stroke = "backstroke";
      else if (lower.includes("breast")) stroke = "breaststroke";
      else if (lower.includes("fly")) stroke = "butterfly";
      else if (lower.includes("kick")) stroke = "kick";
      else if (lower.includes("drill")) stroke = "drill";

      strokeCounts[stroke] = (strokeCounts[stroke] || 0) + yards;
    }

    currentLines.push(line);
  }

  flushSection(currentSection);

  const pct = (num) => totalYards > 0 ? +(num / totalYards).toFixed(2) : 0;

  const strokePercentages = {};
  for (const [k, v] of Object.entries(strokeCounts)) {
    if (v > 0) strokePercentages[k] = pct(v);
  }

  const sectionPercentages = {};
  for (const [k, v] of Object.entries(sectionTotals)) {
    if (v > 0) sectionPercentages[titleFor(k)] = pct(v);
  }

  // One-sentence coaching note
  const dominantSection = Object.entries(sectionTotals).sort((a,b)=>b[1]-a[1])[0]?.[0] || "mainset";
  const dominantStroke = Object.entries(strokeCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || "freestyle";
  const aiTip = `Emphasis on ${titleFor(dominantSection).toLowerCase()} with a lot of ${dominantStroke.replace(/stroke$/,'')}; watch pacing and quality in the biggest blocks.`;

  // Build formatted write-out exactly like you want
  const formattedBreakdown = sectionDetails.map(s => {
    const linesText = s.lines.map(l => `• ${l}`).join("\n");
    return `${s.title}\n\n${linesText}\n${s.title} total: ${s.totalYards} yards`;
  }).join("\n\n");

  const totalsList = Object.entries(sectionTotals)
    .filter(([,v]) => v > 0)
    .map(([k,v]) => `${titleFor(k)}: ${v} yards`)
    .join("\n");

  const sectionSummaryTable = Object.entries(sectionTotals)
    .filter(([,v]) => v > 0)
    .map(([k,v]) => `${titleFor(k)}\t${v}\t${(pct(v)*100).toFixed(1)}%`)
    .join("\n");

  const strokeMixTable = Object.entries(strokePercentages)
    .map(([k,v]) => `${k}\t${Math.round(v*totalYards)}\t${(v*100).toFixed(1)}%`)
    .join("\n");

  const formattedText =
`🏊‍♂️ Workout Breakdown

${formattedBreakdown}

🧮 TOTAL YARDAGE

${totalsList}
Total: ${totalYards} yards

🏁 SECTION SUMMARY
Section\tYards\t% of Total
${sectionSummaryTable}

🧠 STROKE + DRILL MIX (approx.)
Type\tYards\t% of Total
${strokeMixTable}

✅ Summary:
${aiTip}
`;

  res.status(200).json({
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    distanceYards: totalYards,
    durationMinutes: 90,
    sectionDetails,                // structured sections (title, lines[], totalYards)
    sectionPercentages,            // for bars
    strokePercentages,             // for bars
    formattedText,                 // full write-out you’ll show in-app
    aiTip                          // one-sentence note
  });
}
