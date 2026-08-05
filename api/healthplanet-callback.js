// タニタ Health Planet の認証の受け口。
// ★通信はここ（Vercel）で完結させる。GASにUrlFetchAppを使わせると権限の壁に当たるため。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';
const CLIENT_ID = '51791.5fsal39phO.apps.healthplanet.jp';
const CLIENT_SECRET = '1785942369221-zlleNK3QyXGLNa521H9Hnes7vC7eRaBG5mL5HLby';
const REDIRECT = 'https://putters-liff.vercel.app/api/healthplanet-callback';

function page(title, body) {
  return '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<div style="font-family:-apple-system,sans-serif;padding:40px 24px;text-align:center;">'
    + '<h2 style="color:#1a1a2e;">' + title + '</h2>'
    + '<p style="color:#888;line-height:1.9;">' + body + '</p></div>';
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const { code, error } = req.query;

  // 認証を始める：code が無ければタニタへ送る
  if (!code) {
    if (error) return res.status(400).send(page('認証できませんでした', String(error)));
    const url = 'https://www.healthplanet.jp/oauth/auth?client_id=' + encodeURIComponent(CLIENT_ID)
      + '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&scope=innerscan&response_type=code';
    res.writeHead(302, { Location: url });
    return res.end();
  }

  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      code: String(code),
      grant_type: 'authorization_code'
    });
    const r = await fetch('https://www.healthplanet.jp/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const text = await r.text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) {}
    if (!data.access_token) {
      return res.status(500).send(page('連携できませんでした', 'タニタからの返事：<br><code>' + text.slice(0, 300) + '</code>'));
    }
    // トークンはGASのスクリプトプロパティに預ける（GASは外部通信しないので権限不要）
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'hp_token_save', access_token: data.access_token, refresh_token: data.refresh_token || '' })
    });
    return res.status(200).send(page('体重計との連携が完了しました',
      'この画面は閉じて大丈夫です。<br>これ以降、ジムの体組成計に乗った記録が自動で入ります。'));
  } catch (e) {
    return res.status(500).send(page('通信に失敗しました', String(e.message)));
  }
}