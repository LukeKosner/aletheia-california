import { adminEmails } from "./auth";
/** Private-preview fallback only. No email is sent. Never log reporter text. */
export function logCorrectionNotification(correctionId: string): "private_log" {
    const recipients = adminEmails();
    if (!recipients)
        throw new Error("Both correction administrators must be configured");
    console.info("[private correction notification; email not sent]", { correctionId, recipients });
    return "private_log";
}
