const REGIONS = ['北海道','東北','関東','中部','近畿','中国','四国','九州・沖縄'];
const KANJI_THEMES = ['自然','体・医療','感情','動作','食べ物','動植物','建物・場所','人物・社会','時間・数','難読熟語'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, level } = req.body;
  const rand = Math.floor(Math.random() * 10000);
  const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
  const theme = KANJI_THEMES[Math.floor(Math.random() * KANJI_THEMES.length)];

  const prompts = {
    kanji: `乱数${rand}を使って、テーマ「${theme}」に関連する漢字の読み問題を1問作ってください。
難易度レベル: ${level}
レベル1（漢検3級）: 中学卒業レベルの漢字（例: 憧れ、穏やか）
レベル2（漢検2級）: 高校卒業レベルの漢字（例: 嗜む、朧月）
レベル3（漢検1級）: 漢検1級レベルの超難読漢字（例: 蠢く、囁く、鸛、鑿）
毎回必ず違う漢字を出してください。正解1つと紛らわしい不正解3つの選択肢を作ってください。
以下のJSON形式のみで返してください:
{"question": "漢字（送り仮名はひらがなで）", "answer": "正解の読み方（ひらがな）", "choices": ["正解含む4択（ひらがな、ランダムな順番）"], "hint": "使い方の例文"}`,

    place: `乱数${rand}を使って、${region}地方の地名・難読地名の読み問題を1問作ってください。難易度: ${level}（1=簡単, 2=普通, 3=難しい）。
難易度1: 有名な市区町村
難易度2: やや難しい市区町村・地区名
難易度3: 難読地名・小さな地名
毎回必ず違う地名を出してください。正解1つと紛らわしい不正解3つの選択肢を作ってください。
以下のJSON形式のみで返してください:
{"question": "地名（漢字のみ）", "answer": "正解の読み方（ひらがな）", "choices": ["正解含む4択（ひらがな、ランダムな順番）"], "hint": "○○県・${region}地方など場所のヒント"}`,

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
