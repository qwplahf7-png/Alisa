module.exports = async function (req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  function reply(text, body) {
    return res.status(200).json({
      version: body?.version || "1.0",
      session: body?.session || {},
      response: {
        text: String(text).slice(0, 1024),
        end_session: false
      }
    });
  }
  // Проверка доступности сервера
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Yandex Alice + Gemini",
      method: "GET"
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: "Method not allowed"
    });
  }
  const body = req.body || {};
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
    console.error("GEMINI_API_KEY is not configured");
    return reply("Сервер пока не настроен. Попробуй позже.", body);
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
            parts: [
              {
                text:
                  "Ты голосовой помощник Яндекс Алисы на русском языке. " +
                  "Отвечай естественно, понятно и по существу. " +
                  "Не используй Markdown, списки со специальным форматированием " +
                  "или длинные вступления. Не выдумывай факты. " +
                  "Ответ должен подходить для озвучивания голосом."
              }
            ]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: command }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300
          }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );
    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 1000);
      console.error("Gemini API error:", response.status, errorText);
      return reply(
        "Не получилось получить ответ от помощника. Попробуй ещё раз.",
        body
      );
    }
    const data = await response.json();
    const answer = (
      data.candidates?.[0]?.content?.parts || []
    )
      .map(part => part.text || "")
      .join("")
      .trim();
    if (!answer) {
      console.error("Gemini returned an empty answer");
      return reply("Не получилось сформировать ответ. Попробуй ещё раз.", body);
    }
    return reply(answer, body);
  } catch (error) {
    console.error("Webhook error:", error.message);
    return reply(
      "Возникла временная ошибка. Попробуй ещё раз.",
      body
    );
  }
};
