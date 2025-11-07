export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const expected = process.env.GITHUB_API_KEY;

  // TEMPORARY DEBUG LOGGING
  console.log('===== AUTH DEBUG =====');
  console.log('Received token length:', token.length);
  console.log('Received token (first 10 chars):', token.substring(0, 10));
  console.log('Expected token exists:', !!expected);
  console.log('Expected token length:', expected ? expected.length : 0);
  console.log('Expected token (first 10 chars):', expected ? expected.substring(0, 10) : 'NONE');
  console.log('Tokens match:', token === expected);
  console.log('======================');

  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ... rest of your code
}
