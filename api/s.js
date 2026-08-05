// 歩数の受け口。
// ショートカット側で変数の埋め込みが安定しなかったため、歩数は
// 「前のアクションの出力が次に自動で流れる」性質を使ってPOSTの本文で受ける。
// 名前はURLに焼き込んである（1人1ファイル）。これで変数を1つも使わずに済む。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';

function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') {
    // フォーム形式で来た場合は値をつなぐ
    return Object.values(req.body).join(',');
  }
  return '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const name = req.query.n;
  const days = req.query.d || readBody(req);   // dが無ければ本文を歩数として扱う
  if (!name || !days) {
    return res.status(400).json({ ok: false, error: 'name/steps がありません' });
  }

  try {
    const url = `${GAS_URL}?action=saveStepsBulk`
      + `&name=${encodeURIComponent(name)}&days=${encodeURIComponent(days)}`;
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
