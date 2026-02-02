const { SlashCommandBuilder } = require("discord.js");
const { debugCookieAuth } = require("../../helpers/helpers.cjs");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-auth")
    .setDescription("Check which YouTube account's cookies are being used for playback"),
  async execute(interaction) {
    await interaction.deferReply(); // This might take a moment

    try {
      const result = await debugCookieAuth();

      if (result === null) {
        await interaction.editReply({
          content: "❌ **Critical Error:** Failed to connect to YouTube. Check bot console for details.",
        });
        return;
      }

      if (result.authenticated) {
        let replyContent = `✅ **YouTube Authentication: SUCCESS**\n\n`;
        replyContent += `The bot is authenticated with YouTube cookies from Firefox.\n\n`;

        if (result.recentSubscriptions && result.recentSubscriptions.length > 0) {
          replyContent += `**Recent Subscription Videos:**\n`;
          result.recentSubscriptions.forEach((entry, i) => {
            const channel = entry.channel || entry.uploader || "Unknown channel";
            replyContent += `${i + 1}. *${entry.title}* (${channel})\n`;
          });
          replyContent += `\n💡 If these aren't your subscriptions, a different Firefox profile may be in use.`;
        }

        await interaction.editReply({ content: replyContent });
      } else {
        let replyContent = `⚠️ **YouTube Authentication: FAILED**\n\n`;
        replyContent += `The bot could not access authenticated YouTube features.\n\n`;
        replyContent += `**Possible reasons:**\n`;
        replyContent += `• Firefox is not logged into YouTube\n`;
        replyContent += `• Cookies have expired\n`;
        replyContent += `• Wrong Firefox profile is being used\n\n`;
        replyContent += `**Error:** \`${result.error || "Unknown"}\``;

        await interaction.editReply({ content: replyContent });
      }
    } catch (err) {
      console.error("Debug auth command error:", err);
      await interaction.editReply({
        content: `❌ **Error running debug check:** ${err.message || err}`,
      });
    }
  },
};

