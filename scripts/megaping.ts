import { Client, Events, GatewayIntentBits, userMention } from "discord.js";

const client = new Client({
    intents: [
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
    ],
});

client.once(Events.ClientReady, async (client) => {
    try {
        const channel = await client.channels.fetch("1511495960524488847");
        if (!channel?.isSendable()) throw new Error("not sendable");
        for (let i = 0; i < 100; i++) {
            channel.send({
                content: userMention("184021694225186816"),
                allowedMentions: { parse: ["users"] },
            });
        }
    } finally {
        client.destroy();
    }
});

client.login(Bun.env.DISCORD_BOT_TOKEN);
