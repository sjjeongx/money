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

  let text;
  try {
    ({ text } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 요청 형식입니다.' }) };
  }

  if (!text || typeof text !== 'string' || text.length > 500) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '텍스트를 확인해주세요.' }) };
  }

  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\. /g, '-').replace('.', '').trim();

  // today를 YYYY-MM-DD 형식으로 변환
  const todayISO = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 10);

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `당신은 가계부 앱의 자연어 입력 파서입니다. 사용자가 입력한 텍스트를 분석하여 JSON으로 반환하세요.

오늘 날짜: ${todayISO}

반환 형식 (JSON만, 설명 없음):
{
  "date": "YYYY-MM-DD",
  "type": "income" 또는 "expense",
  "category": "식비|교통|쇼핑|의료|문화|주거|급여|용돈|기타" 중 정확히 하나,
  "description": "간단한 항목명",
  "amount": 정수 (원 단위, 소수점 없음),
  "memo": "추가 정보 (없으면 빈 문자열)",
  "tags": ["태그"] (없으면 빈 배열)
}

규칙:
- 날짜 미언급 시 오늘 날짜 사용
- "어제" → 오늘-1일, "그제" → 오늘-2일, "이번 달 1일" → 해당 날짜
- 금액은 반드시 정수 (만원 단위 등을 원 단위로 변환)
- 수입 관련: 월급, 급여, 용돈, 입금, 받았다 → income
- 지출 관련: 기본값 → expense
- category는 반드시 제공된 목록 중 하나
- 파싱 불가 시 {"error": "이유"} 반환`,
        },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 300,
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    // 기본 유효성 검사
    if (parsed.error) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: parsed.error }) };
    }

    const valid = parsed.date && parsed.type && parsed.category && parsed.description && parsed.amount > 0;
    if (!valid) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: '입력 내용을 인식하지 못했습니다. 더 자세히 입력해주세요.' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (err) {
    console.error('ai-parse error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI 파싱 중 오류가 발생했습니다.' }) };
  }
};
