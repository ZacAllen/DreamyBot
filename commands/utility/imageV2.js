import { AttachmentBuilder, SlashCommandBuilder } from "discord.js";
import { HfInference } from "@huggingface/inference";
import { writeFile } from "fs/promises";
import { join, resolve } from "path";

const HF_TOKEN = process.env.HF_TOKEN;
const inference = new HfInference(HF_TOKEN);

class ImageV2Command {
  constructor() {
    this.data = new SlashCommandBuilder()
      .setName("image-v2")
      .setDescription("This is REAL art! (Flux Stable Diffusion)")
      .addStringOption((option) =>
        option.setName("message").setDescription("Ask DreamyBot to create anything you can imagine 😲").setRequired(true)
      )
      .addNumberOption((option) => option.setName("height").setDescription("Image height in pixels"))
      .addNumberOption((option) => option.setName("width").setDescription("Image width in pixels"));
    this.execute = async function (interaction) {
      await interaction.reply("Let me think about it...");
      let message = interaction.options.getString("message");
      let randomSeed = Math.random().toString(16).slice(2); //prevent duplicate images
      console.log("*** Seed", randomSeed);
      const out = await inference
        .textToImage({
          // model: "stabilityai/stable-diffusion-2",
          // model: "black-forest-labs/FLUX.1-dev",
          model: "black-forest-labs/FLUX.1-dev-onnx",
          inputs: `${message} ${randomSeed}`,
          parameters: {
            // TODO user controlled parameters; negative prompt unavailable on FLUX
            // negative_prompt: "blurry",
            height: interaction.options.getNumber("height") ?? 1024,
            width: interaction.options.getNumber("width") ?? 1024,
            // guidance_scale: 2,
          },
        })
        .catch((err) => {
          interaction.editReply(`Failed to generate image during generation. Error: ${err}`);
        });

      try {
        const buffer = await out.arrayBuffer();
        const fileExt = "jpg";
        const fileName = `${Date.now().toString()}.${fileExt}`;
        const filePath = resolve(join("./commands/utility/imageGen/", fileName));
        // Saving image
        await writeFile(filePath, Buffer.from(buffer));
        const image_url = new AttachmentBuilder(filePath);

        //! Removed embed, local files cannot be set as embed Image, only message attachment

        await interaction.editReply({ content: `**${message}**`, files: [image_url] }).catch((err) => {
          console.log(err);
          interaction.editReply("Ah fuck, I have encountered a problem generating your response.");
        });
      } catch (err) {
        interaction.editReply(`Failed to generate image during upload. Error: ${err}`);
      }
    };
  }
}

export default new ImageV2Command();
