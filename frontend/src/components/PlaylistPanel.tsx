import { useRef, useState } from "react";
import type { PlaylistItem } from "../hooks/usePlaylistQueue";
import type { Transcriber } from "../hooks/useTranscriber";
import { api } from "../services/api";

export default function PlaylistPanel({
    transcriber,
    engineReady,
}: {
    transcriber: Transcriber;
    engineReady: boolean;
}) {
    const { playlist } = transcriber;
    const [url, setUrl] = useState(playlist.batch?.url ?? "");
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [format, setFormat] = useState<"txt" | "srt" | "vtt" | "json">("txt");
    const [notice, setNotice] = useState<string | null>(null);
    const request = useRef(0);
    const entries = playlist.batch?.entries ?? [];
    const completed = entries.filter(
        (entry): entry is PlaylistItem & { jobId: string } =>
            entry.status === "completed" && typeof entry.jobId === "string",
    );
    const remaining = entries.filter(
        (entry) => entry.status === "pending" || entry.status === "failed",
    );
    const blocked = transcriber.isBusy || loading || exporting;

    const load = async () => {
        const token = ++request.current;
        setLoading(true);
        setNotice(null);
        try {
            const preview = await api.getYouTubePlaylist(url.trim());
            if (request.current === token) {
                playlist.load(preview);
                if (!preview.entries.length)
                    setNotice("This playlist has no videos available to list.");
            }
        } catch (error) {
            if (request.current === token)
                setNotice(
                    error instanceof Error ? error.message : String(error),
                );
        } finally {
            if (request.current === token) setLoading(false);
        }
    };

    const exportAll = async () => {
        setExporting(true);
        setNotice(null);
        try {
            const count = await api.exportPlaylistTranscripts(
                completed.map((entry) => ({
                    jobId: entry.jobId,
                    position: entry.position,
                })),
                format,
            );
            if (count !== null)
                setNotice(`Exported ${count} transcript file(s).`);
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        } finally {
            setExporting(false);
        }
    };

    return (
        <section
            className='mt-4 rounded-lg bg-white p-4 ring-1 ring-slate-700/10'
            aria-label='Playlist transcription'
        >
            <h3 className='text-lg font-semibold text-slate-800'>
                Transcribe a playlist
            </h3>
            <p className='mt-1 text-sm text-slate-600'>
                Load a YouTube playlist, then transcribe every available video
                in order. Completed videos are saved; failures can be retried.
            </p>
            <form
                className='mt-3 flex flex-wrap gap-2'
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!blocked && url.trim()) void load();
                }}
            >
                <label className='flex min-w-0 flex-1 flex-col text-sm text-slate-700'>
                    YouTube playlist URL
                    <input
                        type='url'
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        disabled={blocked}
                        placeholder='https://www.youtube.com/playlist?list=…'
                        className='mt-1 w-full rounded border border-slate-300 px-3 py-2'
                        required
                    />
                </label>
                <button
                    type='submit'
                    disabled={blocked || !url.trim()}
                    className='self-end rounded bg-slate-700 px-4 py-2 text-sm text-white disabled:opacity-50'
                >
                    {loading ? "Loading playlist…" : "Load playlist"}
                </button>
            </form>
            {playlist.batch && (
                <>
                    <h4 className='mt-4 font-semibold text-slate-800'>
                        {playlist.batch.title}
                    </h4>
                    <p role='status' className='mt-1 text-sm text-slate-600'>
                        {completed.length} of {entries.length} completed ·{" "}
                        {
                            entries.filter((entry) => entry.status === "failed")
                                .length
                        }{" "}
                        failed ·{" "}
                        {
                            entries.filter(
                                (entry) => entry.status === "unavailable",
                            ).length
                        }{" "}
                        unavailable
                    </p>
                    <div className='mt-3 flex flex-wrap items-center gap-3'>
                        {playlist.running ? (
                            <button
                                type='button'
                                onClick={playlist.stop}
                                className='rounded border border-slate-300 px-3 py-2 text-sm'
                            >
                                Stop playlist
                            </button>
                        ) : (
                            <button
                                type='button'
                                disabled={
                                    blocked ||
                                    !engineReady ||
                                    !transcriber.selectedModelAvailable ||
                                    !remaining.length
                                }
                                onClick={() => {
                                    setNotice(null);
                                    void playlist.start();
                                }}
                                className='rounded bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50'
                            >
                                {completed.length ||
                                entries.some(
                                    (entry) => entry.status === "failed",
                                )
                                    ? "Resume / retry remaining"
                                    : "Transcribe playlist"}
                            </button>
                        )}
                        <label className='text-sm text-slate-700'>
                            Export format{" "}
                            <select
                                aria-label='Playlist export format'
                                value={format}
                                disabled={blocked}
                                onChange={(event) =>
                                    setFormat(
                                        event.target.value as typeof format,
                                    )
                                }
                                className='rounded border border-slate-300 p-2'
                            >
                                {["txt", "srt", "vtt", "json"].map((value) => (
                                    <option key={value} value={value}>
                                        {value.toUpperCase()}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            type='button'
                            onClick={() => void exportAll()}
                            disabled={blocked || !completed.length}
                            className='rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50'
                        >
                            {exporting ? "Exporting…" : "Export completed"}
                        </button>
                    </div>
                    <p className='mt-2 text-xs text-slate-500'>
                        Uses the engine and settings above. Gemini uploads audio
                        to Google and asks for cost approval for long videos.
                        Keep the app open while processing; reopen it and choose
                        Resume to continue. Stop prevents the next video; an
                        active download may finish in the background.
                    </p>
                    {!engineReady && (
                        <p className='mt-2 text-sm text-amber-700'>
                            Add a Gemini API key above to transcribe this
                            playlist.
                        </p>
                    )}
                    <ol
                        className='mt-3 max-h-80 overflow-y-auto divide-y divide-slate-100'
                        aria-label='Playlist videos'
                    >
                        {entries.map((entry, index) => (
                            <li
                                key={index}
                                className='flex items-start justify-between gap-3 py-2 text-sm'
                            >
                                <div className='min-w-0'>
                                    <span className='break-words text-slate-800'>
                                        {entry.position}. {entry.title}
                                    </span>
                                    <span className='ml-2 text-slate-500'>
                                        {entry.status === "running"
                                            ? "Processing"
                                            : entry.status}
                                    </span>
                                    {(entry.error ||
                                        entry.unavailable_reason) && (
                                        <p className='mt-1 text-red-700'>
                                            {entry.error ||
                                                entry.unavailable_reason}
                                        </p>
                                    )}
                                </div>
                                {entry.status === "completed" &&
                                    entry.jobId && (
                                        <button
                                            type='button'
                                            disabled={blocked}
                                            onClick={() => {
                                                const jobId = entry.jobId;
                                                if (!jobId) return;
                                                void transcriber
                                                    .openPlaylistJob(jobId)
                                                    .catch((error) =>
                                                        setNotice(
                                                            error instanceof
                                                                Error
                                                                ? error.message
                                                                : String(error),
                                                        ),
                                                    );
                                            }}
                                            className='shrink-0 text-indigo-600 underline disabled:opacity-50'
                                            aria-label={`View transcript ${entry.position}`}
                                        >
                                            View
                                        </button>
                                    )}
                            </li>
                        ))}
                    </ol>
                </>
            )}
            {(notice || playlist.storageError) && (
                <p role='status' className='mt-3 text-sm text-slate-700'>
                    {notice || playlist.storageError}
                </p>
            )}
        </section>
    );
}
