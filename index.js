
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
    return json({ ok: true, service: "Alice + Gemini" });
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
    return reply("Не настроен ключ Gemini.", body);
  }

  const controller = new AbortController();
  const started = Date.now();
  let reader;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text:
                "Ты голосовой помощник Алисы. " +
                "Отвечай по-русски. " +
                "Кратко, естественно, максимум одним предложением. " +
                "Не используй Markdown."
            }]
          },
          contents: [{
            role: "user",
            parts: [{ text: command }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 60,
            thinkingConfig: {
              thinkingLevel: "LOW"
            }
          }
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const details = await response.text();
      console.error(
        "Gemini API error:",
        response.status,
        details.slice(0, 1000)
      );
      return reply("Ошибка Gemini API.", body);
    }

    if (!response.body) {
      return reply("Gemini не вернул поток данных.", body);
    }

    reader = response.body.getReader();

    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    const deadline = Date.now() + 3300;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();

      let result;

      try {
        result = await Promise.race([
          reader.read(),
          new Promise(resolve =>
            setTimeout(
              () => resolve({ timedOut: true }),
              remaining
            )
          )
        ]);
      } catch (error) {
        if (answer) break;
        throw error;
      }

      if (result.timedOut || result.done) break;

      buffer += decoder.decode(result.value, {
        stream: true
      });

      let boundary;

      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;

          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let chunk;

          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }

          const text = (
            chunk.candidates?.[0]?.content?.parts || []
          )
            .map(part => part.text || "")
            .join("");

          if (text) answer += text;

          if (
            answer.length >= 100 ||
            (answer.length >= 15 && /[.!?…]\s*$/.test(answer))
          ) {
            break;
          }
        }

        if (
          answer.length >= 100 ||
          (answer.length >= 15 && /[.!?…]\s*$/.test(answer))
        ) {
          break;
        }
      }

      if (
        answer.length >= 100 ||
        (answer.length >= 15 && /[.!?…]\s*$/.test(answer))
      ) {
        break;
      }
    }

    await reader.cancel().catch(() => {});

    console.log(
      "Gemini stream time ms:",
      Date.now() - started,
      "answer length:",
      answer.length
    );

    if (!answer.trim()) {
      return reply("Gemini не успел сформировать ответ.", body);
    }

    return reply(answer.trim(), body);

  } catch (error) {
    console.error(
      "Gemini stream failed:",
      Date.now() - started,
      error.name,
      error.message
    );

    return reply("Gemini не успел ответить.", body);

  } finally {
    controller.abort();

    if (reader) {
      await reader.cancel().catch(() => {});
    }
  }
}

export function GET(request) {
  return handle(request);
}

export function POST(request) {
  return handle(request);
}
