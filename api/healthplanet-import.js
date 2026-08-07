// タニタの測定値を取り込んで、予約時刻から本人に紐づけて記録する。
// 通信はここ（Vercel）で完結。GASは「トークンの保管」「時刻→名前」「体重の書き込み」だけ担当する。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';
const REDIRECT = 'https://putters-liff.vercel.app/api/healthplanet-callback';
// 認証の受け口と同じ鍵。どちらの組で発行されたか分からないので順に試す
const PAIRS = [
  { id: '51791.5fsal39phO.apps.healthplanet.jp', secret: '1785942369221-zlleNK3QyXGLNa521H9Hnes7vC7eRaBG5mL5HLby' },
  { id: '51792.OkxDXa7vFo.apps.healthplanet.jp', secret: '1785942443955-lqhWe9KpP1hDhHjCSjiJgV3HFwDr7nl4BWxtgsCp' }
];

// ★タニタは日本時間で from/to を受け取る。VercelはUTCで動くので、
//   9時間足してからUTCの値を読む＝日本時間の年月日時分になる。
//   これをしないと、さっき測ったばかりのデータが「未来」扱いで範囲から外れる
function jst(d) {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return j.getUTCFullYear()
    + String(j.getUTCMonth() + 1).padStart(2, '0') + String(j.getUTCDate()).padStart(2, '0')
    + String(j.getUTCHours()).padStart(2, '0') + String(j.getUTCMinutes()).padStart(2, '0') + '00';
}

async function fetchMeasurements(token, days) {
  // 体重計の時計が少し進んでいても拾えるように、終わりは1時間先まで見る
  const to = new Date(Date.now() + 60 * 60 * 1000);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const url = 'https://www.healthplanet.jp/status/innerscan.json?access_token=' + encodeURIComponent(token)
    + '&date=1&tag=6021&from=' + jst(from) + '&to=' + jst(to);   // date=1 は「測定日時」で絞る／6021 は体重
  const text = await (await fetch(url)).text();
  try { return { data: JSON.parse(text), text }; } catch (e) { return { data: null, text }; }
}

// アクセストークンは期限が切れる。切れたら refresh_token で取り直して、GASに保管し直す。
// これが無いと、ある日突然データが入らなくなって気づけない
async function refresh(refreshToken) {
  if (!refreshToken) return null;
  for (const p of PAIRS) {
    const body = new URLSearchParams({
      client_id: p.id, client_secret: p.secret, redirect_uri: REDIRECT,
      refresh_token: refreshToken, grant_type: 'refresh_token'
    });
    const r = await fetch('https://www.healthplanet.jp/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    let d = {};
    try { d = JSON.parse(await r.text()); } catch (e) { d = {}; }
    if (d.access_token) {
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'hp_token_save',
          access_token: d.access_token,
          refresh_token: d.refresh_token || refreshToken
        })
      });
      return d.access_token;
    }
  }
  return null;
}

export default async function handler(req, res) {
  const days = Number(req.query.days || 2);
  try {
    const tk = await (await fetch(`${GAS_URL}?action=hp_token_get`)).json();
    if (!tk.access_token) return res.json({ ok: false, error: '未連携（先に /api/healthplanet-callback を開く）' });

    let got = await fetchMeasurements(tk.access_token, days);
    let refreshed = false;
    if (!got.data || !got.data.data) {
      // 期限切れの可能性。取り直して1回だけやり直す
      const fresh = await refresh(tk.refresh_token);
      if (fresh) { got = await fetchMeasurements(fresh, days); refreshed = true; }
    }
    if (!got.data || !got.data.data) {
      return res.json({ ok: false, refreshed, error: String(got.text).slice(0, 300) });
    }

    const results = [];
    for (const m of got.data.data) {
      if (String(m.tag) !== '6021') continue;
      const at = String(m.date);                       // yyyyMMddHHmm
      const nm = await (await fetch(`${GAS_URL}?action=hp_name_at&at=${at}`)).json();
      const date = at.slice(0, 4) + '-' + at.slice(4, 6) + '-' + at.slice(6, 8);
      if (!nm.name) { results.push({ at, weight: m.keydata, name: null, skipped: '枠なし' }); continue; }
      // ★書き先は「ジム体重」シート。記録シートの体重列（＝本人が家で入力する値）には触らない。
      //   家はほぼ裸・朝、ジムは服のまま来店時なので1kg近くズレる。混ぜると家のグラフが壊れる
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveGymWeight', name: nm.name, date, weight: Number(m.keydata), at })
      });
      results.push({ at, weight: m.keydata, name: nm.name });
    }
    return res.json({ ok: true, refreshed, count: results.length, results });
  } catch (e) {
    return res.json({ ok: false, error: String(e.message) });
  }
}