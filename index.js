module.exports = async function (req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  function send(data, status = 200) {
    return res.status(status).json(data);
  }
  function reply(text, body = {}) {
    return send({
      version: body.version || "1.0",
      session: body.session || {},
      response: {
        text: String(text).slice(0, 1024),
        end_session: false
      }
    });
  }
  if (req.method === "GET") {
    return send({
      ok: true,
      service: "Yandex Alice + Gemini"
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send({ error: "Method not allowed" }, 405);
  }
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  if (!body || typeof body !== "object") {
    body = {};
  }
  const command = String(
    (body.request &&
      (body.request.command ||
       body.request.original_utterance)) || ""
  ).trim();
  if (!command) {
    return reply("Привет! Чем могу помочь?", body);
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY is missing");
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
              text:
                "Ты голосовой помощник Яндекс Алисы. " +
                "Отвечай на русском языке естественно и по существу. " +
                "Не используй Markdown. Не выдумывай факты. " +
                "Ответ должен быть удобен для озвучивания."
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
      console.error(
        "Gemini API error:",
        response.status,
        (await response.text()).slice(0, 500)
      );
      return reply(
        "Не удалось получить ответ от помощника. Попробуй ещё раз.",
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
      answer || "Не получилось сформировать ответ.",
      body
    );
  } catch (error) {
    console.error("Webhook error:", error.message);
    return reply(
      "Возникла ошибка при обработке запроса. Попробуй ещё раз.",
      body
    );
  }
};
