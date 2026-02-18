import {
    ChatInputCommandInteraction,
    Events,
    MessageFlags,
    SlashCommandBuilder,
    type Client,
    type Guild,
} from "discord.js";
import { generateSentence } from "./predict";

const imitateCommand = new SlashCommandBuilder()
    .setName("imitate")
    .setDescription("Generate non-AI slop")
    .addUserOption((option) =>
        option
            .setName("user")
            .setDescription("User to imitate")
            .setRequired(false),
    )
    .addChannelOption((option) =>
        option
            .setName("channel")
            .setDescription("Channel to limit training data to")
            .setRequired(false),
    )
    .addStringOption((option) =>
        option
            .setName("prompt")
            .setDescription("Prompt to extend")
            .setRequired(false),
    );

export async function register(client: Client<true>) {
    await Promise.all(
        client.guilds.cache.map(
            async (guild) => await guild.commands.create(imitateCommand),
        ),
    );
    console.log("Registered /imitate command with all guilds");

    // Handle /imitate commands
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== "imitate") return;
        await handleImitateCommand(interaction);
    });
}

async function handleImitateCommand(interaction: ChatInputCommandInteraction) {
    console.debug("/imitate triggered", { user: interaction.user.id });
    try {
        const user = interaction.options.getUser("user");
        const channel = interaction.options.getChannel("channel");
        const prefix = interaction.options.getString("prompt") ?? "";
        const response = await generateSentence(
            prefix,
            interaction.guildId!,
            user?.id,
            channel?.id,
        );
        await interaction.reply({
            content: response,
        });
    } catch (error) {
        await interaction.reply({
            content: `⚠️ Error: ${error instanceof Error ? error.message : error}`,
            flags: MessageFlags.Ephemeral,
        });
    }
}
