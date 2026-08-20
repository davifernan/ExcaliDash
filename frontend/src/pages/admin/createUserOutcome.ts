import type { AdminUser } from "./types";

export type CreateUserResponse = {
  user: AdminUser;
  invited?: boolean;
  invitationError?: string | null;
  temporaryPassword?: string | null;
};

export const getCreateUserOutcome = (response: CreateUserResponse) => {
  if (response.invited) {
    return { success: "User created — invitation sent", error: null, temporaryPassword: null };
  }
  if (response.invitationError) {
    const recovery = response.temporaryPassword
      ? "Use the temporary password shown now, or generate a new one from the user list."
      : "Generate a temporary password from the user list and pass it on securely.";
    return {
      success: null,
      error: `User created, but the invitation failed. ${response.invitationError} ${recovery}`,
      temporaryPassword: response.temporaryPassword ?? null,
    };
  }
  return { success: "User created", error: null, temporaryPassword: null };
};
