export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'image is required' });
  }

  // base64からメディアタイプを抽出
  const match = image.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'invalid image format' });
  }
  const mediaType = match[1];
  const base64Data = match[2];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Data
            }
          },
          {
            type: 'text',
            text: `この写真を見てください。

【栄養成分表が写っている場合】
表に記載されているタンパク質・脂質・炭水化物・カロリーの数値をそのまま読み取ってください。

【料理・食事の写真の場合】
食べているものを全て特定し、PFCを推定してください。

合計のタンパク質(p)・脂質(f)・炭水化物(c)・カロリー(kcal)と、食事内容の説明(description)をJSONのみで返してください。
例: {"p": 35.2, "f": 12.0, "c": 80.5, "kcal": 580, "description": "おにぎり（鮭）"}
食事・栄養成分表が写っていない場合は全て0、descriptionは「食事が確認できません」。`
          }
        ]
      }]
    })
  });

  const data = await response.json();
  if (!data.content || !data.content[0]) {
    return res.json({ p: 0, f: 0, c: 0, kcal: 0, description: '解析できませんでした' });
  }

  let text = data.content[0].text.trim();
  text = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();

  try {
    const result = JSON.parse(text);
    res.json(result);
  } catch (e) {
    res.json({ p: 0, f: 0, c: 0, kcal: 0, description: '解析できませんでした' });
  }
}
