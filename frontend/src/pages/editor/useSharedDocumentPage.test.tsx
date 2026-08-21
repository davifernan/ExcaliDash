import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSharedDocumentPage, type DocumentPageSharing } from "./useSharedDocumentPage";

const Reader = ({ sharing, pageCount }: { sharing: DocumentPageSharing; pageCount: number }) => {
  const { page, goToPage } = useSharedDocumentPage({ sharing, pageCount });
  return (
    <div>
      <output data-testid="page">{page}</output>
      <button onClick={() => goToPage(page + 1)}>next</button>
      <button onClick={() => goToPage(page - 1)}>previous</button>
    </div>
  );
};

const shownPage = () => Number(screen.getByTestId("page").textContent);

describe("the page a document widget shows", () => {
  it("starts on the first page while the room has said nothing", () => {
    render(<Reader sharing={{ elementId: "w", assetId: "a", canControl: true }} pageCount={9} />);
    expect(shownPage()).toBe(1);
  });

  it("follows the room", () => {
    const { rerender } = render(
      <Reader sharing={{ elementId: "w", assetId: "a", canControl: false }} pageCount={9} />,
    );
    rerender(
      <Reader
        sharing={{ elementId: "w", assetId: "a", canControl: false, sharedPage: 4 }}
        pageCount={9}
      />,
    );
    expect(shownPage()).toBe(4);
  });

  it("turns the page for everybody when this reader may edit the board", () => {
    const onRequestPage = vi.fn();
    render(
      <Reader
        sharing={{ elementId: "w", assetId: "a", canControl: true, onRequestPage }}
        pageCount={9}
      />,
    );

    fireEvent.click(screen.getByText("next"));

    // Applied here as well as sent, so the turn is not waiting on the network.
    expect(shownPage()).toBe(2);
    expect(onRequestPage).toHaveBeenCalledWith("w", "a", 2);
  });

  it("turns the page only for a reader who may not edit the board", () => {
    const onRequestPage = vi.fn();
    render(
      <Reader
        sharing={{ elementId: "w", assetId: "a", canControl: false, onRequestPage }}
        pageCount={9}
      />,
    );

    fireEvent.click(screen.getByText("next"));

    expect(shownPage()).toBe(2);
    expect(onRequestPage).not.toHaveBeenCalled();
  });

  it("stays inside the document", () => {
    render(<Reader sharing={{ elementId: "w", assetId: "a", canControl: true }} pageCount={2} />);
    fireEvent.click(screen.getByText("previous"));
    expect(shownPage()).toBe(1);
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    expect(shownPage()).toBe(2);
  });

  it("clamps a room page this reader cannot reach, and lets go once it can", () => {
    // A text document is split in the browser, so the room can be on a page
    // this reader has not measured yet.
    const { rerender } = render(
      <Reader
        sharing={{ elementId: "w", assetId: "a", canControl: false, sharedPage: 7 }}
        pageCount={0}
      />,
    );
    expect(shownPage()).toBe(1);

    rerender(
      <Reader
        sharing={{ elementId: "w", assetId: "a", canControl: false, sharedPage: 7 }}
        pageCount={12}
      />,
    );
    expect(shownPage()).toBe(7);
  });
});
