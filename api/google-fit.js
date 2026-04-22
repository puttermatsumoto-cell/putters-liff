const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'https://liff-app-weld.vercel.app/google-fit-callback.html';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // OAuth認証URLを生成
  if (action === 'auth_url') {
    const { userName } = req.query;
    const scope = 'https://www.googleapis.com/auth/fitness.activity.read';
    const state = encodeURIComponent(userName || '');
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${state}`;
    return res.json({ url });
  }

  // コードをトークンに交換
  if (action === 'exchange' && req.method === 'POST') {
    const { code, userName } = req.body;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.status(400).json(tokens);

    // 今日の歩数を取得してGASに保存
    const steps = await fetchTodaySteps(tokens.access_token);
    const today = new Date().toISOString().slice(0, 10);

    const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';
    await fetch(`${GAS_URL}?action=saveSteps&userId=${encodeURIComponent(userName)}&displayName=${encodeURIComponent(userName)}&steps=${steps}&date=${today}`);

    return res.json({ ok: true, steps, refresh_token: tokens.refresh_token });
  }

  // リフレッシュトークンで歩数を毎日取得
  if (action === 'sync' && req.method === 'POST') {
    const { refreshToken, userName } = req.body;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token'
      })
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.status(400).json(tokens);

    const steps = await fetchTodaySteps(tokens.access_token);
    const today = new Date().toISOString().slice(0, 10);

    const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';
    await fetch(`${GAS_URL}?action=saveSteps&userId=${encodeURIComponent(userName)}&displayName=${encodeURIComponent(userName)}&steps=${steps}&date=${today}`);

    return res.json({ ok: true, steps });
  }

  return res.status(400).json({ error: 'invalid action' });
}

async function fetchTodaySteps(accessToken) {
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const body = {
    aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
    bucketByTime: { durationMillis: 86400000 },
    startTimeMillis: startOfDay.getTime(),
    endTimeMillis: now
  };

  const res = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  let steps = 0;
  try {
    data.bucket.forEach(b => {
      b.dataset.forEach(d => {
        d.point.forEach(p => {
          p.value.forEach(v => { steps += v.intVal || 0; });
        });
      });
    });
  } catch (e) {}
  return steps;
}
