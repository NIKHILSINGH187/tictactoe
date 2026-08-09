// Netlify Function — server-side proxy to the GEMINI API (free tier friendly).
// The API key lives in a Netlify environment variable (GEMINI_API_KEY),
// never in the browser bundle. The React app calls THIS function instead
// of calling Google's API directly.
//
// This function accepts the SAME shape the frontend already sends
// ({ system, messages, max_tokens }) and internally translates it to
// Gemini's request/response format, so MindGrid.jsx doesn't need to change
// at all — only this file and the env var name changed.

const GEMINI_MODEL = "gemini-2.5-flash"; // free tier model, good speed/quality balance

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "GEMINI_API_KEY is not set in Netlify environment variables." }) };
  }

  try {
    const { system, messages } = JSON.parse(event.body || "{}");
    const userText = (messages && messages[0] && messages[0].content) || "";

    const geminiBody = {
      system_instruction: { parts: [{ text: system || "" }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(geminiBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
    }

    // Translate Gemini's response shape back into the { content: [{text}] }
    // shape the frontend already expects (same shape Anthropic used).
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join(" ") || "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text }] }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

