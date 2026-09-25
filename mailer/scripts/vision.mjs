#!/usr/bin/env node
// vision.mjs — «глаза» агента: описание скриншотов через vision-модель.
// Ключ: env VISION_KEY или auth.json.fuzeprovider.key (наружу не печатается).
// usage: node scripts/vision.mjs <img> [вопрос]   (env: VISION_MODEL, VISION_BASE, VISION_KEY)
import { readFileSync } from "node:fs";

const [img, question] = process.argv.slice(2);
if (!img) {
  console.error("usage: node scripts/vision.mjs <image.png> [вопрос]");
  process.exit(2);
}
let key = process.env.VISION_KEY || "";
let model = process.env.VISION_MODEL || "kimi-k3";
const base = (process.env.VISION_BASE || "https://api.fuzeprovider.xyz/v1").replace(/\/$/, "");
if (!key) {
  try {
    const auth = JSON.parse(readFileSync(new URL("file:///C:/Users/MateBook/.pi/agent/auth.json"), "utf8"));
    key = auth["fuzeprovider-kimi"]?.key || auth.fuzeprovider?.key;
  } catch {}
}
if (!key) {
  console.error("нет ключа: задай VISION_KEY");
  process.exit(2);
}
const b64 = readFileSync(img).toString("base64");
const res = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: question || "Опиши подробно что на скриншоте: экран, верхняя панель, кнопки с точными текстами, попапы/баннеры/капчи, любые надписи.",
          },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
  }),
});
if (!res.ok) {
  console.error("API error:", res.status, (await res.text()).slice(0, 300));
  process.exit(1);
}
const j = await res.json();
const content = j.choices?.[0]?.message?.content;
if (!content || /не вижу|no image|нет изображ/i.test(content)) {
  console.error("МОДЕЛЬ НЕ ВИДИТ КАРТИНКУ (text-only?):", String(content).slice(0, 150));
  process.exit(3);
}
console.log(content);
