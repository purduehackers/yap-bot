import { Events, type Client } from "discord.js";
import { db } from "@/db";
import { messagesTable, usersTable } from "./db/schema";
import { eq } from "drizzle-orm";

export async function register(client: Client<true>) {
    // Insert existing guild member users into the database
    const allUsers = (
        await Promise.all(
            client.guilds.cache.map((guild) =>
                guild.members
                    .fetch()
                    .then((members) => members.values().toArray()),
            ),
        )
    )
        .flat()
        .map((member) => member.user);
    await db
        .insert(usersTable)
        .values(
            allUsers.map((user) => ({
                userId: user.id,
                username: user.username,
            })),
        )
        .onConflictDoNothing();
    console.log("Guild users added/updated");

    // Add new members
    client.on(Events.GuildMemberAdd, async (member) => {
        const user: typeof usersTable.$inferInsert = {
            userId: member.user.id,
            username: member.user.username,
        };
        await db.insert(usersTable).values(user).onConflictDoNothing();
        console.log("Guild user added", user);
    });

    // Update usernames
    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        if (oldMember.id !== newMember.id)
            throw new Error("Expected old and new member to have same ID");
        await db
            .update(usersTable)
            .set({ username: newMember.user.username })
            .where(eq(usersTable.userId, oldMember.user.id));
        console.log("Guild user updated", {
            userId: newMember.user.id,
            oldUsername: oldMember.user.username,
            newUsername: newMember.user.username,
        });
    });

    // Log new messages
    client.on(Events.MessageCreate, async (message) => {
        const messageRow: typeof messagesTable.$inferInsert = {
            messageId: message.id,
            userId: message.author.id,
            guildId: message.guildId,
            channelId: message.channelId,
            timestamp: message.createdAt.toISOString(),
            content: message.content,
        };
        await db.insert(messagesTable).values(messageRow);
        console.log("Message created", messageRow);
    });

    // Update content on message edits
    client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
        if (oldMessage.id !== newMessage.id)
            throw new Error("Expected old and new message to have same ID");
        await db
            .update(messagesTable)
            .set({ content: newMessage.content })
            .where(eq(messagesTable.messageId, oldMessage.id));
        console.log("Message updated", {
            messageId: newMessage.id,
            oldContent: oldMessage.content,
            newContent: newMessage.content,
        });
    });

    // Delete deleted messages
    client.on(Events.MessageDelete, async (message) => {
        await db
            .delete(messagesTable)
            .where(eq(messagesTable.messageId, message.id));
        console.log("Message deleted", { messsageId: message.id });
    });

    console.debug("Tracking event handlers established");
}
