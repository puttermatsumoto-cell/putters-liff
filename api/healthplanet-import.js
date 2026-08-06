// タニタの測定値を取り込んで、予約時刻から本人に紐づけて記録する。
// 通信はここ（Vercel）で完結。GASは「トークンの保管」「時刻→名前」「体重の書き込み」だけ担当する。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';

export default async function handler(req, res) {
  const days = Number(req.query.days || 2);
  try {
    const tk = await (await fetch(`${GAS_URL}?action=hp_token_get`)).json();
    if (!tk.access_token) return res.json({ ok: false, error: '未連携（先に /api/healthplanet-callback を開く）' });

    const f = d => d.getFullYear()
      + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
      + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '00';
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const url = 'https://www.healthplanet.jp/status/innerscan.json?access_token=' + encodeURIComponent(tk.access_token)
      + '&date=1&tag=6021&from=' + f(from) + '&to=' + f(to);   // date=1 は「測定日時」で絞る／6021 は体重
    const text = await (await fetch(url)).text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) { return res.json({ ok: false, error: text.slice(0, 300) }); }
    if (!data.data) return res.json({ ok: false, error: text.slice(0, 300) });

    const results = [];
    for (const m of data.data) {
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
    return res.json({ ok: true, count: results.length, results });
  } catch (e) {
    return res.json({ ok: false, error: String(e.message) });
  }
}