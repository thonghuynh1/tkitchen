export interface MeUser {
  id: string;
  login: string;
  isOwner: boolean;
}

export type MeResponse = { ok: true; user: MeUser } | { ok: false; error: "unauthorized" };
