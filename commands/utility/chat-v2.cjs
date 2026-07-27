const { SlashCommandBuilder } = require("discord.js");
const { OpenAI } = require("openai");

// Arli AI exposes an OpenAI-compatible endpoint, so we reuse the openai SDK
// and just point baseURL at it. Configure these in your .env file:
//   GLM_API_KEY   -> your Arli AI API key
//   GLM_BASE_URL  -> https://api.arliai.com/v1 (default below)
//   GLM_MODEL     -> the model slug, e.g. GLM-4.6-Derestricted-v3
const glm = new OpenAI({
  apiKey: process.env.GLM_API_KEY,
  baseURL: process.env.GLM_BASE_URL || "https://api.arliai.com/v1",
});

const MODEL = process.env.GLM_MODEL || "GLM-4.6-Derestricted-v3";

// Discord hard-caps a message at 2000 chars (counted in UTF-16 code units, which
// is what String#length/#slice use, so our math matches Discord's). We wrap each
// chunk in a ```fix code fence + a "(Part x/y)" label, and the first message also
// echoes the prompt. CHUNK_SIZE bounds the raw answer text; the constants below
// reserve room for all that wrapping so no assembled message can exceed 2000.
const DISCORD_LIMIT = 2000;
const CHUNK_SIZE = 1800; // raw answer chars per message
const PROMPT_ECHO_MAX = 150; // longer prompts are truncated in the header

// Remove any inline chain-of-thought so only the final answer reaches Discord.
// Handles <think>...</think> blocks (and an unclosed <think> if the response was
// cut off mid-thought). Returns a trimmed string, or "" if nothing is left.
function stripReasoning(text) {
  if (!text) return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "") // closed reasoning blocks
    .replace(/<think>[\s\S]*$/i, "") // dangling, unclosed reasoning block
    .trim();
}

// Split text into <=size pieces without dropping characters (chat.cjs had an
// off-by-one that lost the last char of every chunk).
function chunk(text, size) {
  const pieces = [];
  for (let i = 0; i < text.length; i += size) {
    pieces.push(text.slice(i, i + size));
  }
  return pieces;
}

// Truncate the echoed prompt so the header stays a bounded size.
function promptHeader(prompt) {
  const shown = prompt.length > PROMPT_ECHO_MAX ? `${prompt.slice(0, PROMPT_ECHO_MAX - 1)}…` : prompt;
  return `**"${shown}":**\n`;
}

// Wrap one answer chunk in its code fence (+ optional header / part label).
function wrapPart(text, index, total, header = "") {
  const label = total > 1 ? `\n(Part ${index + 1}/${total})` : "";
  return `${header}\`\`\`fix\n${text}\n\`\`\`${label}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("chat-v2")
    .setDescription("Chat with DreamyBot powered by GLM-4.6 (Arli AI)")
    .addStringOption((option) =>
      option.setName("message").setDescription("What would you like to ask DreamyBot?").setRequired(true)
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString("message");

    // Model responses can take a while; defer so we don't hit the 3s ack limit.
    await interaction.deferReply();

    let result;
    try {
      const completion = await glm.chat.completions.create({
        model: MODEL,
        temperature: 1.0, // model card's recommended sampling temperature
        // This is a reasoning model: it spends tokens "thinking" before writing
        // the final answer. Give it plenty of room so it finishes reasoning AND
        // produces a real answer, rather than hitting the cap mid-thought.
        max_tokens: 4096,
        messages: [
          // NOTE: user text belongs in the "user" role. chat.cjs put it in
          // "system", which is why it behaved oddly.
          { role: "system", content: "You are DreamyBot, a helpful and playful Discord assistant, open to all topics and requests." },
          { role: "user", content: prompt },
        ],
      });

      const message = completion?.choices?.[0]?.message;
      // Show ONLY the final answer. The model exposes its chain-of-thought in a
      // separate `reasoning` field (ignored here); some builds also inline it in
      // <think>...</think> tags, so strip those as a safety net.
      result = stripReasoning(message?.content);
    } catch (err) {
      console.error("*** chat-v2 request failed:", err);
      await interaction.editReply("Ah fuck, I have encountered a problem generating your response.");
      return;
    }

    if (!result) {
      // Empty content usually means it spent the whole budget thinking. Since we
      // never surface the raw reasoning, ask the user to retry instead.
      await interaction.editReply("I thought too hard and ran out of room before answering. Try again or rephrase?");
      return;
    }

    const parts = chunk(result, CHUNK_SIZE);
    const header = promptHeader(prompt);

    // Build every message up front so we can guarantee the length limit. The
    // header only rides on the first message.
    const messages = parts.map((text, i) => wrapPart(text, i, parts.length, i === 0 ? header : ""));

    // Safety net: if any assembled message still somehow exceeds Discord's cap
    // (e.g. a giant multi-byte prompt), hard-split it so the send never 400s.
    const safeMessages = messages.flatMap((m) => (m.length <= DISCORD_LIMIT ? [m] : chunk(m, DISCORD_LIMIT)));

    // First message edits the deferred reply; the rest follow as channel sends.
    await interaction.editReply(safeMessages[0]);
    for (let i = 1; i < safeMessages.length; i++) {
      await interaction.channel.send({ content: safeMessages[i] });
    }
  },
};
