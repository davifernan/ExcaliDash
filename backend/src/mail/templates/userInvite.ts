export type UserInviteMailInput = {
  inviteUrl: string;
  /** Named so the recipient can tell a real invitation from a phishing mail. */
  instanceUrl: string;
  expiresInDays: number;
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Invitation for an account an administrator created.
 *
 * Deliberately carries no password: a mailbox keeps its contents for years,
 * and a password sent this way stays readable to anyone who ever gains access
 * to it. The recipient sets their own instead, through a single-use link.
 */
export const buildUserInviteEmail = ({
  inviteUrl,
  instanceUrl,
  expiresInDays,
}: UserInviteMailInput) => {
  const safeUrl = escapeHtml(inviteUrl);
  const safeInstance = escapeHtml(instanceUrl);

  const text = [
    `An ExcaliDash account was created for you at ${instanceUrl}`,
    "",
    "Open this link to choose your password:",
    inviteUrl,
    "",
    `The link is valid for ${expiresInDays} days and can be used once.`,
    "If you were not expecting this, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1e1e1e;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;">Your ExcaliDash account is ready</h1>
      <p style="margin:0 0 24px;line-height:1.5;">
        An administrator created an account for you at
        <a href="${safeInstance}" style="color:#1971c2;">${safeInstance}</a>.
        Choose a password to finish setting it up.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#1e1e1e;color:#ffffff;text-decoration:none;border-radius:6px;">Choose your password</a>
      </p>
      <p style="margin:0 0 24px;line-height:1.5;font-size:14px;color:#868e96;">
        The link is valid for ${expiresInDays} days and can be used once.
        If the button does not work, copy this address into your browser:<br />
        <span style="word-break:break-all;">${safeUrl}</span>
      </p>
      <p style="margin:0;line-height:1.5;font-size:14px;color:#868e96;">
        If you were not expecting this, you can ignore this email.
      </p>
    </div>
  </body>
</html>`;

  return { subject: "Your ExcaliDash account is ready", text, html };
};
