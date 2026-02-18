import { Client, GatewayIntentBits } from "discord.js";
import { env } from "@/env";
import { register as registerTracking } from "@/track";
import { register as registerCommands } from "@/commands";

const client = new Client({
    intents: [
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
    ],
});

client.once("clientReady", async (client) => {
    await client.user.setUsername(env.NICKNAME);
    console.log(`Logged in as ${client.user.displayName}`);

    [registerTracking, registerCommands].forEach((f) => f(client));
});

// For some reason, the program doesn't seem to stop when it gets a signal
// unless we handle it explicitly.
const signalHandler: NodeJS.SignalsListener = (signal) => {
    console.warn("Received signal; exiting...", { signal });
    process.exit();
};
process.on("SIGINT", signalHandler);
process.on("SIGTERM", signalHandler);
process.on("exit", () => {
    client.destroy();
    console.log("Client destroyed");
});

client.login(env.DISCORD_BOT_TOKEN);
