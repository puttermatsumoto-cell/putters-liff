export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, level } = req.body;

  const prompts = {
    kanji: `日本語の漢字の読み問題を1問作ってください。難易度: ${level}（1=簡単, 2=普通, 3=難しい）。
難易度1: 小学生レベルの漢字（例: 友達、学校）
難易度2: 中学生レベルの漢字（例: 憧れ、曖昧）
難易度3: 大人でも難しい漢字（例: 蠢く、囁く）
以下のJSON形式のみで返してください:
{"question": "漢字（ひらがなは伏せ字にしない、送り仮名はひらがなで）", "answer": "読み方（ひらがな）", "hint": "使い方の例文"}`,

    place: `日本全国からランダムに地名・難読地名の読み問題を1問作ってください。北海道から沖縄まで偏りなく出題してください。難易度: ${level}（1=簡単, 2=普通, 3=難しい）。
難易度1: 都道府県・有名都市（例: 大阪、京都）
難易度2: やや難しい市区町村（例: 大鰐、養父）
難易度3: 難読地名（例: 乙訓、行徳）
以下のJSON形式のみで返してください:
{"question": "地名（漢字のみ、都道府県名は含めない）", "answer": "読み方（ひらがな）", "hint": "○○県・○○地方など場所のヒント"}`,

    count: null
  };

  const prompt = prompts[category];
  if (!prompt) return res.status(400).json({ error: 'invalid category' });

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
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();
  if (!data.content || !data.content[0]) return res.status(500).json({ error: 'API error' });

  let text = data.content[0].text.trim().replace(/```json\n?/g, '').replace(/```/g, '').trim();
  try {
    res.json(JSON.parse(text));
  } catch (e) {
    res.status(500).json({ error: 'parse error' });
  }
}
