const MAX_HISTORY = 12;

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function searchNeeded(t) {
  return /сейчас|сегодня|вчера|последн|актуальн|новост|курс валют|погода|цена сегодня|на данный момент|latest|today|current|recent|news|weather|price/i.test(t);
}

async function search(q) {
  const k = process.env.SERPER_API_KEY;
  if (!k) return "";

  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": k,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ q, gl: "ru", hl: "ru", num: 5 }),
    signal: AbortSignal.timeout(6500)
  });

  if (!r.ok) throw new Error("Search API " + r.status);

  const d = await r.json();
  return (d.organic || []).slice(0, 5)
    .map((x, i) => `${i + 1}. ${x.title || ""}: ${x.snippet || ""} ${x.link || ""}`)
    .join("\n")
    .slice(0, 5000);
}

async function gemini(history, q, web) {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("NO_GEMINI");

  const contents = history
    .filter(x => x && ["user", "model"].includes(x.role) && typeof x.text === "string")
    .slice(-MAX_HISTORY)
    .map(x => ({
      role: x.role,
      parts: [{ text: x.text.slice(0, 2500) }]
    }));

  contents.push({
    role: "user",
    parts: [{
      text: web ? q + "\n\nРезультаты поиска:\n" + web : q
    }]
  });

  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(k),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: {
          parts: [{
            text: "Ты голосовой помощник Алисы на русском языке. Отвечай кратко, обычно 1–3 предложения, без Markdown и длинных списков. Не выдумывай факты."
          }]
        },
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 220
        }
      }),
      signal: AbortSignal.timeout(17000)
    }
  );

  if (!r.ok) {
    throw new Error("Gemini API " + r.status);
  }

  const d = await r.json();
  const answer = (d.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || "")
    .join("")
    .trim();

  if (!answer) throw new Error("EMPTY_GEMINI_RESPONSE");
  return answer.slice(0, 4000);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return send(res, 200, {
      ok: true,
      service: "Yandex Alice webhook",
      method: "POST"
    });
  }

  try {
    const body = req.body || {};
    const request = body.request || {};
    const session = body.session || {};
    const command = String(
      request.command || request.original_utterance || ""
    ).trim();

    const history = Array.isArray(body.state?.session?.history)
      ? body.state.session.history.filter(
          x => x && ["user", "model"].includes(x.role) && typeof x.text === "string"
        )
      : [];

    if (!command) {
      return send(res, 200, {
        version: body.version || "1.0",
        session,
        response: {
          text: "Привет! Я слушаю.",
          end_session: false
        },
        session_state: {
          history: history.slice(-MAX_HISTORY)
        }
      });
    }

    let web = "";

    if (searchNeeded(command)) {
      try {
        web = await search(command);
      } catch (e) {
        console.error("Search error:", e.message);
      }
    }

    const answer = await gemini(history, command, web);

    return send(res, 200, {
      version: body.version || "1.0",
      session,
      response: {
        text: answer,
        end_session: false
      },
      session_state: {
        history: [
          ...history,
          { role: "user", text: command },
          { role: "model", text: answer }
        ].slice(-MAX_HISTORY)
      }
    });
  } catch (e) {
    console.error("Webhook error:", e.message);

    const body = req.body || {};

    return send(res, 200, {
      version: body.version || "1.0",
      session: body.session || {},
      response: {
        text: e.message === "NO_GEMINI"
          ? "Не настроен ключ Gemini. Проверь переменные окружения сервера."
          : "Не получилось получить ответ. Попробуй ещё раз.",
        end_session: false
      }
    });
  }
};
