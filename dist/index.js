// ---------- HUGGING FACE ----------
const hfResponse = await request(
  {
    hostname: "api-inference.huggingface.co",
    path: "/models/google/flan-t5-large",
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INPUT_HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/json"
    }
  },
  {
    inputs: `Summarize this git diff in 2-3 bullet points:\n\n${diff}`
  }
);

let summary = "⚠️ No summary generated";

// HF response format handling
if (Array.isArray(hfResponse) && hfResponse[0]?.generated_text) {
  summary = hfResponse[0].generated_text.trim();
} else if (hfResponse?.error) {
  summary = `HF Error: ${hfResponse.error}`;
  console.log("HF error:", hfResponse);
} else {
  console.log("HF raw response:", JSON.stringify(hfResponse, null, 2));
}
