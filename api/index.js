
module.exports = async function (req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  function reply(text, body) {
    return res.status(200).json({
      version: body && body.version ? body.version : "1.0",
      session: body && body.session ? body.session : {},
      response: {
        text: text,
        end_session: false
      }
    });
  }

  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      service: "Yandex Alice webhook",
      method: req.method
    });
  }

  const body = req.body || {};
  const command = String(
    (body.request && (
      body.request.command ||
      body.request.original_utterance
    )) || ""
  ).trim();

  if (!command) {
    return reply("Привет! Я слушаю.", body);
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
              text: "Ты голосовой помощник Алисы. Отвечай на русском языке кратко, естественно, без Markdown. Не выдумывай факты."
            }]
          },
          contents: [{
            role: "user",
            parts: [{ text: command }]
          }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 250
          }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      console.error(
        "Gemini error:",
        response.status,
        (await response.text()).slice(0, 500)
      );
      return reply(
        "Не удалось получить ответ от Gemini. Попробуй ещё раз.",
        body
      );
    }

    const data = await response.json();
    const answer = (
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts
        ? data.candidates[0].content.parts
            .map(function (part) {
              return part.text || "";
            })
            .join("")
            .trim()
        : ""
    );

    return reply(
      answer || "Не получилось сформировать ответ. Попробуй ещё раз.",
      body
    );
  } catch (error) {
    console.error("Webhook error:", error.message);
    return reply(
      "Произошла ошибка при обработке запроса. Попробуй ещё раз.",
      body
    );
  }
};
