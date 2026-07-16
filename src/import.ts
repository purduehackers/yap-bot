import {
    type ChatInputCommandInteraction,
    ChannelType,
    PermissionFlagsBits,
    type GuildBasedChannel,
    type Message as DiscordMessage,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    type AnyThreadChannel,
    MessageFlags,
    channelMention,
    type GuildTextBasedChannel,
} from "discord.js";
import { db } from "@/db";
import { messagesTable, usersTable, guildsTable } from "./db/schema";
import { addMessageToMarkov4 } from "./train";
import { inArray, min, eq } from "drizzle-orm";

const ALLOWED_USER_ID = "753840846549418024";

export function isChannelEligibleForImport(
    channel: GuildBasedChannel,
): boolean {
    if (!channel.isTextBased()) return false;

    // If it's a thread, make sure it is a public thread
    if (channel.isThread()) {
        if (
            channel.type !== ChannelType.PublicThread &&
            channel.type !== ChannelType.AnnouncementThread
        ) {
            return false;
        }
    }

    // Must be a channel where everyone can view and read history
    const everyonePerms = channel.permissionsFor(channel.guild.roles.everyone);
    if (!everyonePerms) return false;
    if (
        !everyonePerms.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
        ])
    ) {
        return false;
    }

    // Bot must have access to view and read history
    const botMember = channel.guild.members.me;
    if (!botMember) return false;
    const botPerms = channel.permissionsFor(botMember);
    if (!botPerms) return false;
    if (
        !botPerms.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
        ])
    ) {
        return false;
    }

    return true;
}

async function fetchArchivedThreadsForChannel(
    channel: GuildBasedChannel,
): Promise<AnyThreadChannel[]> {
    if (!("threads" in channel)) return [];

    const threads: AnyThreadChannel[] = [];
    let oldestThreadId: string | undefined = undefined;

    while (true) {
        const archived: any = await channel.threads.fetchArchived({
            type: "public",
            before: oldestThreadId,
        });
        if (archived.threads.size === 0) break;
        const batch = Array.from(
            archived.threads.values(),
        ) as AnyThreadChannel[];
        threads.push(...batch);

        const oldestThread = batch.at(-1)!;
        oldestThreadId = oldestThread.id;

        if (!archived.hasMore) break;
    }
    return threads;
}

interface ImportState {
    isCanceled: boolean;
    totalImported: number;
    oldestDateInCurrentChannel: Date | null;
}

async function importChannelMessages(
    channel: GuildTextBasedChannel,
    guildId: string,
    resume: boolean,
    state: ImportState,
): Promise<void> {
    let oldestMessageId: string | undefined = undefined;
    if (resume) {
        const dbResult = await db
            .select({ id: min(messagesTable.messageId) })
            .from(messagesTable)
            .where(eq(messagesTable.channelId, channel.id));
        oldestMessageId = dbResult[0]?.id ?? undefined;
    }

    while (true) {
        if (state.isCanceled) break;

        // Fetch batch of messages
        // Note: fetch() will throw if the channel becomes inaccessible during run
        const messagesCollection = await channel.messages.fetch({
            limit: 100,
            before: oldestMessageId,
        });
        if (messagesCollection.size === 0) {
            break;
        }
        const messageArray = Array.from(messagesCollection.values());
        const oldestMsg = messageArray.at(-1)!;
        oldestMessageId = oldestMsg.id;
        state.oldestDateInCurrentChannel = oldestMsg.createdAt;

        // Process batch
        const newImported = await processBatch(messageArray, guildId);
        state.totalImported += newImported;

        // If we fetched fewer messages than requested, we reached the start of the channel
        if (messagesCollection.size < 100) {
            break;
        }
    }
}

export async function handleImport(
    interaction: ChatInputCommandInteraction,
    targetChannelId: string | null,
    resume: boolean,
) {
    if (interaction.user.id !== ALLOWED_USER_ID) {
        await interaction.reply({
            content: "🚫 You are not authorized to run this command.",
            ephemeral: true,
        });
        return;
    }

    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({
            content: "🚫 This command can only be used in a server.",
            ephemeral: true,
        });
        return;
    }

    // Register guild just in case
    await db
        .insert(guildsTable)
        .values({ guildId: guild.id })
        .onConflictDoNothing();

    // Create Cancel button
    const cancelButton = new ButtonBuilder()
        .setCustomId("cancel_import")
        .setLabel("Cancel Import")
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        cancelButton,
    );

    // Send an initial response immediately to prevent the 3-second interaction timeout
    const progressMessage = (
        await interaction.reply({
            content: `⏳ Gathering channels and threads...`,
            components: [row],
            withResponse: true,
        })
    ).resource!.message!;

    // Determine channels to import
    let channels: GuildBasedChannel[] = [];
    try {
        if (targetChannelId) {
            const channel = await guild.channels.fetch(targetChannelId);
            if (!channel) {
                await interaction.editReply({
                    content: "⚠️ Error: Specified channel not found.",
                    components: [],
                });
                return;
            }
            if (!isChannelEligibleForImport(channel)) {
                await interaction.editReply({
                    content:
                        "⚠️ Error: Bot does not have read permissions for the specified channel, or it is not public.",
                    components: [],
                });
                return;
            }
            channels.push(channel);

            // Fetch active threads for this channel
            const eligibleActiveThreads = (
                await guild.channels.fetchActiveThreads()
            ).threads
                .values()
                .filter(
                    (t) =>
                        t.parentId === channel.id &&
                        isChannelEligibleForImport(t),
                );
            channels.push(...eligibleActiveThreads);

            // Fetch archived threads for this channel
            const archivedThreads =
                await fetchArchivedThreadsForChannel(channel);
            const eligibleArchived = archivedThreads.filter(
                isChannelEligibleForImport,
            );
            channels.push(...eligibleArchived);
        } else {
            // Fetch all channels
            const allChannels = await guild.channels.fetch();
            const baseChannels = Array.from(allChannels.values())
                .filter((c) => c !== null)
                .filter(isChannelEligibleForImport);
            channels.push(...baseChannels);

            // Fetch active threads for all channels in the guild
            const eligibleActiveThreads = (
                await guild.channels.fetchActiveThreads()
            ).threads
                .values()
                .filter(isChannelEligibleForImport);
            channels.push(...eligibleActiveThreads);

            // Fetch archived threads for all base channels
            for (const baseChannel of baseChannels) {
                const archived =
                    await fetchArchivedThreadsForChannel(baseChannel);
                const eligibleArchived = archived.filter(
                    isChannelEligibleForImport,
                );
                channels.push(...eligibleArchived);
            }
        }
    } catch (err) {
        console.error("Failed to gather channels/threads:", err);
        await interaction.editReply({
            content: `❌ **Failed to gather channels or threads:** ${err instanceof Error ? err.message : String(err)}`,
            components: [],
        });
        return;
    }

    // Ensure unique channels
    channels = Array.from(new Set(channels));

    if (channels.length === 0) {
        await interaction.editReply({
            content:
                "⚠️ Error: No eligible channels or threads found for import.",
            components: [],
        });
        return;
    }

    // Update the message once gathering completes
    await progressMessage.edit({
        content: `⏳ Starting import across ${channels.length} channels & threads...`,
        components: [row],
    });

    // Setup stats state
    let channelsDone = 0;
    const totalChannels = channels.length;
    let currentChannelId = "";
    let status: "running" | "completed" | "failed" = "running";
    let errorMessage = "";

    const importState: ImportState = {
        isCanceled: false,
        totalImported: 0,
        oldestDateInCurrentChannel: null,
    };

    // Keep track of whether stats changed so we don't spam edit
    let lastUpdatedStatsText = "";

    const generateProgressText = () => {
        if (status === "completed") {
            return `✅ **Import Completed!**\n- Total new messages imported/processed: ${importState.totalImported}\n- Channels processed: ${channelsDone}/${totalChannels}`;
        }
        if (status === "failed") {
            return `❌ **Import Failed!**\n- Error: ${errorMessage}\n- Messages imported before failure: ${importState.totalImported}\n- Channels processed: ${channelsDone}/${totalChannels}`;
        }
        return (
            `⏳ **Importing Historical Messages...**\n` +
            `- **Messages imported:** ${importState.totalImported}\n` +
            `- **Channels progress:** ${channelsDone}/${totalChannels} done\n` +
            (currentChannelId
                ? `- **Current channel:** ${channelMention(currentChannelId)}\n`
                : "") +
            (importState.oldestDateInCurrentChannel
                ? `- **Oldest date processed (current channel):** ${importState.oldestDateInCurrentChannel.toLocaleDateString("en-US")}`
                : "")
        );
    };

    // Handle cancel button interaction asynchronously
    progressMessage
        .awaitMessageComponent({
            componentType: ComponentType.Button,
            time: 24 * 60 * 60 * 1000, // 24 hours
        })
        .then(async (btnInteraction) => {
            if (btnInteraction.customId === "cancel_import") {
                if (btnInteraction.user.id !== ALLOWED_USER_ID) {
                    await btnInteraction.reply({
                        content:
                            "⚠️ Error: You are not authorized to cancel this import.",
                        flags: [MessageFlags.Ephemeral],
                    });
                    return;
                }

                importState.isCanceled = true;
                status = "failed";
                errorMessage = "Import was canceled by the owner.";

                await btnInteraction.reply({
                    content:
                        "🛑 Cancellation request received. Stopping import...",
                    flags: [MessageFlags.Ephemeral],
                });
            }
        });

    // Update progress message every 3 seconds if stats have changed
    const progressInterval = setInterval(async () => {
        const text = generateProgressText();
        if (text !== lastUpdatedStatsText) {
            try {
                await progressMessage.edit({
                    content: text,
                    components: status === "running" ? [row] : [],
                });
                lastUpdatedStatsText = text;
            } catch (err) {
                console.error("Failed to edit progress message:", err);
            }
        }
    }, 3000);

    try {
        for (const channel of channels) {
            if (importState.isCanceled) break;
            currentChannelId = channel.id;
            importState.oldestDateInCurrentChannel = null;
            if (channel.isTextBased()) {
                await importChannelMessages(
                    channel,
                    guild.id,
                    resume,
                    importState,
                );
            }
            channelsDone++;
        }

        if (!importState.isCanceled) {
            status = "completed";
        }
    } catch (error) {
        console.error("Error during historical import:", error);
        status = "failed";
        errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
        clearInterval(progressInterval);
        // One final edit to reflect completed/failed status and clear components
        try {
            await progressMessage.edit({
                content: generateProgressText(),
                components: [],
            });
        } catch (err) {
            console.error(
                "Failed to perform final edit on progress message:",
                err,
            );
        }
    }
}

async function processBatch(
    messages: DiscordMessage[],
    guildId: string,
): Promise<number> {
    if (messages.length === 0) return 0;

    const messageIds = messages.map((m) => m.id);

    // Get list of existing messages to avoid duplicates
    const existingRows = await db
        .select({ messageId: messagesTable.messageId })
        .from(messagesTable)
        .where(inArray(messagesTable.messageId, messageIds));
    const existingIds = new Set(existingRows.map((r) => r.messageId));

    const newMessages = messages.filter((m) => !existingIds.has(m.id));
    if (newMessages.length === 0) return 0;

    // Register all unique authors first
    const uniqueUsers: Map<
        string,
        { userId: string; username: string; isBot: boolean }
    > = new Map();
    for (const msg of newMessages) {
        if (!uniqueUsers.has(msg.author.id)) {
            uniqueUsers.set(msg.author.id, {
                userId: msg.author.id,
                username: msg.author.username,
                isBot: msg.author.bot,
            });
        }
    }

    await db.transaction(async (tx) => {
        // Insert users
        if (uniqueUsers.size > 0) {
            await tx
                .insert(usersTable)
                .values(Array.from(uniqueUsers.values()))
                .onConflictDoNothing();
        }

        // Insert messages
        const messageRows = newMessages.map((msg) => ({
            messageId: msg.id,
            userId: msg.author.id,
            guildId: guildId,
            channelId: msg.channelId,
            timestamp: msg.createdAt.toISOString(),
            content: msg.content,
        }));

        await tx
            .insert(messagesTable)
            .values(messageRows)
            .onConflictDoNothing();

        // Train Markov
        for (const msg of newMessages) {
            await addMessageToMarkov4(msg, tx);
        }
    });

    return newMessages.length;
}
