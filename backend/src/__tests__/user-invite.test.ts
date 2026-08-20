import { describe, expect, it } from "vitest";
import { buildUserInviteEmail } from "../mail/templates/userInvite";

const inviteUrl = "https://draw.example.com/reset-password-confirm?token=abc123";
const instanceUrl = "https://draw.example.com";

describe("user invitation email", () => {
  it("carries the link in both parts", () => {
    const mail = buildUserInviteEmail({ inviteUrl, instanceUrl, expiresInDays: 7 });

    expect(mail.text).toContain(inviteUrl);
    expect(mail.html).toContain(inviteUrl);
  });

  it("never contains a password", () => {
    const mail = buildUserInviteEmail({ inviteUrl, instanceUrl, expiresInDays: 7 });

    // The whole point of the link: credentials must not sit in a mailbox.
    expect(mail.text.toLowerCase()).not.toMatch(/your password is|temporary password/);
    expect(mail.html.toLowerCase()).not.toMatch(/your password is|temporary password/);
  });

  it("names the instance so the recipient can judge the mail", () => {
    const mail = buildUserInviteEmail({ inviteUrl, instanceUrl, expiresInDays: 7 });

    expect(mail.text).toContain(instanceUrl);
  });

  it("states the validity period", () => {
    const mail = buildUserInviteEmail({ inviteUrl, instanceUrl, expiresInDays: 3 });

    expect(mail.text).toContain("3 days");
    expect(mail.html).toContain("3 days");
  });

  it("escapes a crafted link", () => {
    const hostile = 'https://x.test/?t="><script>alert(1)</script>';
    const mail = buildUserInviteEmail({
      inviteUrl: hostile,
      instanceUrl,
      expiresInDays: 7,
    });

    expect(mail.html).not.toContain("<script>");
  });
});
