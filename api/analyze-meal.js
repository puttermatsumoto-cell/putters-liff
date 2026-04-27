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
            text: `この写真を分析して、栄養情報をJSONで返してください。

【栄養成分表が写っている場合】
- 表の数値を正確に読み取り、そのまま使用してください
- 「100gあたり」「100mlあたり」など基準量が明記されている場合は、その数値をそのまま返し、descriptionに「（100g当たり）」のように基準量を明記してください
- たんぱく質=p、脂質=f、炭水化物=c（糖質+食物繊維）、エネルギー=kcalとして読み取ってください
- 数値が読み取れない場合は推定しないで0にしてください

【料理・食事の写真の場合】
- 写真に写っているすべての食材・料理を特定してください
- それぞれの一般的な量（g）を推定し、PFCを計算してください
- 合計値をJSONで返してください
- descriptionには食材名と推定量を記載してください（例：「白米200g、鶏むね肉150g、ブロッコリー80g」）

返答はJSONのみ。余分なテキスト不要。
形式: {"p": 数値, "f": 数値, "c": 数値, "kcal": 数値, "description": "説明"}
食事でも栄養成分表でもない場合: {"p": 0, "f": 0, "c": 0, "kcal": 0, "description": "食事が確認できません"}`
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
