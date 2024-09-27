const { SlashCommandBuilder } = require("discord.js");
const { EmbedBuilder } = require("discord.js");
const { OpenAI } = require("openai");
const openaikey = process.env.GPT_API_KEY;

const openai = new OpenAI({
  apiKey: openaikey,
});

const dreamyImage = `https://i.kym-cdn.com/entries/icons/original/000/042/513/dreamybull.jpg`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("image")
    .setDescription("This is REAL art!")
    .addStringOption((option) =>
      option.setName("message").setDescription("Ask DreamyBot to create anything you can imagine 😲").setRequired(true)
    ),

  async execute(interaction) {
    await interaction.reply("Let me think about it...");
    let size = "1024x1024";
    let message = interaction.options.getString("message");
    if (message.includes("{landscape}")) {
      size = "1792x1024";
      message = message.replace("{landscape}", "");
    } else if (message.includes("{portrait}")) {
      size = "1024x1792";
      message = message.replace("{portrait}", "");
    }
    let response = await openai.images
      .generate({
        model: "dall-e-3",
        prompt: message,
        n: 1,
        size: size,
      })
      .catch((err) => {
        if (err.error.message.includes("safety system")) {
          interaction
            .editReply(
              `OpenAI did NOT like that prompt: \n\n"**${interaction.options.getString(
                "message"
              )}**"\n\nApparently '*Your request was rejected as a result of our safety system.*' Try being more SAFE!`
            )
            .catch((err) => {
              interaction.editReply(err);
            });
        } else {
          console.log("*** BIG ERROR", err);
          interaction.editReply(`"**${interaction.options.getString("message")}**"\n\nIdk what tf you talking bout dawg`);
        }
      });
    image_url = response.data[0].url;

    const imageEmbed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("Your image")
      // .setURL("https://discord.js.org/")
      .setAuthor({ name: "DreamyBot", iconURL: dreamyImage })
      .setDescription(`"${interaction.options.getString("message")}"`)
      // .setThumbnail(dreamyImage)
      .setImage(image_url)
      .setTimestamp();
    // .setFooter({ text: "Some footer text here", iconURL: "https://i.imgur.com/AfFp7pu.png" });

    await interaction.editReply({ embeds: [imageEmbed] }).catch((err) => {
      console.log(err);
      interaction.editReply("Ah fuck, I have encountered a problem generating your response.");
    });
  },
};
