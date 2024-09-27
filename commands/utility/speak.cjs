const { SlashCommandBuilder, MessageFlags, Attachment, MessageFlagsBitField } = require("discord.js");
const { OpenAI } = require("openai");
const openaikey = process.env.GPT_API_KEY;

const fs = require("fs");
const path = require("path");

const openai = new OpenAI({
  apiKey: openaikey,
});

const voiceSelection = ["alloy", "fable", "echo", "onyx", "nova", "shimmer"];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("speak")
    .setDescription("Oh I'm sayin it! 🤬 (sends a tts mp3 file)")
    .addStringOption((option) =>
      option.setName("message").setDescription("What would you like DreamyBot to say?").setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("voice-model")
        .setDescription("TTS voice model")
        .setRequired(true)
        .addChoices(
          { name: "Alloy - Neutral 1", value: 1 },
          { name: "Fable - Neutral 2", value: 2 },
          { name: "Echo - Masc 1", value: 3 },
          { name: "Onyx - Masc 2", value: 4 },
          { name: "Nova - Fem 1", value: 5 },
          { name: "Shimmer - Fem 2", value: 6 }
        )
    ),
  async execute(interaction) {
    await interaction.reply("Let me think about it...");

    const speechFile = path.resolve("./commands/utility/speakfiles/tts.mp3");
    const selection = interaction.options.getNumber("voice-model");
    let mp3;
    try {
      mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: selection ? voiceSelection[selection - 1] : voiceSelection[2],
        input: `${interaction.options.getString("message")}`,
      });
    } catch (err) {
      console.log("*** Speech file error", err);
    }

    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.promises.writeFile(speechFile, buffer);

    await interaction.editReply({
      content: `**"${interaction.options.getString("message")}"**`,
      files: [
        {
          attachment: speechFile,
          name: "tts.mp3",
          contentType: "audio/mp3",
          waveform: new Buffer.from(new Uint8Array([1, 2, 3])).toString("base64"),
        },
      ],
      flags: new MessageFlagsBitField([MessageFlags.IsVoiceMessage]).toJSON(),
    });
  },
};
