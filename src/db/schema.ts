import { sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core";

export const guildsTable = sqliteTable("guilds", {
    guildId: text().primaryKey(),
});

export const usersTable = sqliteTable("users", {
    userId: text().primaryKey(),
    username: text().notNull(),
});

export const messagesTable = sqliteTable("messages", {
    messageId: text().primaryKey(),
    userId: text().references(() => usersTable.userId),
    guildId: text().references(() => guildsTable.guildId),
    channelId: text().notNull(),
    timestamp: text().notNull(),
    content: text().notNull(),
});

export const markov4Table = sqliteTable("markov4", {
    messageId: text().references(() => messagesTable.messageId),
    word1: text(),
    word2: text(),
    word3: text(),
    word4: text(),
    word5: text(),
});
