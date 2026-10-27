import { modelDiarizes } from "../config/engines";
import type { Job, TranscriptionSegment } from "../services/types";

/**
 * A stored job's segments, with speaker labels no engine in this build could
 * have written stripped back off them.
 *
 * 1.1.0's local sherpa-onnx diarizer was deleted in 1.2.0 for mislabelling one
 * narrator as dozens of speakers. Deleting the diarizer did not delete what it
 * had already written: `speaker` is baked into every persisted segment row, and
 * `applyCompletedJob` reads those labels straight off the rows — so reopening a
 * pre-1.2.0 local transcript still paints SPEAKER_00 … SPEAKER_51 across it,
 * offers to rename all fifty-two of them, and exports them into the SRT. The
 * feature is gone; only its output is still on screen.
 *
 * This read policy is shared by the transcript viewer and bulk export, so
 * retired speaker labels cannot leak back into exported captions.
 *
 * DELETES THE KEY, rather than setting it to `undefined` or `""`. A segment
 * without a speaker must render and serialize EXACTLY as it did before
 * diarization existed — that is the documented contract on
 * `TranscriptionSegment.speaker`, and `consolidateSegments` reads presence, not
 * truthiness, when it decides where to break a cue.
 *
 * Returns the SAME ARRAY when nothing needs stripping, which is every transcript
 * this build writes: a fresh local run has no labels to begin with and a Gemini
 * run's are real. The copy is paid for only by the transcripts that are wrong.
 */
export function segmentsWithTrustedSpeakers(job: Job): TranscriptionSegment[] {
    if (
        modelDiarizes(job.model_id) ||
        !job.segments.some((segment) => segment.speaker !== undefined)
    )
        return job.segments;
    return job.segments.map((segment) => {
        const trusted = { ...segment };
        delete trusted.speaker;
        return trusted;
    });
}
