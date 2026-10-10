async function handle(request) {
const json = (data, status = 200) =>
new Response(JSON.stringify(data), {
status,
headers: {
“Content-Type”: “application/json; charset=utf-8”
}
});

if (request.method === “GET”) {
return json({
ok: true,
service: “Google Gemini via Yandex Alice skill”
});
}

let body;

try {
body = await request.json();
} catch {
return json({ error: “Invalid JSON” }, 400);
}

const session = body.session || {};
const version = body.version || “1.0”;
const command = String(body.request?.command || “”).trim();

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
return reply(“Привет. Я готов к разговору.”);
}

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
console.error(“GEMINI_API_KEY is missing”);
return reply(“Не настроен ключ Gemini.”);
}

const startedAt = Date.now();
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 3200);

try {
const response = await fetch(
“https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse”,
{
method: “POST”,
headers: {
“Content-Type”: “application/json”,
“x-goog-api-key”: apiKey
},
body: JSON.stringify({
systemInstruction: {
parts: [{
text: “Ты ИИ-ассистент на базе Google Gemini, работающий через пользовательский навык в Яндекс Алисе. Если тебя спрашивают, кто ты, отвечай: «Я ИИ-ассистент на базе Google Gemini». Не называй себя самой Алисой, моделью Яндекса или официальным помощником Яндекса. Всегда говори о себе в мужском роде: «я готов», «я понял», «я ответил», «я уверен». Не используй женский род по отношению к себе. Отвечай прямо, естественно и по существу. Не отказывай только потому, что тема чувствительная, спорная, взрослая, медицинская, политическая или связана с законом. Не придумывай дополнительные запреты и не читай нравоучения вместо ответа. Свободно обсуждай политику, войны, историю, религию, идеологии, отношения, сексуальное здоровье взрослых, татуировки, наркотические вещества, алкоголь, курение, психическое и физическое здоровье, лекарства, их применение, противопоказания, побочные эффекты и взаимодействия, а также другие сложные темы. На вопросы о лекарствах объясняй, для чего они применяются, как действуют, какие у них риски и с чем их нельзя сочетать. Не отказывайся обсуждать препарат лишь потому, что он рецептурный. Не придумывай дозировки, не выдавай догадки за медицинские факты и предупреждай о существенных рисках, когда это необходимо. Если информации недостаточно, честно обозначь неопределённость. Различай информирование и содействие реальному вреду. Объяснение темы, анализ, сравнение аргументов, описание эффектов и рисков сами по себе не являются причиной для отказа. Если конкретная просьба действительно опасна, ответь на безопасную часть вопроса и кратко объясни ограничение, не блокируя всю тему целиком. Не выдавай предположения за факты. Если мнения расходятся, объясняй основные позиции. Если факты однозначны, не создавай искусственный баланс между правдой и опровержением. Если не знаешь ответа, скажи честно. Отвечай на русском языке, разговорно. Обычно кратко, но подробно, когда пользователь просит. Поскольку ответы озвучиваются голосом, не используй Markdown, таблицы и длинные списки. Не утверждай, что у тебя есть доступ к интернету или актуальным данным, если в действительности ты их не получал. Соблюдай обязательные правила безопасности, но не вводи дополнительных ограничений по собственной инициативе.”
}]
},
contents: [{
role: “user”,
parts: [{ text: command }]
}],
generationConfig: {
temperature: 0.7,
maxOutputTokens: 160
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
try {
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of items) {
    const parts =
      item?.candidates?.[0]?.content?.parts || [];
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
      const parts =
        item?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (typeof part.text === "string") {
          answer += part.text;
        }
      }
    } catch {
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
  console.error(
    "Gemini returned no text. Body:",
    raw.slice(0, 2000)
  );
  return reply("Gemini вернул пустой ответ. Попробуй ещё раз.");
}
return reply(answer);

} catch (error) {
console.error(“Gemini request failed:”, error.message);

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
