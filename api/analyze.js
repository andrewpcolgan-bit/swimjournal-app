export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const expected = process.env.GITHUB_API_KEY;

  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date().toISOString();
  const fakePractice = {
    id: crypto.randomUUID(),
    date: now,
    type: "Morning Swim",
    durationMinutes: 75,
    distanceYards: 3000,
    sets: [
      { reps: 8, distancePerRep: 100, stroke: "freestyle" },
      { reps: 4, distancePerRep: 50, stroke: "breaststroke" }
    ],
    aiSummary: "AI mock summary: Mostly freestyle with some breaststroke focus.",
    strokePercentages: { freestyle: 0.8, breaststroke: 0.2 },
    sectionPercentages: { Warmup: 0.1, Main: 0.8, CoolDown: 0.1 }
  };

  res.status(200).json(fakePractice);
}
