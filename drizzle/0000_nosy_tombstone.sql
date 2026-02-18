CREATE TABLE `guilds` (
	`guildId` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `markov4` (
	`messageId` text,
	`word1` text,
	`word2` text,
	`word3` text,
	`word4` text,
	`word5` text,
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`messageId`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `markov4_messageId_idx` ON `markov4` (`messageId`);--> statement-breakpoint
CREATE INDEX `markov4_prefix_idx` ON `markov4` (`word1`,`word2`,`word3`,`word4`);--> statement-breakpoint
CREATE TABLE `messages` (
	`messageId` text PRIMARY KEY NOT NULL,
	`userId` text,
	`guildId` text,
	`channelId` text NOT NULL,
	`timestamp` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`userId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guildId`) REFERENCES `guilds`(`guildId`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_guildId` ON `messages` (`guildId`);--> statement-breakpoint
CREATE INDEX `messages_guildId_userId_idx` ON `messages` (`guildId`,`userId`);--> statement-breakpoint
CREATE INDEX `messages_channelId_idx` ON `messages` (`channelId`);--> statement-breakpoint
CREATE TABLE `users` (
	`userId` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`optedOut` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE VIEW `messages_view` AS select "messages"."messageId", "messages"."userId", "messages"."guildId", "messages"."channelId", "messages"."timestamp", "messages"."content" from "messages" inner join "users" on "messages"."userId" = "users"."userId" where not "users"."optedOut";