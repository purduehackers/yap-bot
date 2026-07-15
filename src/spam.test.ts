import { expect, test, describe } from "bun:test";
import { SpamDetector, type MessageData, type SpamAction } from "./spam";

// Helper to stringify actions for our Jane Street style expect tests.
// We replace the signature BigInt with a static string so JSON.stringify
// doesn't throw and the output is deterministic.
function actionToString(action: SpamAction): string {
    return JSON.stringify(action, (_, v) =>
        typeof v === "bigint" ? "<signature>" : v,
    );
}

function expectAlert(action: SpamAction, expectedContent: string) {
    expect(action.do).toBe("alert");
    if (action.do !== "alert") throw new Error("unreachable");
    expect(action.alertContent).toBe(expectedContent);
}

describe("SpamDetector (Jane Street Style Expect Tests)", () => {
    // Helper to generate a generic message
    const makeMsg = (
        authorId: string,
        channelId: string,
        content: string,
        timeOffsetMs: number = 0,
        attachments: { size: number; contentType: string | null }[] = [],
    ): MessageData => ({
        authorId,
        channelId,
        content,
        createdAt: new Date(Date.now() + timeOffsetMs),
        url: `https://discord.com/${channelId}`,
        attachments,
    });

    test("1. Core Detection: Threshold Crossed", () => {
        const detector = new SpamDetector();
        let action: SpamAction;

        action = detector.processMessage(makeMsg("user1", "chan1", "spam"));
        expect(actionToString(action)).toBe(`{"do":"nothing"}`);

        action = detector.processMessage(makeMsg("user1", "chan2", "spam"));
        expect(actionToString(action)).toBe(`{"do":"nothing"}`);

        action = detector.processMessage(makeMsg("user1", "chan3", "spam"));
        expect(actionToString(action)).toBe(`{"do":"nothing"}`);

        action = detector.processMessage(makeMsg("user1", "chan4", "spam"));
        expectAlert(
            action,
            `\
# Likely spammer
- https://discord.com/chan1
- https://discord.com/chan2
- https://discord.com/chan3
- https://discord.com/chan4

-# False alarm? Please ping Kian to let him know.`,
        );
    });

    test("2. Channel & Count Variations: Same Channel Spam", () => {
        const detector = new SpamDetector();
        for (let i = 0; i < 5; i++) {
            const action = detector.processMessage(
                makeMsg("user1", "same-chan", "spam"),
            );
            expect(actionToString(action)).toBe(`{"do":"nothing"}`);
        }
    });

    test("2. Channel & Count Variations: Continued Spamming", () => {
        const detector = new SpamDetector();
        detector.processMessage(makeMsg("user1", "chan1", "spam"));
        detector.processMessage(makeMsg("user1", "chan2", "spam"));
        detector.processMessage(makeMsg("user1", "chan3", "spam"));

        // 4th message crosses threshold
        let action = detector.processMessage(makeMsg("user1", "chan4", "spam"));
        expectAlert(
            action,
            `\
# Likely spammer
- https://discord.com/chan1
- https://discord.com/chan2
- https://discord.com/chan3
- https://discord.com/chan4

-# False alarm? Please ping Kian to let him know.`,
        );

        // 5th message appends to the alert
        action = detector.processMessage(makeMsg("user1", "chan5", "spam"));
        expectAlert(
            action,
            `\
# Likely spammer
- https://discord.com/chan1
- https://discord.com/chan2
- https://discord.com/chan3
- https://discord.com/chan4
- https://discord.com/chan5

-# False alarm? Please ping Kian to let him know.`,
        );
    });

    test("3. Time Constraints: Sliding Window Expiry", () => {
        const detector = new SpamDetector();

        // Send 3 messages way in the past (3 minutes ago)
        const past = -3 * 60 * 1000;
        detector.processMessage(makeMsg("user1", "chan1", "spam", past));
        detector.processMessage(makeMsg("user1", "chan2", "spam", past));
        detector.processMessage(makeMsg("user1", "chan3", "spam", past));

        // Send 4th message now
        const action = detector.processMessage(
            makeMsg("user1", "chan4", "spam", 0),
        );

        // Because the first 3 expired, this counts as message #1 again.
        expect(actionToString(action)).toBe(`{"do":"nothing"}`);
    });

    test("4. The Strict Rule: Mixed Content Interrupts Spam", () => {
        const detector = new SpamDetector();
        detector.processMessage(makeMsg("user1", "chan1", "spam"));
        detector.processMessage(makeMsg("user1", "chan2", "spam"));
        detector.processMessage(makeMsg("user1", "chan3", "spam"));

        // Interrupt with normal message
        detector.processMessage(makeMsg("user1", "chan4", "hello guys"));

        // 4th spam message
        const action = detector.processMessage(
            makeMsg("user1", "chan5", "spam"),
        );

        expect(actionToString(action)).toBe(`{"do":"nothing"}`);
    });

    test("5. Signature Hashing: Different Image Sizes", () => {
        const detector = new SpamDetector();
        const imgA = [{ size: 100, contentType: "image/png" }];
        const imgB = [{ size: 999, contentType: "image/png" }];

        detector.processMessage(makeMsg("user1", "chan1", "look", 0, imgA));
        detector.processMessage(makeMsg("user1", "chan2", "look", 0, imgA));
        detector.processMessage(makeMsg("user1", "chan3", "look", 0, imgA));

        // 4th message has different image
        const action = detector.processMessage(
            makeMsg("user1", "chan4", "look", 0, imgB),
        );

        expect(actionToString(action)).toBe(`{"do":"nothing"}`);
    });

    test("6. Isolation: Different Users", () => {
        const detector = new SpamDetector();
        detector.processMessage(makeMsg("userA", "chan1", "spam"));
        detector.processMessage(makeMsg("userA", "chan2", "spam"));

        detector.processMessage(makeMsg("userB", "chan3", "spam"));
        const action = detector.processMessage(
            makeMsg("userB", "chan4", "spam"),
        );

        expect(actionToString(action)).toBe(`{"do":"nothing"}`);
    });
});
