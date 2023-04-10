const { SlashCommandBuilder } = require("discord.js");
const ytdl = require("ytdl-core");

module.exports = {
  cooldown: 2,
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Plays youtube, hopefully!")
    .addStringOption((option) =>
      option.setName("url").setDescription("Youtube link")
    ),

  async execute(interaction) {
    console.log(interaction);
    await interaction.reply("Pong!");
  },
};
