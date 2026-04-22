const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: 歩数を保存
  if (req.method === 'POST') {
    const { userId, displayName, steps, date } = req.body;
    if (!userId || steps === undefined) {
      return res.status(400).json({ error: 'userId and steps are required' });
    }
    const today = date || new Date().toISOString().slice(0, 10);
    const url = `${GAS_URL}?action=saveSteps&userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName || '')}&steps=${steps}&date=${today}`;
    const response = await fetch(url);
    const data = await response.json();
    return res.json(data);
  }

  // GET: ランキング取得
  if (req.method === 'GET') {
    const url = `${GAS_URL}?action=getWeeklyRanking`;
    const response = await fetch(url);
    const data = await response.json();
    return res.json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
