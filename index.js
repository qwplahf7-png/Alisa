
async function handle(request) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });

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
      service: "Yandex Alice + Gemini 3.8 Flash"
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
    console.error("GEMINI_API_KEY is missing");
    return reply("На сервере не настроен ключ Gemini.", body);
  }

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash",
          input: command,
          system_instruction:
            "Ты голосовой помощник Яндекс Алисы. " +
            "Отвечай на русском языке, кратко и естественно. " +
            "Обычно отвечай одним-двумя предложениями. " +
            "Не используй Markdown.",
          generation_config: {
            thinking_level: "low",
            max_output_tokens: 120
          }
        }),
        signal: AbortSignal.timeout(2800)
      }
    );

    if (!response.ok) {
      const details = await response.text();
      console.error(
        "Gemini API error:",
        response.status,
        details
      );
      return reply("Не удалось получить ответ от Gemini.", body);
    }

    const data = await response.json();

    const answer = String(data.output_text || "").trim();

    if (!answer) {
      console.error("Gemini returned no text:", JSON.stringify(data));
      return reply("Gemini не сформировал ответ.", body);
    }

    return reply(answer, body);

  } catch (error) {
    console.error("Gemini request failed:", error.message);
    return reply(
      "Не успела получить ответ. Попробуй ещё раз.",
      body
    );
  }
}

export function GET(request) {
  return handle(request);
}

export function POST(request) {
  return handle(request);
}
