// api/analyze.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const expected = process.env.GITHUB_API_KEY;
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');

  if (!expected || token.trim() !== expected.trim()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { text } = req.body || {};
  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }

  // Basic text parsing logic
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let totalYards = 0;
  const sets = [];
  const strokeCounts = { freestyle: 0, backstroke: 0, breaststroke: 0, butterfly: 0, kick: 0, drill: 0 };
  const sectionCounts = { warmup: 0, preset: 0, mainset: 0, cooldown: 0 };

  let currentSection = 'mainset';
  for (let line of lines) {
    const lower = line.toLowerCase();

    // detect block headers
    if (lower.includes('warm')) currentSection = 'warmup';
    else if (lower.includes('pre')) currentSection = 'preset';
    else if (lower.includes('main')) currentSection = 'mainset';
    else if (lower.includes('cool')) currentSection = 'cooldown';

    // find patterns like "8x50" or "16x25"
    const match = line.match(/(\d+)\s*[xX]\s*(\d+)/);
    if (match) {
      const reps = parseInt(match[1]);
      const dist = parseInt(match[2]);
      const yards = reps * dist;
      totalYards += yards;

      // detect stroke
      let stroke = 'freestyle';
      if (lower.includes('back')) stroke = 'backstroke';
      else if (lower.includes('breast')) stroke = 'breaststroke';
      else if (lower.includes('fly')) stroke = 'butterfly';
      else if (lower.includes('kick')) stroke = 'kick';
      else if (lower.includes('drill')) stroke = 'drill';

      strokeCounts[stroke] = (strokeCounts[stroke] || 0) + yards;
      sectionCounts[currentSection] += yards;

      sets.push({ reps, distancePerRep: dist, stroke, section: currentSection, yards });
    }
  }

  const strokePercentages = {};
  for (const [key, val] of Object.entries(strokeCounts)) {
    if (val > 0) strokePercentages[key] = val / totalYards;
  }

  const sectionPercentages = {};
  for (const [key, val] of Object.entries(sectionCounts)) {
    if (val > 0) sectionPercentages[key] = val / totalYards;
  }

  const aiSummary = `Detected ${sets.length} sets, total ${totalYards} yards. Most yardage from ${Object.keys(strokePercentages)[0] || 'freestyle'}.`;

  res.status(200).json({
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    type: "Swim Practice",
    durationMinutes: 90,
    distanceYards: totalYards,
    sets,
    aiSummary,
    strokePercentages,
    sectionPercentages
  });
}
