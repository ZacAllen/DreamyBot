const { SlashCommandBuilder, MessageFlags, Attachment, MessageFlagsBitField } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
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
    .setName("speak-vc")
    .setDescription("Oh I'm sayin it! 🤬 (plays TTS message in voice channel)")
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

    const speechFile = path.resolve("./commands/utility/speakfiles-VC/tts.mp3");
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
    //TODO increase volume? Possible?

    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply("You need to be in a voice channel to use this command!");
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    let isPaused = false;
    let vc = interaction.member.voice.channel;

    const player = createAudioPlayer();
    const resource = createAudioResource(speechFile);

    //! For sure player is causing issues, conflicting with audiomanager?
    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      if (isPaused) {
        currentPlayer.resume(vc);
        console.log("*** RESUMING PLEASE?", currentPlayer.getCurrentSong(vc).paused, currentPlayer.getCurrentSong(vc).pauses);
        isPaused = false;
      }
    });

    await interaction.editReply({
      content: `**"${interaction.options.getString("message")}"**`,
    });
  },
};
