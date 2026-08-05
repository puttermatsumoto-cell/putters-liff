// Withings（体重計）の認証の受け口。通信はここで完結し、GASにはトークンを預けるだけ。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec';
const CLIENT_ID = process.env.WITHINGS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.WITHINGS_CLIENT_SECRET || '';
const REDIRECT = 'https://putters-liff.vercel.app/api/withings-callback';

function page(title, body) {
  return '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<div style="font-family:-apple-system,sans-serif;padding:40px 24px;text-align:center;">'
    + '<h2 style="color:#1a1a2e;">' + title + '</h2>'
    + '<p style="color:#888;line-height:1.9;">' + body + '</p></div>';
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).send(page('準備がまだです', 'Withingsの Client ID / Secret が未設定です。'));
  const { code, error } = req.query;

  if (!code) {
    if (error) return res.status(400).send(page('認証できませんでした', String(error)));
    const url = 'https://account.withings.com/oauth2_user/authorize2?response_type=code'
      + '&client_id=' + encodeURIComponent(CLIENT_ID)
      + '&scope=user.metrics&state=putters'
      + '&redirect_uri=' + encodeURIComponent(REDIRECT);
    res.writeHead(302, { Location: url });
    return res.end();
  }

  try {
    const body = new URLSearchParams({
      action: 'requesttoken',
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: String(code),
      redirect_uri: REDIRECT
    });
    const r = await fetch('https://wbsapi.withings.net/v2/oauth2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const j = await r.json();
    if (j.status !== 0 || !j.body || !j.body.access_token) {
      return res.status(500).send(page('連携できませんでした', 'Withingsからの返事：<br><code>' + JSON.stringify(j).slice(0, 300) + '</code>'));
    }
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'scale_token_save', access_token: j.body.access_token, refresh_token: j.body.refresh_token })
    });
    return res.status(200).send(page('体重計との連携が完了しました',
      'この画面は閉じて大丈夫です。<br>これ以降、ジムの体重計に乗った記録が自動で入ります。'));
  } catch (e) {
    return res.status(500).send(page('通信に失敗しました', String(e.message)));
  }
}
