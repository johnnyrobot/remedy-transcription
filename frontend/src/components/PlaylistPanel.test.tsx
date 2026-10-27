// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PlaylistPanel from "./PlaylistPanel";
import { usePlaylistQueue } from "../hooks/usePlaylistQueue";
import type { Transcriber } from "../hooks/useTranscriber";

const mocks = vi.hoisted(() => ({
    discover: vi.fn(),
    export: vi.fn(),
    view: vi.fn(),
}));
vi.mock("../services/api", () => ({
    api: {
        getYouTubePlaylist: mocks.discover,
        exportPlaylistTranscripts: mocks.export,
    },
}));
const run = vi.fn();
function Harness() {
    const playlist = usePlaylistQueue(run, vi.fn());
    const transcriber = {
        playlist,
        isBusy: playlist.running,
        selectedModelAvailable: true,
        openPlaylistJob: mocks.view,
    } as unknown as Transcriber;
    return <PlaylistPanel transcriber={transcriber} engineReady={true} />;
}
beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.discover.mockResolvedValue({
        title: "My course",
        url: "https://youtube.com/playlist?list=PLcourse",
        entries: [
            {
                position: 1,
                video_id: "aaaaaaaaaaa",
                title: "Lecture one",
                url: "https://youtube.com/watch?v=aaaaaaaaaaa",
                unavailable_reason: null,
            },
            {
                position: 2,
                video_id: "bbbbbbbbbbb",
                title: "Private lecture",
                url: "https://youtube.com/watch?v=bbbbbbbbbbb",
                unavailable_reason: "Private video",
            },
        ],
    });
    run.mockResolvedValue({ status: "completed", jobId: "job-1" });
    mocks.view.mockResolvedValue(undefined);
    mocks.export.mockResolvedValue(1);
});
afterEach(cleanup);

it("loads a playlist, transcribes available videos, opens a saved result, and bulk exports", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("YouTube playlist URL"), {
        target: { value: "https://youtube.com/playlist?list=PLcourse" },
    });
    fireEvent.click(screen.getByText("Load playlist"));
    await screen.findByText("My course");
    expect(screen.getByText("Private video")).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Transcribe playlist" }),
    );
    await screen.findByRole("button", { name: "View transcript 1" });
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "View transcript 1" }));
    expect(mocks.view).toHaveBeenCalledWith("job-1");
    fireEvent.change(screen.getByLabelText("Playlist export format"), {
        target: { value: "srt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export completed" }));
    await screen.findByText("Exported 1 transcript file(s).");
    expect(mocks.export).toHaveBeenCalledWith(
        [{ jobId: "job-1", position: 1 }],
        "srt",
    );
});

it("shows discovery errors and permits another load", async () => {
    mocks.discover.mockRejectedValueOnce(new Error("Playlist is private"));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("YouTube playlist URL"), {
        target: { value: "https://youtube.com/playlist?list=PLcourse" },
    });
    fireEvent.click(screen.getByText("Load playlist"));
    await screen.findByText("Playlist is private");
    fireEvent.click(screen.getByText("Load playlist"));
    await screen.findByText("My course");
    expect(mocks.discover).toHaveBeenCalledTimes(2);
});

it("keeps controls locked throughout a batch", async () => {
    run.mockImplementation(() => new Promise(() => undefined));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("YouTube playlist URL"), {
        target: { value: "https://youtube.com/playlist?list=PLcourse" },
    });
    fireEvent.click(screen.getByText("Load playlist"));
    await screen.findByText("My course");
    fireEvent.click(
        screen.getByRole("button", { name: "Transcribe playlist" }),
    );
    await waitFor(() =>
        expect(
            screen
                .getByRole("button", { name: "Load playlist" })
                .hasAttribute("disabled"),
        ).toBe(true),
    );
    expect(
        screen.getByLabelText("YouTube playlist URL").hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Stop playlist" }));
    expect(
        screen
            .getByRole("button", { name: "Transcribe playlist" })
            .hasAttribute("disabled"),
    ).toBe(false);
});
