const OpenAI = require('openai');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 요청 형식입니다.' }) };
  }

  const { month, income, expense, balance, budgets, savingsGoal, categoryBreakdown, topExpenses, count } = payload;

  if (count === 0) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ analysis: '이번 달에 등록된 거래 내역이 없습니다. 지출을 입력하면 AI가 분석해 드립니다.' }),
    };
  }

  // 예산 초과 카테고리 계산
  const overBudget = Object.entries(categoryBreakdown || {})
    .filter(([cat, spent]) => budgets[cat] && spent > budgets[cat])
    .map(([cat, spent]) => `${cat}(예산 ${Number(budgets[cat]).toLocaleString()}원 대비 ${Number(spent).toLocaleString()}원)`);

  const dataStr = [
    `대상 월: ${month}`,
    `총 수입: ${Number(income).toLocaleString()}원`,
    `총 지출: ${Number(expense).toLocaleString()}원`,
    `잔액: ${Number(balance).toLocaleString()}원`,
    `거래 건수: ${count}건`,
    savingsGoal ? `저축 목표: ${Number(savingsGoal).toLocaleString()}원` : '',
    `카테고리별 지출: ${JSON.stringify(categoryBreakdown)}`,
    overBudget.length ? `예산 초과 카테고리: ${overBudget.join(', ')}` : '',
    `상위 지출 내역: ${JSON.stringify(topExpenses || [])}`,
  ].filter(Boolean).join('\n');

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `당신은 친근하고 실용적인 가계부 AI 어시스턴트입니다.
사용자의 지출 데이터를 분석하고 마크다운 형식으로 간결한 리포트를 작성하세요.

다음 구조로 작성하세요 (각 섹션은 2-3문장 또는 항목):
## 이번 달 요약
(수입, 지출, 잔액, 저축 목표 달성률 요약)

## 주요 지출 패턴
(눈에 띄는 패턴 2-3가지를 불릿으로)

## 절약 포인트
(구체적이고 실천 가능한 팁 2-3가지를 불릿으로)

## 다음 달 제안
(한 가지 핵심 제안)

규칙:
- 한국어로 작성
- 친근하고 격려하는 톤
- 구체적인 숫자 언급
- 전체 400자 이내`,
        },
        {
          role: 'user',
          content: `다음 가계부 데이터를 분석해주세요:\n\n${dataStr}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    const analysis = completion.choices[0].message.content;
    return { statusCode: 200, headers, body: JSON.stringify({ analysis }) };
  } catch (err) {
    console.error('ai-analyze error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI 분석 중 오류가 발생했습니다.' }) };
  }
};
