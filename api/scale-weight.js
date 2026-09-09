// ジムの体重計（Xiaomi S200）が飛ばした体重を受け取って、予約時刻から本人に紐づけて記録する。
// 拾う箱（Raspberry Pi Zero W）が、乗るたびにここへ1回POSTしてくる。
// 流れはタニタ版と同じ＝時刻→名前→ジム体重シート（取り込み側は返金に伴い削除済み）。
// 違うのは「取りに行く」のではなく「送られてくる」こと。トークンの期限切れが無い。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';
const SECRET = process.env.SCALE_SECRET || '';

// 体重として受け付ける範囲。電波が化けた時に変な値を書き込まないための最後の砦
const MIN_KG = 20;
const MAX_KG = 250;

function jstStamp(d) {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);   // Vercelは世界標準時で動く
  return j.getUTCFullYear()
    + String(j.getUTCMonth() + 1).padStart(2, '0') + String(j.getUTCDate()).padStart(2, '0')
    + String(j.getUTCHours()).padStart(2, '0') + String(j.getUTCMinutes()).padStart(2, '0');
}

export default async function handler(req, res) {
  const q = req.method === 'POST' ? (req.body || {}) : (req.query || {});

  // 合言葉。これが無いと、URLを知った誰でも他人の体重を書き込めてしまう
  if (!SECRET) return res.json({ ok: false, error: 'SCALE_SECRET が未設定' });
  if (String(q.token || '') !== SECRET) return res.status(403).json({ ok: false, error: '合言葉が違う' });

  const weight = Number(q.weight);
  if (!weight || weight < MIN_KG || weight > MAX_KG) {
    return res.json({ ok: false, error: `体重が範囲外（${q.weight}）` });
  }

  // 測定時刻。箱が付けてこなければ、届いた今を使う
  const at = String(q.at || jstStamp(new Date())).slice(0, 12);
  const date = at.slice(0, 4) + '-' + at.slice(4, 6) + '-' + at.slice(6, 8);

  try {
    const nm = await (await fetch(`${GAS_URL}?action=hp_name_at&at=${at}`)).json();
    // 枠が無い＝松本さん自身の試し乗りや、予約外の時間。書かずに捨てる。
    // 間違った人の行に入れるくらいなら、入れない（GAS側の hpNameAtStr も同じ考え方）
    if (!nm.name) return res.json({ ok: true, at, weight, name: null, skipped: '枠なし' });

    await fetch(GAS_URL, {
      method: 'POST',
      // source＝どこから来た値か。手入力・タニタ（返金済み）と混ざらないように印を付ける
      body: JSON.stringify({ action: 'saveGymWeight', name: nm.name, date, weight, at, source: '体重計' })
    });
    return res.json({ ok: true, at, weight, name: nm.name });
  } catch (e) {
    return res.json({ ok: false, error: String(e.message) });
  }
}
