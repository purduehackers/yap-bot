import {
    ChatInputCommandInteraction,
    Events,
    MessageFlags,
    SlashCommandBuilder,
    type Client,
    type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { generateSentence } from "./predict";
import { db } from "./db";
import { usersTable } from "./db/schema";
import { eq, not } from "drizzle-orm";

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

const optOutCommand = new SlashCommandBuilder()
    .setName("opt-out")
    .setDescription("Toggle opting out of being imitated");

type CommandHandler = (
    interaction: ChatInputCommandInteraction,
) => Promise<void>;
const allCommands: {
    definition: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
    handler: CommandHandler;
}[] = [
    { definition: imitateCommand, handler: handleImitateCommand },
    { definition: optOutCommand, handler: handleOptOutCommand },
];

export async function register(client: Client<true>) {
    await Promise.all(
        client.guilds.cache
            .values()
            .flatMap((guild) =>
                allCommands.map(({ definition }) =>
                    guild.commands.create(definition),
                ),
            ),
    );
    console.log("Registered commands with all guilds");

    // Handle commands
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const dispatcher: Record<string, CommandHandler> = Object.fromEntries(
            allCommands.map(({ definition, handler }) => [
                definition.name,
                handler,
            ]),
        );

        const handler = dispatcher[interaction.commandName];
        if (!handler) {
            await interaction.reply({
                content: "⚠️ Error: unknown command",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await handler(interaction);
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

async function handleOptOutCommand(interaction: ChatInputCommandInteraction) {
    try {
        const result = await db
            .update(usersTable)
            .set({ optedOut: not(usersTable.optedOut) })
            .where(eq(usersTable.userId, interaction.user.id))
            .returning({ optedOut: usersTable.optedOut });
        const newValue = result[0]?.optedOut;
        if (newValue === undefined) {
            throw new Error("No rows updated");
        }
        console.log("User change opt-in status", {
            userId: interaction.user.id,
            optedOut: newValue,
        });
        await interaction.reply({
            content: `You are now opted ${newValue ? "out" : "in"}.`,
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        await interaction.reply({
            content: `⚠️ Error: ${error instanceof Error ? error.message : error}`,
            flags: MessageFlags.Ephemeral,
        });
    }
}
