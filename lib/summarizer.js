const axios = require("axios");

async function summarize(apiKey, model, diff) {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      messages: [
        {
          role: "system",
          content:
            "Summarize this git commit in 2-3 bullet points. Include impact and risks."
        },
        {
          role: "user",
          content: diff
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.choices[0].message.content;
}

module.exports = { summarize };
