// 歩数の受け口。ショートカットのプレビューを短くするためだけに存在する。
// GASのURLは130文字あり、そのまま入れると「追加」ボタンが画面外に押し出される。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { n, d } = req.query;   // n=名前, d=歩数データ
  if (!n || !d) return res.status(400).json({ ok: false, error: 'n/d がありません' });

  try {
    const url = `${GAS_URL}?action=saveStepsBulk`
      + `&name=${encodeURIComponent(n)}&days=${encodeURIComponent(d)}`;
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    try {
      return res.status(200).json(JSON.parse(text));
    } catch (e) {
      return res.status(200).json({ ok: true, raw: text.slice(0, 200) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
