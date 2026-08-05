// タニタ Health Planet の認証の受け口。
// Health Planet はホストドメインを申告する形式なので、リダイレクト先はこのアプリのドメインにする必要がある。
// ここは受け取ったコードをGASへ渡すだけ（Client Secret はGASのスクリプトプロパティにあり、ここには置かない）。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';

export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.status(400).send('認証に失敗しました：' + error);
  if (!code) return res.status(400).send('コードが取れませんでした。もう一度やり直してください。');

  try {
    const r = await fetch(`${GAS_URL}?action=hp_callback&code=${encodeURIComponent(code)}`);
    const text = await r.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (text.indexOf('"ok":true') === -1) {
      return res.status(500).send('<h2>連携できませんでした</h2><pre>' + text.slice(0, 500) + '</pre>');
    }
    return res.status(200).send(
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="font-family:sans-serif;padding:40px 24px;text-align:center;">' +
      '<h2 style="color:#1a1a2e;">体重計との連携が完了しました</h2>' +
      '<p style="color:#888;line-height:1.8;">この画面は閉じて大丈夫です。<br>これ以降、ジムの体組成計に乗った記録が自動で入ります。</p></div>'
    );
  } catch (e) {
    return res.status(500).send('通信に失敗しました：' + e.message);
  }
}