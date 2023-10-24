const { SlashCommandBuilder } = require("discord.js");
const pre = process.env.COMMAND_PREFIX;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("commands")
    .setDescription("Display all bot commands"),
  async execute(interaction) {
    await interaction.reply(`Hey ${interaction.user.username}, here's a list of my abilities:

    **~ Music Commands ~**
    
    **${pre}play [youtube link]:** Plays a song.

    **${pre}pause:** Pause the current track.

    **${pre}resume:** Resumes paused track.

    **${pre}skip:** Skip the current track.

    **${pre}loop:** Loop the current track.

    **${pre}stop:** End the bot playback.

    **${pre}queue:** Display the queue.

    **${pre}volume [1-10]:** Set bot playback volume.

    **${pre}shuffle:** Shuffle tracks in queue.
    
    
    **~ Utility ~**
    
    **/chat:** Ask DreamyBot anything (powered by ChatGPT 3.5 🤓).`);
  },
};
