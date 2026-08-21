import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CollectionTeamBar } from "./CollectionTeamBar";

const getCollectionMembers = vi.fn();

vi.mock("../../api", () => ({
  getCollectionMembers: (...args: unknown[]) => getCollectionMembers(...args),
  isAxiosError: () => false,
}));

vi.mock("../../components/ShareCollectionModal", () => ({
  ShareCollectionModal: () => null,
}));

const member = (name: string, role: string, key: string) => ({
  subjectKey: key,
  name,
  initials: name.slice(0, 2).toUpperCase(),
  color: "#3b82f6",
  role,
  isSelf: false,
});

describe("CollectionTeamBar", () => {
  beforeEach(() => {
    getCollectionMembers.mockReset();
  });

  it("says who a shared collection belongs to and what you may do in it", async () => {
    getCollectionMembers.mockResolvedValue({
      totalCount: 2,
      members: [member("Owner Olga", "owner", "k1"), member("Member Max", "editor", "k2")],
    });

    render(
      <CollectionTeamBar
        collection={{
          id: "c1",
          name: "Roadmap",
          createdAt: 0,
          isOwner: false,
          sharedRole: "edit",
        }}
      />,
    );

    expect(await screen.findByText("2 people in this collection")).toBeTruthy();
    expect(screen.getByText(/Shared by Owner Olga/)).toBeTruthy();
    expect(screen.getByText(/You can edit/)).toBeTruthy();
  });

  it("stays out of the way of a collection that is only yours", async () => {
    getCollectionMembers.mockResolvedValue({
      totalCount: 1,
      members: [member("Owner Olga", "owner", "k1")],
    });

    render(
      <CollectionTeamBar collection={{ id: "c1", name: "Private", createdAt: 0, isOwner: true }} />,
    );

    await waitFor(() => expect(getCollectionMembers).toHaveBeenCalled());
    expect(screen.queryByTestId("collection-team-bar")).toBeNull();
  });

  it("does not claim anyone is away before it knows who is here", async () => {
    getCollectionMembers.mockResolvedValue({
      totalCount: 2,
      members: [member("Owner Olga", "owner", "k1"), member("Member Max", "editor", "k2")],
    });

    render(
      <CollectionTeamBar
        collection={{ id: "c1", name: "Roadmap", createdAt: 0, isOwner: true, isShared: true }}
      />,
    );

    const avatars = await screen.findAllByTestId("member-avatar");
    expect(avatars).toHaveLength(2);
    for (const avatar of avatars) {
      expect(avatar.className).not.toContain("opacity-40");
      expect(avatar.getAttribute("data-online")).toBe("false");
    }
  });

  it("dims the people who are not on the board once presence is known", async () => {
    getCollectionMembers.mockResolvedValue({
      totalCount: 2,
      members: [member("Owner Olga", "owner", "k1"), member("Member Max", "editor", "k2")],
    });

    render(
      <CollectionTeamBar
        collection={{ id: "c1", name: "Roadmap", createdAt: 0, isOwner: true, isShared: true }}
        onlineKeys={new Set(["k1"])}
      />,
    );

    const avatars = await screen.findAllByTestId("member-avatar");
    expect(avatars[0].getAttribute("data-online")).toBe("true");
    expect(avatars[1].getAttribute("data-online")).toBe("false");
    expect(avatars[1].className).toContain("opacity-40");
  });
});
