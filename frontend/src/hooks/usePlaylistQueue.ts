import { useEffect, useRef, useState } from "react";
import type { PlaylistPreview, PlaylistEntry } from "../services/types";

export type YouTubeRunResult =
    | { status: "completed"; jobId: string }
    | { status: "failed"; error: string }
    | { status: "cancelled" };

export interface PlaylistItem extends PlaylistEntry {
    status: "pending" | "running" | "completed" | "failed" | "unavailable";
    jobId?: string;
    error?: string;
}

export interface PlaylistBatch {
    title: string;
    url: string;
    entries: PlaylistItem[];
}

const STORAGE_KEY = "remedy-playlist-v1";

function restoredBatch(): PlaylistBatch | null {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        if (
            !saved ||
            typeof saved.title !== "string" ||
            typeof saved.url !== "string" ||
            !Array.isArray(saved.entries)
        )
            return null;
        if (
            !saved.entries.every(
                (item: PlaylistItem) =>
                    item &&
                    Number.isInteger(item.position) &&
                    item.position > 0 &&
                    typeof item.title === "string" &&
                    [
                        "pending",
                        "running",
                        "completed",
                        "failed",
                        "unavailable",
                    ].includes(item.status) &&
                    (item.video_id === null ||
                        (typeof item.video_id === "string" &&
                            /^[\w-]{11}$/.test(item.video_id))) &&
                    (item.jobId === undefined ||
                        typeof item.jobId === "string") &&
                    (item.status !== "completed" ||
                        (typeof item.jobId === "string" &&
                            item.jobId.length > 0)) &&
                    (item.error === undefined ||
                        typeof item.error === "string") &&
                    (item.unavailable_reason === null ||
                        typeof item.unavailable_reason === "string"),
            )
        )
            return null;
        return {
            title: saved.title,
            url: saved.url,
            entries: saved.entries.map((item: PlaylistItem) => ({
                ...item,
                // A restored queue waits for Resume; it never starts paid work.
                status: item.status === "running" ? "pending" : item.status,
                url: item.video_id
                    ? `https://www.youtube.com/watch?v=${item.video_id}`
                    : null,
            })),
        };
    } catch {
        return null;
    }
}

export function usePlaylistQueue(
    runEntry: (url: string) => Promise<YouTubeRunResult>,
    cancelCurrent: () => void,
) {
    const [batch, setBatch] = useState<PlaylistBatch | null>(restoredBatch);
    const [running, setRunning] = useState(false);
    const [storageError, setStorageError] = useState<string | null>(null);
    const runningRef = useRef(false);
    const generation = useRef(0);

    useEffect(() => {
        try {
            if (batch) localStorage.setItem(STORAGE_KEY, JSON.stringify(batch));
            else localStorage.removeItem(STORAGE_KEY);
            setStorageError(null);
        } catch {
            setStorageError(
                "The queue could not be saved. Keep the app open to retain this playlist.",
            );
        }
    }, [batch]);

    useEffect(
        () => () => {
            generation.current++;
        },
        [],
    );

    const load = (preview: PlaylistPreview) => {
        if (runningRef.current) return;
        generation.current++;
        setBatch({
            ...preview,
            entries: preview.entries.map((entry) => ({
                ...entry,
                status:
                    entry.unavailable_reason || !entry.url
                        ? "unavailable"
                        : "pending",
            })),
        });
    };

    const stop = () => {
        generation.current++;
        runningRef.current = false;
        setRunning(false);
        setBatch(
            (previous) =>
                previous && {
                    ...previous,
                    entries: previous.entries.map((item) =>
                        item.status === "running"
                            ? { ...item, status: "pending" }
                            : item,
                    ),
                },
        );
        cancelCurrent();
    };

    const start = async () => {
        if (!batch || runningRef.current) return;
        runningRef.current = true;
        setRunning(true);
        const token = ++generation.current;
        const update = (index: number, change: Partial<PlaylistItem>) => {
            if (generation.current !== token) return;
            setBatch(
                (previous) =>
                    previous && {
                        ...previous,
                        entries: previous.entries.map((entry, i) =>
                            i === index ? { ...entry, ...change } : entry,
                        ),
                    },
            );
        };
        try {
            for (let index = 0; index < batch.entries.length; index++) {
                const item = batch.entries[index];
                if (generation.current !== token) break;
                if (
                    item.status === "completed" ||
                    item.status === "unavailable" ||
                    !item.url
                )
                    continue;
                update(index, { status: "running", error: undefined });
                let result: YouTubeRunResult;
                try {
                    result = await runEntry(item.url);
                } catch (error) {
                    result = {
                        status: "failed",
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    };
                }
                if (generation.current !== token) break;
                if (result.status === "cancelled") {
                    update(index, { status: "pending" });
                    break;
                }
                update(
                    index,
                    result.status === "completed"
                        ? { status: "completed", jobId: result.jobId }
                        : { status: "failed", error: result.error },
                );
            }
        } finally {
            if (generation.current === token) {
                runningRef.current = false;
                setRunning(false);
            }
        }
    };

    return { batch, running, storageError, load, start, stop };
}
