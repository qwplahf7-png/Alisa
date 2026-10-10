
async function handle(request) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });

  if (request.method === "GET") {
    return json({ ok: true, service: "Yandex Alice + Gemini" });
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const session = body.session || {};
  const version = body.version || "1.0";
  const command = String(body.request?.command || "").trim();

  function reply(text) {
    return json({
      response: {
        text: String(text).slice(0, 1024),
        end_session: false
      },
      session,
      version
    });
  }

  if (!command) {
    return reply("Привет! Я слушаю.");
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing");
    return reply("Не настроен ключ Gemini.");
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3200);

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "Ты голосовой помощник Алисы. Отвечай на русском языке естественно, кратко и по делу. Не используй разметку Markdown. Обычно отвечай одним-двумя предложениями."
            }]
          },
          contents: [{
            role: "user",
            parts: [{ text: command }]
          }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 100
          }
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "Gemini HTTP error:",
        response.status,
        errorText.slice(0, 1000)
      );
      return reply("Gemini временно не отвечает.");
    }

    const raw = await response.text();
    let answer = "";

    // Поддерживаем обычный JSON, массив JSON
    // и потоковый формат Server-Sent Events.
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        const parts = item?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (typeof part.text === "string") {
            answer += part.text;
          }
        }
      }
    } catch {
      const lines = raw.split(/\r?\n/);

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const item = JSON.parse(payload);
          const parts = item?.candidates?.[0]?.content?.parts || [];

          for (const part of parts) {
            if (typeof part.text === "string") {
              answer += part.text;
            }
          }
        } catch (error) {
          console.error("Could not parse Gemini stream chunk");
        }
      }
    }

    answer = answer.trim();

    console.log(
      "Gemini stream time ms:",
      Date.now() - startedAt,
      "answer length:",
      answer.length
    );

    if (!answer) {
      console.error("Gemini returned no text. Body:", raw.slice(0, 2000));
      return reply("Gemini вернул пустой ответ. Попробуй ещё раз.");
    }

    return reply(answer);
  } catch (error) {
    console.error("Gemini request failed:", error.message);

    if (error.name === "AbortError") {
      return reply("Gemini не успел сформировать ответ.");
    }

    return reply("Не удалось связаться с Gemini.");
  } finally {
    clearTimeout(timeout);
  }
}

export function GET(request) {
  return handle(request);
}

export function POST(request) {
  return handle(request);
}
