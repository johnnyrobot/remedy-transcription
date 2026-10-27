/**
 * B1 (final-review.md): `exportTranscript` is the only production caller of
 * the name-aware generators in `srtGenerator.ts`, and it must thread a
 * `names` map through to them. Before the fix, `exportTranscript` had no
 * `names` parameter at all and called `generators[format](captions)` with
 * captions only — so a renamed speaker's display name never reached an
 * exported file, regardless of what the generators themselves support.
 *
 * These tests exercise the REAL `exportTranscript` (only `invoke` and the
 * save dialog are mocked) and assert on the `content` actually handed to the
 * `export_transcript` IPC call — the same thing that ends up on disk.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsolidatedSegment } from "../lib/captionFormatter";
import type { SpeakerNames } from "./types";

const invokeMock = vi.fn();
const saveMock = vi.fn();
const openMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
    convertFileSrc: (path: string) => path,
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
    save: (...args: unknown[]) => saveMock(...args),
    open: (...args: unknown[]) => openMock(...args),
}));

vi.mock("@tauri-apps/api/path", () => ({
    join: async (...parts: string[]) => parts.join("/"),
}));

import { api } from "./api";

const DIARIZED: ConsolidatedSegment[] = [
    {
        start: 0,
        end: 2,
        text: "Hello there.",
        speaker: "SPEAKER_00",
    } as unknown as ConsolidatedSegment,
];

const PLAIN: ConsolidatedSegment[] = [
    {
        start: 0,
        end: 2,
        text: "Hello there.",
    } as unknown as ConsolidatedSegment,
];

const NAMES: SpeakerNames = { SPEAKER_00: "Alice" };

beforeEach(() => {
    invokeMock.mockReset();
    saveMock.mockReset();
    openMock.mockReset();
    saveMock.mockResolvedValue("/tmp/out");
});

describe("playlist import and bulk export", () => {
    it("calls native playlist discovery", async () => {
        invokeMock.mockResolvedValue({ title: "Course", entries: [] });
        await api.getYouTubePlaylist(
            "https://youtube.com/playlist?list=PLcourse",
        );
        expect(invokeMock).toHaveBeenCalledWith("get_youtube_playlist", {
            url: "https://youtube.com/playlist?list=PLcourse",
        });
    });

    it("exports each completed job in order with unique safe filenames and the same speaker policy as the viewer", async () => {
        openMock.mockResolvedValue("/exports");
        invokeMock.mockImplementation(async (command, args) => {
            if (command === "get_job")
                return {
                    id: args.jobId,
                    status: "completed",
                    filename: "Lecture: / one?",
                    source_key: "dQw4w9WgXcQ",
                    model_id: "onnx-community/whisper-base_timestamped",
                    segments: [
                        {
                            start: 0,
                            end: 2,
                            text: "Hello there.",
                            speaker: "SPEAKER_00",
                        },
                    ],
                };
            if (command === "get_speaker_names") return NAMES;
        });
        expect(
            await api.exportPlaylistTranscripts(
                [
                    { jobId: "job-1", position: 1 },
                    { jobId: "job-2", position: 2 },
                ],
                "txt",
            ),
        ).toBe(2);
        const writes = invokeMock.mock.calls
            .filter(([command]) => command === "export_transcript")
            .map(([, args]) => args.request);
        expect(writes).toHaveLength(2);
        expect(writes[0].destination).toMatch(
            /^\/exports\/001-Lecture_ _ one_-dQw4w9WgXcQ.txt$/,
        );
        expect(writes[1].destination).toContain("/002-");
        expect(writes[0].content).toContain("Hello there.");
        expect(writes[0].content).not.toContain("Alice");
        expect(writes[0].content).not.toContain("SPEAKER_00");
    });

    it("honors directory cancellation without writing any files", async () => {
        openMock.mockResolvedValue(null);
        expect(
            await api.exportPlaylistTranscripts(
                [{ jobId: "one", position: 1 }],
                "srt",
            ),
        ).toBeNull();
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it("reports partial exports accurately", async () => {
        openMock.mockResolvedValue("/exports");
        invokeMock.mockImplementation(async (command, args) => {
            if (command === "get_job") {
                if (args.jobId === "bad") throw new Error("Missing job");
                return {
                    id: args.jobId,
                    status: "completed",
                    filename: "Lecture",
                    source_key: "dQw4w9WgXcQ",
                    model_id: "local",
                    segments: [],
                };
            }
            if (command === "get_speaker_names") return {};
        });
        await expect(
            api.exportPlaylistTranscripts(
                [
                    { jobId: "good", position: 1 },
                    { jobId: "bad", position: 2 },
                ],
                "srt",
            ),
        ).rejects.toThrow(
            "Export stopped after 1 file(s). Video 2: Missing job",
        );
    });
});

function exportedContent(): string {
    const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "export_transcript",
    );
    expect(call).toBeTruthy();
    return (call![1] as { request: { content: string } }).request.content;
}

describe("exportTranscript threads the names map to the generators", () => {
    it("SRT export carries the display name, not the raw speaker label", async () => {
        await api.exportTranscript("job-1", "srt", DIARIZED, "lecture", NAMES);
        expect(exportedContent()).toContain("[Alice]: Hello there.");
        expect(exportedContent()).not.toContain("SPEAKER_00");
    });

    it("JSON export's speakerNames map carries the display name", async () => {
        await api.exportTranscript("job-1", "json", DIARIZED, "lecture", NAMES);
        const parsed = JSON.parse(exportedContent());
        expect(parsed.speakerNames).toEqual(NAMES);
        // The raw label is preserved on the segment itself (fidelity), only
        // the top-level map carries the display name.
        expect(parsed.segments[0].speaker).toBe("SPEAKER_00");
    });

    it("an undiarized export is unaffected by an (absent or present) names map", async () => {
        await api.exportTranscript("job-1", "srt", PLAIN, "lecture");
        const withoutNames = exportedContent();

        invokeMock.mockClear();
        await api.exportTranscript("job-1", "srt", PLAIN, "lecture", NAMES);
        const withNames = exportedContent();

        expect(withoutNames).toBe(withNames);
        expect(withoutNames).not.toMatch(/^\[.*\]:/m);
    });
});
