async function handle(request) {
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  }
  function reply(text, body = {}) {
    return json({
      version: body.version || "1.0",
      session: body.session || {},
      response: {
        text: String(text).slice(0, 1024),
        end_session: false
      }
    });
  }
  if (request.method === "GET") {
    return json({
      ok: true,
      service: "Yandex Alice + Gemini"
    });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return reply("Не удалось прочитать запрос.");
  }
  const command = String(
    body.request?.command ||
    body.request?.original_utterance ||
    ""
  ).trim();
  if (!command) {
    return reply("Привет! Чем могу помочь?", body);
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return reply("Не настроен ключ Gemini на сервере.", body);
  }
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        encodeURIComponent(key),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "Ты голосовой помощник Яндекс Алисы. Отвечай на русском языке естественно, кратко и по существу. Не используй Markdown. Не выдумывай факты."
            }]
          },
          contents: [{
            role: "user",
            parts: [{ text: command }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300
          }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );
    if (!response.ok) {
      console.error("Gemini API error:", response.status);
      return reply("Не удалось получить ответ. Попробуй ещё раз.", body);
    }
    const data = await response.json();
    const answer = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("")
      .trim();
    return reply(
      answer || "Не получилось сформировать ответ.",
      body
    );
  } catch (error) {
    console.error("Gemini error:", error.message);
    return reply("Ошибка при обработке запроса. Попробуй ещё раз.", body);
  }
}
export function GET(request) {
  return handle(request);
}
export function POST(request) {
  return handle(request);
}
