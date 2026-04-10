export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { food } = req.body;
  if (!food) {
    return res.status(400).json({ error: 'food is required' });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `「${food}」の栄養成分を教えてください。
- 食材・料理の場合は100gあたりの数値
- 外食メニュー・飲み物の場合は1食・1杯あたりの数値（サイズ指定があればそのサイズ、なければMサイズや標準サイズ）
- 略称・口語表現でも正式名称を推測して計算すること（例：「スタバ キャラメルフラペ トール」→スターバックス キャラメルフラペチーノ トールサイズ）
タンパク質(p)・脂質(f)・炭水化物(c)・カロリー(kcal)を数値でJSONのみ返してください。
例: {"p": 22.3, "f": 4.1, "c": 0.1, "kcal": 133}
不明な場合は全て0。`
      }]
    })
  });

  const data = await response.json();
  console.log('API response:', JSON.stringify(data));
  if (!data.content || !data.content[0]) {
    console.error('Unexpected response:', data);
    return res.json({ p: 0, f: 0, c: 0, kcal: 0 });
  }
  let text = data.content[0].text.trim();
  // ```json ... ``` を除去
  text = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();

  try {
    const pfc = JSON.parse(text);
    res.json(pfc);
  } catch (e) {
    res.json({ p: 0, f: 0, c: 0, kcal: 0 });
  }
}
