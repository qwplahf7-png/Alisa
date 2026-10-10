tatus;
res.setHeader(“Content-Type”, “application/json; charset=utf-8”);
res.end(JSON.stringify(data));
}

function searchNeeded(text) {
return /сейчас|сегодня|вчера|последн|актуальн|новост|курс валют|погода|цена сегодня|на данный момент|latest|today|current|recent|news|weather|price/i.test(text);
}

async function search(query) {
const key = process.env.SERPER_API_KEY;
if (!key) return “”;

const response = await fetch(“https://google.serper.dev/search”, {
method: “POST”,
headers: {
“X-API-KEY”: key,
“Content-Type”: “application/json”
},
body: JSON.stringify({
q: query,
gl: “ru”,
hl: “ru”,
num: 5
}),
signal: AbortSignal.timeout(6500)
});

if (!response.ok) {
throw new Error(“Search API “ + response.status);
}

const data = await response.json();

return (data.organic || [])
.slice(0, 5)
.map((item, index) =>
${index + 1}. ${item.title || ""}: ${item.snippet || ""} ${item.link || ""}
)
.join(”\n”)
.slice(0, 5000);
}

async function gemini(history, query, searchResults) {
const key = process.env.GEMINI_API_KEY;

if (!key) {
throw new Error(“NO_GEMINI”);
}

const contents = history
.filter(item =>
item &&
[“user”, “model”].includes(item.role) &&
typeof item.text === “string”
)
.slice(-MAX_HISTORY)
.map(item => ({
role: item.role,
parts: [{ text: item.text.slice(0, 2500) }]
}));

const userText = searchResults
? query + “\n\nРезультаты поиска:\n” + searchResults
: query;

contents.push({
role: “user”,
parts: [{ text: userText }]
});

const response = await fetch(
“https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=” +
encodeURIComponent(key),
{
method: “POST”,
headers: {
“Content-Type”: “application/json”
},
body: JSON.stringify({
contents,
systemInstruction: {
parts: [{
text: “Ты голосовой помощник Алисы на русском языке. Отвечай кратко, обычно 1–3 предложения, без Markdown и длинных списков. Не выдумывай факты. Если информации недостаточно, честно скажи об этом.”
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

if (!response.ok) {
const details = await response.text();
console.error(“Gemini API error:”, response.status, details.slice(0, 500));
throw new Error(“Gemini API “ + response.status);
}

const data = await response.json();

const answer = (data.candidates?.[0]?.content?.parts || [])
.map(part => part.text || “”)
.join(””)
.trim();

if (!answer) {
throw new Error(“EMPTY_GEMINI_RESPONSE”);
}

return answer.slice(0, 4000);
}

module.exports = async (req, res) => {
if (req.method !== “POST”) {
return send(res, 200, {
ok: true,
service: “Yandex Alice webhook”,
method: “POST”
});
}

try {
const body = req.body || {};
const request = body.request || {};
const session = body.session || {};

const command = String(
  request.command ||
  request.original_utterance ||
  ""
).trim();
const previousHistory = Array.isArray(body.state?.session?.history)
  ? body.state.session.history
  : [];
const history = previousHistory
  .filter(item =>
    item &&
    ["user", "model"].includes(item.role) &&
    typeof item.text === "string"
  )
  .slice(-MAX_HISTORY);
if (!command) {
  return send(res, 200, {
    version: body.version || "1.0",
    session,
    response: {
      text: "Привет! Я слушаю.",
      end_session: false
    },
    session_state: {
      history
    }
  });
}
let searchResults = "";
if (searchNeeded(command)) {
  try {
    searchResults = await search(command);
  } catch (error) {
    console.error("Search error:", error.message);
  }
}
const answer = await gemini(
  history,
  command,
  searchResults
);
const updatedHistory = [
  ...history,
  { role: "user", text: command },
  { role: "model", text: answer }
].slice(-MAX_HISTORY);
return send(res, 200, {
  version: body.version || "1.0",
  session,
  response: {
    text: answer,
    end_session: false
  },
  session_state: {
    history: updatedHistory
  }
});

} catch (error) {
console.error(“Webhook error:”, error.message);

const body = req.body || {};
const message = error.message === "NO_GEMINI"
  ? "Не настроен ключ Gemini. Проверь переменные окружения сервера."
  : "Не получилось получить ответ. Попробуй ещё раз.";
return send(res, 200, {
  version: body.version || "1.0",
  session: body.session || {},
  response: {
    text: message,
    end_session: false
  }
});

}
};
