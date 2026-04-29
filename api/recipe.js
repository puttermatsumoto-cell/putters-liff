export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ingredients, targetP, targetF, targetC } = req.body;
  if (!ingredients || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients is required' });
  }

  const ingredientText = ingredients.map(i => `・${i.name} ${i.amount}g（P:${i.p}g F:${i.f}g C:${i.c}g ${i.kcal}kcal）`).join('\n');
  const targetText = (targetP || targetF || targetC)
    ? `\n目標PFC：P${targetP || '?'}g / F${targetF || '?'}g / C${targetC || '?'}g`
    : '';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `以下の食材を使ったレシピを3つ提案してください。${targetText}

【使える食材】
${ingredientText}

条件：
- 全ての食材を使う必要はない
- シンプルで作りやすいレシピ
- PFCバランスを考慮する
- 各レシピのPFCとkcalも計算して含める

以下のJSON形式のみで返してください：
[
  {
    "name": "レシピ名",
    "desc": "簡単な説明（1行）",
    "steps": ["手順1", "手順2", "手順3"],
    "p": 数値,
    "f": 数値,
    "c": 数値,
    "kcal": 数値
  }
]`
      }]
    })
  });

  const data = await response.json();
  if (!data.content || !data.content[0]) {
    return res.json({ recipes: [] });
  }

  let text = data.content[0].text.trim();
  text = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();

  try {
    const recipes = JSON.parse(text);
    res.json({ recipes });
  } catch (e) {
    res.json({ recipes: [] });
  }
}
