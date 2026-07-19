import {
    ApplicationCommandType,
    ChatInputCommandInteraction,
    ContextMenuCommandBuilder,
    ContextMenuCommandInteraction,
    Events,
    InteractionContextType,
    MessageFlags,
    messageLink,
    MessagePayload,
    PermissionFlagsBits,
    SlashCommandBuilder,
    type Client,
    type InteractionReplyOptions,
    type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { handleImport } from "./import";
import { generateSentence, type CitedMessage } from "./predict";
import { db } from "./db";
import { usersTable } from "./db/schema";
import { eq, not } from "drizzle-orm";

const imitateCommand = new SlashCommandBuilder()
    .setName("imitate")
    .setDescription("Generate non-AI slop")
    .setContexts(InteractionContextType.Guild)
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
    .setDescription("Toggle opting out of being imitated")
    .setContexts(InteractionContextType.Guild);

const importHistoryCommand = new SlashCommandBuilder()
    .setName("import-history")
    .setDescription("Import historical messages for training")
    .setContexts(InteractionContextType.Guild)
    .addChannelOption((option) =>
        option
            .setName("channel")
            .setDescription(
                "Specific channel to import. If omitted, imports all public channels.",
            )
            .setRequired(false),
    )
    .addBooleanOption((option) =>
        option
            .setName("resume")
            .setDescription(
                "Resume from oldest message in database instead of starting from now (default: true)",
            )
            .setRequired(false),
    );

const citeCommand = new ContextMenuCommandBuilder()
    .setType(ApplicationCommandType.Message)
    .setName("Cite");

type SlashCommandHandler = (
    interaction: ChatInputCommandInteraction,
) => Promise<void>;
const slashCommands: {
    definition: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
    handler: SlashCommandHandler;
}[] = [
    { definition: imitateCommand, handler: handleImitateCommand },
    { definition: optOutCommand, handler: handleOptOutCommand },
    { definition: importHistoryCommand, handler: handleImportHistoryCommand },
];

type ContextMenuCommandHandler = (
    interaction: ContextMenuCommandInteraction,
) => Promise<void>;
const contextMenuCommands: {
    definition: ContextMenuCommandBuilder;
    handler: ContextMenuCommandHandler;
}[] = [{ definition: citeCommand, handler: handleCiteCommand }];

export async function register(client: Client<true>) {
    const definitions = [...slashCommands, ...contextMenuCommands].map(
        (cmd) => cmd.definition,
    );
    await client.application.commands.set(definitions);
    console.log("Registered commands globally");

    // Handle slash commands
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const dispatcher: Record<string, SlashCommandHandler> =
            Object.fromEntries(
                slashCommands.map(({ definition, handler }) => [
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

    // Handle context menu commands
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isContextMenuCommand()) return;

        const dispatcher: Record<string, ContextMenuCommandHandler> =
            Object.fromEntries(
                contextMenuCommands.map(({ definition, handler }) => [
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
        const generated = await generateSentence(
            prefix,
            interaction.guildId!,
            user?.id,
            channel?.id,
        );
        const response = await interaction.reply({
            content: generated.sentence,
            allowedMentions: { parse: [] },
            withResponse: true,
        });
        logCitations(response.resource!.message!.id, generated.citedMessages);
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

async function handleImportHistoryCommand(
    interaction: ChatInputCommandInteraction,
) {
    try {
        const channel = interaction.options.getChannel("channel");
        const resume = interaction.options.getBoolean("resume") ?? true;
        await handleImport(interaction, channel?.id ?? null, resume);
    } catch (error) {
        const content: InteractionReplyOptions = {
            content: `⚠️ Error: ${error instanceof Error ? error.message : error}`,
            flags: [MessageFlags.Ephemeral],
        };
        if (interaction.replied) {
            await interaction.followUp(content);
        } else {
            await interaction.reply(content);
        }
    }
}

const MAX_CITATIONS = 100;
const citations = new Map<string, CitedMessage[]>();

function logCitations(messageId: string, citedMessages: CitedMessage[]) {
    if (citations.size >= MAX_CITATIONS) {
        const oldest = citations.keys().next().value!;
        citations.delete(oldest);
    }
    citations.set(messageId, citedMessages);
}

async function handleCiteCommand(interaction: ContextMenuCommandInteraction) {
    try {
        if (!interaction.isMessageContextMenuCommand())
            throw new Error("borken :(");
        if (interaction.targetMessage.author.id !== interaction.client.user.id)
            throw new Error("I can only site messages sent by me");
        const messageId = interaction.targetMessage.id;
        const citation = citations.get(messageId);
        if (citation === undefined) throw new Error("Message is too old");
        const lines = citation.map(
            ({ guildId, channelId, messageId, token }) =>
                `- ${token}: ${messageLink(channelId, messageId, guildId)}`,
        );
        const chunks = [`Cited ${citation.length} messages:`];
        for (const line of lines) {
            let lastChunk = chunks.at(-1)!;
            if (lastChunk.length + line.length + 1 <= 2000) {
                lastChunk += "\n" + line;
                chunks[chunks.length - 1] = lastChunk;
            } else {
                chunks.push(line);
            }
        }
        for (const [i, chunk] of chunks.entries()) {
            await (i === 0 ? interaction.reply : interaction.followUp).call(
                interaction,
                {
                    content: chunk,
                },
            );
        }
    } catch (error) {
        await interaction.reply({
            content: `⚠️ Error: ${error instanceof Error ? error.message : error}`,
            flags: MessageFlags.Ephemeral,
        });
    }
}
