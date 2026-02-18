import { eq, getTableColumns, not } from "drizzle-orm";
import {
    sqliteTable,
    text,
    index,
    integer,
    sqliteView,
} from "drizzle-orm/sqlite-core";

export const guildsTable = sqliteTable("guilds", {
    guildId: text().primaryKey(),
});

export const usersTable = sqliteTable("users", {
    userId: text().primaryKey(),
    username: text().notNull(),
    optedOut: integer({ mode: "boolean" }).default(false).notNull(),
});

export const messagesTable = sqliteTable(
    "messages",
    {
        messageId: text().primaryKey(),
        userId: text().references(() => usersTable.userId),
        guildId: text().references(() => guildsTable.guildId),
        channelId: text().notNull(),
        timestamp: text().notNull(),
        content: text().notNull(),
    },
    (table) => [
        index("messages_guildId").on(table.guildId),
        index("messages_guildId_userId_idx").on(table.guildId, table.userId),
        index("messages_channelId_idx").on(table.channelId),
    ],
);

export const markov4Table = sqliteTable(
    "markov4",
    {
        messageId: text().references(() => messagesTable.messageId),
        word1: text(),
        word2: text(),
        word3: text(),
        word4: text(),
        word5: text(),
    },
    (table) => [
        index("markov4_messageId_idx").on(table.messageId),
        index("markov4_prefix_idx").on(
            table.word1,
            table.word2,
            table.word3,
            table.word4,
        ),
    ],
);

// Messages from users who have not opted out
export const messagesView = sqliteView("messages_view").as((qb) =>
    qb
        .select(getTableColumns(messagesTable))
        .from(messagesTable)
        .innerJoin(usersTable, eq(messagesTable.userId, usersTable.userId))
        .where(not(usersTable.optedOut)),
);
