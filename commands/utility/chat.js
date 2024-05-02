const { SlashCommandBuilder } = require("discord.js");
const { OpenAI } = require("openai");
const openaikey = process.env.GPT_API_KEY;

const openai = new OpenAI({
  apiKey: openaikey,
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName("chat")
    .setDescription("what if the robot go crazy they might take over the world")
    .addStringOption((option) =>
      option.setName("message").setDescription("What would you like to ask DreamyBot?").setRequired(true)
    ),

  async execute(interaction) {
    await interaction.reply("Let me think about it...");
    let completion = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: `${interaction.options.getString("message")}`,
        },
      ],
    });

    console.log("*** Your response is: ", completion?.choices[0]?.message);

    const result = completion?.choices[0]?.message?.content;
    let splitResult = [];
    let tooLong = false;

    //check if result is longer than discord 2000 count message limit
    if (result.length > 1200) {
      tooLong = true;
      let startIndex = 0;
      for (var i = 0; i < result.length; i++) {
        if (i % 1200 == 0 && i != 0) {
          splitResult.push(result.substring(startIndex, i));
          startIndex = i;
        }
        //once i reaches end, add remaining to splitResult
        i == result.length - 1 && splitResult.push(result.substring(startIndex, i));
      }
    }

    /* I initially wrote this thinking tooLong would be reused someplace else, excuse the redundancy */
    if (tooLong) {
      await interaction.editReply(`**"${interaction.options.getString("message")}":**
      \`\`\`fix
      ${splitResult[0]}-
      (Part 1)
      \`\`\``);
      splitResult.forEach((section, index) => {
        if (section !== splitResult[0]) {
          interaction.channel.send({
            content: `\`\`\`fix
          -${splitResult[index]}
          (Part ${index + 1})
          \`\`\``,
          });
        }
      });
    } else {
      await interaction
        .editReply(
          `**"${interaction.options.getString("message")}":**
       \`\`\`fix
      ${result}
      \`\`\` `
        )
        .catch((err) => {
          console.log(err);
          interaction.editReply("Ah fuck, I have encountered a problem generating your response.");
        });
    }
  },
};
