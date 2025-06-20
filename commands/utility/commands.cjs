const { SlashCommandBuilder } = require("discord.js");
const pre = process.env.COMMAND_PREFIX;

module.exports = {
  data: new SlashCommandBuilder().setName("commands").setDescription("Display all bot commands"),
  async execute(interaction) {
    await interaction.reply(`Hey ${interaction.user.username}, here's a list of my abilities:

    **~ Music Commands ~**
    
    **${pre}play [youtube link]:** Plays a song.
    **${pre}playlist [youtube playlist link]:** Queues up and plays a playlist.
    **${pre}pause:** Pause the current track.
    **${pre}resume:** Resumes paused track.
    **${pre}skip:** Skip the current track.
    **${pre}loop:** Loop the current track.
    **${pre}stop:** End the bot playback.
    **${pre}queue:** Display the queue.
    **${pre}current:** Display current song data.
    **${pre}volume [1-10]:** Set bot playback volume.
    **${pre}shuffle:** Shuffle tracks in queue.

    **~ Misc. Chat Commands ~**
    **~!wiki:** Search for a wikipedia article.
    
    **~ Utility ~**
    
    **/chat:** Ask DreamyBot anything (powered by ChatGPT 4o 🤓).
    **/commands:** Display all commands.
    **/image:** Ask DreamyBot to create whatever you can imagine! (powered by Dall-e 3 🤓). Use {landscape} or {portrait} in your prompt to specify dimensions)
    **/image-v2:** Ask DreamyBot to create whatever you can imagine! (powered by Stable Diffusion FLUX). Use {width} or {height} modes to specify dimensions)
    **/speak:** Let DreamyBot speak its mind! (Create a text-to-speech audio file)
    **/speakVC:** Let DreamyBot speak its mind! (Play TTS audio in a voice channel)`);
  },
};
