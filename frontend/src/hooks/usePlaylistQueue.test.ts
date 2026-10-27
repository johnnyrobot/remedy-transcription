// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePlaylistQueue, type YouTubeRunResult } from "./usePlaylistQueue";
import type { PlaylistPreview } from "../services/types";

const preview: PlaylistPreview = {
    title: "Course",
    url: "https://www.youtube.com/playlist?list=PLcourse",
    entries: ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((id, i) => ({
        position: i + 1,
        video_id: id,
        title: `Lecture ${i + 1}`,
        url: `https://www.youtube.com/watch?v=${id}`,
        unavailable_reason: null,
    })),
};
beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("runs sequentially, retains each completed job, continues after a failure, and retries only the failure", async () => {
    let finish!: (value: YouTubeRunResult) => void;
    const run = vi
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise<YouTubeRunResult>((resolve) => {
                    finish = resolve;
                }),
        )
        .mockResolvedValueOnce({ status: "failed", error: "Private video" })
        .mockResolvedValueOnce({ status: "completed", jobId: "job-3" })
        .mockResolvedValue({ status: "completed", jobId: "job-retry" });
    const { result } = renderHook(() => usePlaylistQueue(run, vi.fn()));
    act(() => result.current.load(preview));
    let running!: Promise<void>;
    act(() => {
        running = result.current.start();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(true);
    expect(result.current.batch?.entries[0].status).toBe("running");
    await act(async () => {
        finish({ status: "completed", jobId: "job-1" });
        await running;
    });
    expect(run.mock.calls.map(([url]) => url)).toEqual(
        preview.entries.map((entry) => entry.url),
    );
    expect(result.current.batch?.entries.map((entry) => entry.status)).toEqual([
        "completed",
        "failed",
        "completed",
    ]);
    expect(result.current.batch?.entries[1].error).toBe("Private video");
    await act(async () => {
        await result.current.start();
    });
    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls[3][0]).toBe(preview.entries[1].url);
    expect(result.current.batch?.entries.map((entry) => entry.jobId)).toEqual([
        "job-1",
        "job-retry",
        "job-3",
    ]);
});

it("stops without starting another video and ignores a late completion", async () => {
    let finish!: (value: YouTubeRunResult) => void;
    const run = vi.fn(
        () =>
            new Promise<YouTubeRunResult>((resolve) => {
                finish = resolve;
            }),
    );
    const cancel = vi.fn();
    const { result } = renderHook(() => usePlaylistQueue(run, cancel));
    act(() => result.current.load(preview));
    let running!: Promise<void>;
    act(() => {
        running = result.current.start();
    });
    act(() => result.current.stop());
    await act(async () => {
        finish({ status: "completed", jobId: "late" });
        await running;
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(false);
    expect(
        result.current.batch?.entries.every(
            (entry) => entry.status === "pending",
        ),
    ).toBe(true);
});

it("stops the batch when a video is cancelled or its cloud cost is declined", async () => {
    const run = vi.fn().mockResolvedValue({ status: "cancelled" });
    const { result } = renderHook(() => usePlaylistQueue(run, vi.fn()));
    act(() => result.current.load(preview));
    await act(async () => {
        await result.current.start();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(false);
    expect(result.current.batch?.entries[0].status).toBe("pending");
});

it("restores an interrupted queue without auto-starting and skips unavailable entries", async () => {
    const run = vi
        .fn()
        .mockResolvedValue({ status: "completed", jobId: "job-1" });
    const first = renderHook(() => usePlaylistQueue(run, vi.fn()));
    act(() =>
        first.result.current.load({
            ...preview,
            entries: [
                preview.entries[0],
                { ...preview.entries[1], unavailable_reason: "Private" },
            ],
        }),
    );
    const saved = JSON.parse(
        localStorage.getItem("remedy-playlist-v1") ?? "null",
    );
    saved.entries[0].status = "running";
    localStorage.setItem("remedy-playlist-v1", JSON.stringify(saved));
    first.unmount();
    const { result } = renderHook(() => usePlaylistQueue(run, vi.fn()));
    expect(run).not.toHaveBeenCalled();
    expect(result.current.batch?.entries.map((entry) => entry.status)).toEqual([
        "pending",
        "unavailable",
    ]);
    await act(async () => {
        await result.current.start();
    });
    expect(run).toHaveBeenCalledTimes(1);
});

it("tolerates corrupt saved state and reports storage failures", () => {
    localStorage.setItem("remedy-playlist-v1", "not JSON");
    const { result } = renderHook(() => usePlaylistQueue(vi.fn(), vi.fn()));
    expect(result.current.batch).toBeNull();
    const write = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
            throw new Error("quota");
        });
    act(() => result.current.load(preview));
    expect(result.current.storageError).toContain("could not be saved");
    write.mockRestore();
});
