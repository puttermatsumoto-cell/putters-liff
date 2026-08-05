// Withingsの測定値を取り込み、予約時刻から本人に紐づけて記録する。
// Withingsのアクセストークンは3時間で切れるので、失敗したら refresh_token で取り直す。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';
const CLIENT_ID = process.env.WITHINGS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.WITHINGS_CLIENT_SECRET || '';

async function getMeas(token, from, to) {
  const body = new URLSearchParams({
    action: 'getmeas', meastype: '1', category: '1',
    startdate: String(from), enddate: String(to)
  });
  const r = await fetch('https://wbsapi.withings.net/measure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + token },
    body: body.toString()
  });
  return r.json();
}

export default async function handler(req, res) {
  const days = Number(req.query.days || 2);
  try {
    const tk = await (await fetch(`${GAS_URL}?action=scale_token_get`)).json();
    if (!tk.access_token) return res.json({ ok: false, error: '未連携（先に /api/withings-callback を開く）' });

    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 86400;
    let token = tk.access_token;
    let j = await getMeas(token, from, to);

    // 期限切れなら取り直して再挑戦
    if (j.status === 401 && tk.refresh_token) {
      const rb = new URLSearchParams({
        action: 'requesttoken', grant_type: 'refresh_token',
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: tk.refresh_token
      });
      const rr = await (await fetch('https://wbsapi.withings.net/v2/oauth2', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: rb.toString()
      })).json();
      if (rr.status === 0 && rr.body && rr.body.access_token) {
        token = rr.body.access_token;
        await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'scale_token_save', access_token: rr.body.access_token, refresh_token: rr.body.refresh_token }) });
        j = await getMeas(token, from, to);
      }
    }
    if (j.status !== 0 || !j.body || !j.body.measuregrps) return res.json({ ok: false, error: JSON.stringify(j).slice(0, 300) });

    const results = [];
    for (const g of j.body.measuregrps) {
      const m = (g.measures || []).find(x => x.type === 1);
      if (!m) continue;
      const kg = Math.round(m.value * Math.pow(10, m.unit) * 10) / 10;
      const d = new Date(g.date * 1000);
      const p2 = n => String(n).padStart(2, '0');
      const at = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes());
      const date = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
      const nm = await (await fetch(`${GAS_URL}?action=hp_name_at&at=${at}`)).json();
      if (!nm.name) { results.push({ at, weight: kg, name: null, skipped: '枠なし' }); continue; }
      await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updateRecordFields', name: nm.name, date, fields: { weight: kg } }) });
      results.push({ at, weight: kg, name: nm.name });
    }
    return res.json({ ok: true, count: results.length, results });
  } catch (e) {
    return res.json({ ok: false, error: String(e.message) });
  }
}
