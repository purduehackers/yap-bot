import { db } from "@/db";
import { messagesTable, usersTable } from "@/db/schema";
import { env } from "@/env";
import {
    Client,
    Collection,
    Events,
    GatewayIntentBits,
    Guild,
    Message,
    PermissionFlagsBits,
    type GuildTextBasedChannel,
} from "discord.js";

let totalMessageCounter = 0;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once(Events.ClientReady, async (client) => {
    const promise = Promise.all(
        client.guilds.cache.map(fetchAllMessagesInGuild),
    );
    const timer = setInterval(() => {
        console.log(`Total messages fetched: ${totalMessageCounter}`);
    }, 1000);
    await promise;
    clearInterval(timer);
});

client.login(env.DISCORD_BOT_TOKEN);

async function fetchAllMessagesInGuild(guild: Guild) {
    await Promise.all([
        guild.channels.fetch(),
        guild.channels.fetchActiveThreads(),
    ]);

    await Promise.all(
        guild.channels.cache
            .filter((channel) => channel.isTextBased() && !channel.isDMBased())
            .filter((channel) =>
                channel
                    .permissionsFor(guild.client.user)
                    ?.has(
                        PermissionFlagsBits.ViewChannel |
                            PermissionFlagsBits.ReadMessageHistory,
                    ),
            )
            .map(fetchAllMessagesInChannel),
    );
}

async function fetchAllMessagesInChannel(channel: GuildTextBasedChannel) {
    let oldestMessageId: string | undefined = undefined;
    try {
        while (true) {
            const result: Collection<
                string,
                Message<true>
            > = await channel.messages.fetch({
                limit: 100,
                before: oldestMessageId,
            });
            if (result.size === 0) break;
            totalMessageCounter += result.size;
            await db
                .insert(messagesTable)
                .values(
                    result
                        .values()
                        .map((message) => ({
                            messageId: message.id,
                            userId: message.author.id,
                            guildId: message.guildId,
                            channelId: message.channelId,
                            content: message.content,
                            timestamp: message.createdAt.toISOString(),
                        }))
                        .toArray(),
                )
                .onConflictDoNothing();
            await db
                .insert(usersTable)
                .values(
                    result
                        .values()
                        .map(
                            (message) =>
                                ({
                                    userId: message.author.id,
                                    username: message.author.username,
                                    isBot: message.author.bot,
                                }) satisfies typeof usersTable.$inferInsert,
                        )
                        .toArray(),
                )
                .onConflictDoNothing();
            oldestMessageId = result.last()?.id;
        }
    } catch (error) {
        console.warn(`Ignoring error in channel ${channel.name}:`, error);
    }
}
