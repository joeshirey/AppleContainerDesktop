//! Running a build and holding its state while it runs.
//!
//! This is the only place in the app with a live child process. The pieces
//! worth testing on their own, the ring buffer and the exit-status decision,
//! are plain values with no process behind them.

use crate::build_args::{self, BuildOptions};
use crate::cli;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, ChildStderr, ChildStdout};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// How many lines the ring buffer retains before it starts evicting the oldest.
/// This bounds the count, not the bytes; each line is capped separately by
/// `MAX_LINE_BYTES`. Together they put the worst case at 5000 × 64 KiB, about
/// 320 MiB, all of which `get_build_state` clones under the lock before
/// serializing it. Real build output comes nowhere near that, which is the only
/// reason there is no byte budget here.
pub const MAX_LINES: usize = 5000;

/// One recorded line of output. `seq` is unique within a build and shared
/// across both streams, and is what the frontend dedupes replayed lines by.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildLine {
    pub seq: u64,
    pub stream: &'static str,
    pub line: String,
}

/// Where a build has got to. `Idle` is the state before the app has run one;
/// everything else describes the most recent build.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildStatus {
    Idle,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

/// A kill makes the process exit non-zero, so a cancel that was asked for
/// outranks the code the child reports — with one exception. A signalled
/// process has no exit code at all, so a clean zero means the build finished
/// on its own and the image exists, whatever the user asked for meanwhile.
pub fn final_status(cancel_requested: bool, exit_code: Option<i32>) -> BuildStatus {
    if exit_code == Some(0) {
        BuildStatus::Succeeded
    } else if cancel_requested {
        BuildStatus::Cancelled
    } else {
        BuildStatus::Failed
    }
}

#[derive(Debug, Default)]
pub struct OutputBuffer {
    lines: VecDeque<BuildLine>,
    next_seq: u64,
    dropped: u64,
}

impl OutputBuffer {
    /// Record a line and hand back the entry that was stored, so the caller can
    /// emit exactly what a later snapshot would report.
    pub fn push(&mut self, stream: &'static str, line: String) -> BuildLine {
        let entry = BuildLine {
            seq: self.next_seq,
            stream,
            line,
        };
        self.next_seq += 1;
        self.lines.push_back(entry.clone());
        while self.lines.len() > MAX_LINES {
            self.lines.pop_front();
            self.dropped += 1;
        }
        entry
    }

    /// The full transcript the frontend replays when the build pane opens or
    /// reconnects. The dedupe contract requires that all three accessors are
    /// read under a single lock acquisition: fetching snapshot and next_seq
    /// separately can produce a snapshot ending at seq 100 alongside a
    /// next_seq of 105, causing the frontend to silently discard events
    /// 100–104 as already covered.
    pub fn snapshot(&self) -> Vec<BuildLine> {
        self.lines.iter().cloned().collect()
    }

    /// The seq that will be assigned to the next line pushed. The frontend
    /// uses this as its dedupe boundary: events with seq >= next_seq are new.
    pub fn next_seq(&self) -> u64 {
        self.next_seq
    }

    /// How many lines were evicted from the front of the buffer. Drives the
    /// "N earlier lines not shown" banner in the build pane.
    pub fn dropped(&self) -> u64 {
        self.dropped
    }
}

/// Emitted once per line of build output, carrying a [`BuildOutput`].
pub const BUILD_OUTPUT_EVENT: &str = "build-output";
/// Emitted once when a build ends, however it ended, carrying a [`BuildDone`].
/// No further output event follows it for that build.
pub const BUILD_DONE_EVENT: &str = "build-done";

/// The build the app is running, or the last one it ran. One at a time: a
/// second build is refused while this one is `Running`.
pub struct ActiveBuild {
    build_id: u64,
    tag: String,
    status: BuildStatus,
    exit_code: Option<i32>,
    cancel_requested: bool,
    buffer: OutputBuffer,
    /// Taken by the waiter thread once both pipes have closed.
    child: Option<Child>,
}

/// The managed state behind the three build commands, and the only thing the
/// reader and waiter threads share with them.
#[derive(Default)]
pub struct BuildManager {
    /// The running build, or the last one to finish.
    pub active: Mutex<Option<ActiveBuild>>,
    /// Ids come from here rather than from the build itself, so they keep
    /// climbing across builds even when the state is cleared.
    next_id: AtomicU64,
}

impl BuildManager {
    /// Ids start at 1, leaving 0 to mean "no build has run yet".
    fn next_build_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }
}

/// Everything the build pane needs to render itself from cold: the status, the
/// transcript so far, and the dedupe boundary for events arriving alongside it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStateDto {
    pub build_id: u64,
    pub status: BuildStatus,
    pub tag: String,
    pub exit_code: Option<i32>,
    pub lines: Vec<BuildLine>,
    pub next_seq: u64,
    pub dropped: u64,
}

/// One line of build output, tagged with the build it came from.
///
/// `seq` restarts at 0 for every build, so without the id an event that
/// arrives after the pane has switched to the next build is indistinguishable
/// from one of its own. The frontend drops any event whose `buildId` does not
/// match the snapshot it is holding.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOutput {
    pub build_id: u64,
    #[serde(flatten)]
    pub line: BuildLine,
}

/// How a build ended. `exit_code` is `None` when the process was signalled,
/// which is what a cancel does, so it is absent on most cancelled builds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildDone {
    pub build_id: u64,
    pub status: BuildStatus,
    pub tag: String,
    pub exit_code: Option<i32>,
}

/// Start a build and return as soon as it is running; the output arrives as
/// [`BUILD_OUTPUT_EVENT`] events and the outcome as [`BUILD_DONE_EVENT`].
///
/// Fails if the options do not resolve to a Dockerfile, if the CLI cannot be
/// started, or if a build is already running.
#[tauri::command]
pub fn start_build(app: AppHandle, opts: BuildOptions) -> Result<(), String> {
    // Path checks touch the filesystem and say nothing about the running
    // build, so they happen before anything is locked.
    let dockerfile = build_args::validate(&opts)?;
    let argv = build_args::build_argv(&opts, &dockerfile);

    let manager = app.state::<BuildManager>();
    // Checking, spawning and installing are one critical section. Release the
    // lock in between and two clicks can both find nothing running and both
    // spawn: the second install drops the first child's handle, so that build
    // can no longer be cancelled, its readers feed their output into the second
    // build's transcript, and its waiter ends the second build early with a
    // status belonging to the first. Holding the lock across the spawn costs
    // nothing, since `spawn_cmd` returns as soon as the child is running.
    let (stdout, stderr) = {
        let mut guard = manager
            .active
            .lock()
            .map_err(|_| "Build state is poisoned.")?;
        if guard
            .as_ref()
            .is_some_and(|b| b.status == BuildStatus::Running)
        {
            return Err("A build is already running.".to_string());
        }
        let mut child = cli::spawn_cmd(&argv).map_err(|e| e.message)?;
        let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
            // `Child::drop` neither kills nor reaps, the same fact behind the
            // pipe-drain warning on `spawn_cmd`. Letting this child fall out of
            // scope would leave a build running that nothing can reach, and a
            // zombie once it exits.
            let _ = child.kill();
            let _ = child.wait();
            return Err("Could not capture build output.".to_string());
        };
        *guard = Some(ActiveBuild {
            build_id: manager.next_build_id(),
            tag: opts.tag.trim().to_string(),
            status: BuildStatus::Running,
            exit_code: None,
            cancel_requested: false,
            buffer: OutputBuffer::default(),
            child: Some(child),
        });
        (stdout, stderr)
    };

    // The threads start only once the guard above has dropped: each reader
    // takes the same lock to record its first line, so starting them underneath
    // it deadlocks as soon as the build prints anything.
    if let Err(e) = start_threads(&app, stdout, stderr) {
        // The build is installed and Running by now, so leaving it there would
        // hold that status for the life of the app and refuse every later
        // build. Put the state back and take the child with it.
        abandon(manager.inner());
        return Err(format!("Could not start the build: {e}"));
    }

    Ok(())
}

/// Start the two readers and the waiter that ends the build.
///
/// A thread that cannot start is reported rather than fatal: `thread::spawn`
/// panics when the OS refuses, and a panic here would take down a command
/// invocation with a live child already installed.
fn start_threads(app: &AppHandle, stdout: ChildStdout, stderr: ChildStderr) -> std::io::Result<()> {
    let out_reader = spawn_reader(app.clone(), "stdout", stdout)?;
    // If this one fails, the reader above is left running: it sees EOF as soon
    // as `abandon` kills the child, and exits on its own.
    let err_reader = spawn_reader(app.clone(), "stderr", stderr)?;
    let waiter = app.clone();
    std::thread::Builder::new()
        .name("build-waiter".to_string())
        .spawn(move || {
            // Joining the readers is how this thread learns the build is over:
            // EOF arrives when the last copy of the pipe write end closes,
            // which is the child exiting only for as long as the CLI keeps
            // those descriptors to itself. Measured against container 1.2.0 on
            // 2026-07-30 — the CLI spawns no local helpers (it drives the build
            // over XPC), holds fds 1 and 2 alone, and both readers saw EOF in
            // the same instant it exited, on a clean build and on a SIGKILL
            // alike. A future version that forked a helper inheriting those fds
            // would strand this thread in `join`, leaving the build stuck at
            // Running and refusing every later start.
            let _ = out_reader.join();
            let _ = err_reader.join();
            finish(&waiter);
        })?;
    Ok(())
}

/// Throw away a build that was installed but never got its threads, so the
/// next one is not refused by a `Running` status nothing will ever end.
fn abandon(manager: &BuildManager) {
    let Ok(mut guard) = manager.active.lock() else {
        return;
    };
    if let Some(mut child) = guard.take().and_then(|mut active| active.child.take()) {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Long enough for any real build diagnostic, short enough that one runaway
/// `RUN` step cannot hand the log pane a multi-megabyte line.
const MAX_LINE_BYTES: u64 = 64 * 1024;

/// Appended to a line that hit the cap, so the pane never shows a sliced line
/// as though that were all the build printed.
const TRUNCATION_MARKER: &str = " [line truncated]";

/// Read one line, keeping at most `MAX_LINE_BYTES` of it.
///
/// `None` ends the stream. That is end of input in the ordinary case, but a
/// read error also reports it, and a pipe the child is still writing to would
/// then stop being drained. Dropping this end is what stops the child in that
/// case, rather than the child having stopped first.
///
/// `MAX_LINES` bounds how many lines are kept, not how big one can be, and
/// `--progress plain` passes `RUN` output through verbatim. Without the cap a
/// single step that cats a large file allocates that whole blob here, clones it
/// into the ring buffer and clones it again into the event payload.
fn read_capped_line<R: BufRead>(reader: &mut R) -> Option<String> {
    let mut buf = Vec::new();
    let read = reader
        .by_ref()
        .take(MAX_LINE_BYTES)
        .read_until(b'\n', &mut buf)
        .ok()?;
    if read == 0 {
        return None;
    }
    // Hitting the cap without the delimiter does not prove anything was lost:
    // a line of exactly `MAX_LINE_BYTES` plus its newline reads as full content
    // with the delimiter just out of reach. Only the skip knows whether real
    // bytes went in the bin, and a marker on a line that is in fact complete
    // tells the user to go looking for output that was never cut.
    let mut truncated = false;
    if read as u64 == MAX_LINE_BYTES && buf.last() != Some(&b'\n') {
        truncated = skip_rest_of_line(reader);
    }
    if buf.last() == Some(&b'\n') {
        buf.pop();
    }
    // A `\r` at the end of a line that really ended is the other half of a
    // CRLF, whose `\n` was either just popped or sat past the cap.
    if !truncated && buf.last() == Some(&b'\r') {
        buf.pop();
    }
    // Build output is whatever the RUN steps happen to print, so a stray byte
    // that is not valid UTF-8 is ordinary. Refusing the line would end the
    // drain, and a pipe that stops emptying leaves the child blocked on its
    // next write with the build stuck at Running forever. One replacement
    // character is the cheaper outcome.
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    if truncated {
        text.push_str(TRUNCATION_MARKER);
    }
    Some(text)
}

/// Throw away the tail of an over-long line, still a bounded chunk at a time,
/// and report whether any of it was content rather than the delimiter alone.
/// The bytes are not wanted but they do have to be read: leaving them in the
/// pipe is the same stall as not reading it at all.
fn skip_rest_of_line<R: BufRead>(reader: &mut R) -> bool {
    let mut discarded = false;
    loop {
        let mut discard = Vec::new();
        match reader
            .by_ref()
            .take(MAX_LINE_BYTES)
            .read_until(b'\n', &mut discard)
        {
            // End of stream, or a pipe that will not read again.
            Ok(0) | Err(_) => return discarded,
            Ok(read) => {
                if discard.last() == Some(&b'\n') {
                    // Reached the newline; the next line starts clean. Nothing
                    // but the delimiter, `\n` or the `\r\n` whose `\r` fell
                    // past the cap, means the line ended exactly at the cap
                    // with none of its content lost.
                    let delimiter = if discard.ends_with(b"\r\n") { 2 } else { 1 };
                    return discarded || read > delimiter;
                }
                discarded = true;
            }
        }
    }
}

/// Drain one of the child's pipes onto the event bus, a line at a time, until
/// it closes.
fn spawn_reader<R: Read + Send + 'static>(
    app: AppHandle,
    stream: &'static str,
    source: R,
) -> std::io::Result<std::thread::JoinHandle<()>> {
    std::thread::Builder::new()
        .name(format!("build-{stream}"))
        .spawn(move || {
            // Looked up once: this is a type-keyed map lookup, and there is one
            // of these per line of build output.
            let manager = app.state::<BuildManager>();
            let mut reader = BufReader::new(source);
            while let Some(text) = read_capped_line(&mut reader) {
                let event = {
                    let Ok(mut guard) = manager.active.lock() else {
                        break;
                    };
                    match guard.as_mut() {
                        Some(active) => BuildOutput {
                            build_id: active.build_id,
                            line: active.buffer.push(stream, text),
                        },
                        // Unreachable: nothing puts the state back to None
                        // while a build has readers attached. If that ever
                        // changes, breaking here stops draining the pipe and
                        // hangs the child on its next write — the failure the
                        // capped reader exists to avoid.
                        None => break,
                    }
                };
                let _ = app.emit(BUILD_OUTPUT_EVENT, &event);
            }
        })
}

/// Reap the finished child and announce how the build ended.
///
/// Called from the waiter thread once both readers have reported EOF.
fn finish(app: &AppHandle) {
    let manager = app.state::<BuildManager>();
    let child = {
        let Ok(mut guard) = manager.active.lock() else {
            return;
        };
        let Some(active) = guard.as_mut() else {
            return;
        };
        active.child.take()
    };

    // Waiting happens with the lock released. Sync commands run on the main
    // thread, so `get_build_state` and `cancel_build` queue behind this mutex:
    // a child that closes its output before a long last phase would freeze the
    // window for the whole of it, with Cancel unavailable exactly when the user
    // reaches for it.
    let code = child
        .and_then(|mut c| c.wait().ok())
        .and_then(|status| status.code());

    // The build is still Running here, and `start_build` refuses while a build
    // is running, so nothing can have replaced the state in the gap above.
    let done = {
        let Ok(mut guard) = manager.active.lock() else {
            return;
        };
        let Some(active) = guard.as_mut() else {
            return;
        };
        active.exit_code = code;
        active.status = final_status(active.cancel_requested, code);
        BuildDone {
            build_id: active.build_id,
            status: active.status,
            tag: active.tag.clone(),
            exit_code: code,
        }
    };
    let _ = app.emit(BUILD_DONE_EVENT, &done);
}

/// Kill the running build. Returns once the signal is away, not once the
/// process is gone: the terminal status still arrives as [`BUILD_DONE_EVENT`],
/// and it will be `Succeeded` if the build beat the signal.
#[tauri::command]
pub fn cancel_build(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<BuildManager>();
    let mut guard = manager
        .active
        .lock()
        .map_err(|_| "Build state is poisoned.")?;
    let Some(active) = guard.as_mut() else {
        return Err("No build is running.".to_string());
    };
    if active.status != BuildStatus::Running {
        return Err("No build is running.".to_string());
    }
    let Some(child) = active.child.as_mut() else {
        // Still Running but the child is gone means `finish` has it and is
        // reaping: the process has already exited and its status is decided,
        // so there is nothing left to signal.
        return Err("The build has already finished.".to_string());
    };
    child
        .kill()
        .map_err(|e| format!("Could not stop the build: {e}"))?;
    // Recorded only once the signal is away. Setting it first and then failing
    // the kill reports the build as cancelled to the user who was just told it
    // could not be stopped, while it runs on to completion.
    active.cancel_requested = true;
    Ok(())
}

/// The whole build state in one call, for a pane that has just opened or has
/// been away. Everything in it is read under one lock, so the transcript and
/// the `next_seq` that dedupes it against live events always agree.
#[tauri::command]
pub fn get_build_state(app: AppHandle) -> Result<BuildStateDto, String> {
    let manager = app.state::<BuildManager>();
    let guard = manager
        .active
        .lock()
        .map_err(|_| "Build state is poisoned.")?;
    Ok(match guard.as_ref() {
        Some(active) => BuildStateDto {
            build_id: active.build_id,
            status: active.status,
            tag: active.tag.clone(),
            exit_code: active.exit_code,
            lines: active.buffer.snapshot(),
            next_seq: active.buffer.next_seq(),
            dropped: active.buffer.dropped(),
        },
        None => BuildStateDto {
            build_id: 0,
            status: BuildStatus::Idle,
            tag: String::new(),
            exit_code: None,
            lines: Vec::new(),
            next_seq: 0,
            dropped: 0,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequence_numbers_are_monotonic_across_both_streams() {
        let mut buf = OutputBuffer::default();
        let r0 = buf.push("stdout", "one".into());
        let r1 = buf.push("stderr", "two".into());
        let r2 = buf.push("stdout", "three".into());
        assert_eq!(r0.seq, 0);
        assert_eq!(r1.seq, 1);
        assert_eq!(r2.seq, 2);
        assert_eq!(buf.next_seq(), 3);
        // The returned entry must match what the snapshot stores; if they
        // diverge, live stderr renders correctly but every stderr line replayed
        // from a snapshot comes back as stdout, silently dropping error
        // highlighting across the whole transcript.
        let snapshot = buf.snapshot();
        assert_eq!(snapshot[1].stream, "stderr");
        assert_eq!(snapshot[0].seq, r0.seq);
        assert_eq!(snapshot[1].seq, r1.seq);
        assert_eq!(snapshot[2].seq, r2.seq);
    }

    #[test]
    fn the_buffer_keeps_the_most_recent_lines() {
        let mut buf = OutputBuffer::default();
        for i in 0..(MAX_LINES + 10) {
            buf.push("stdout", format!("line {i}"));
        }
        let snapshot = buf.snapshot();
        assert_eq!(snapshot.len(), MAX_LINES);
        assert_eq!(snapshot[0].line, "line 10");
        assert_eq!(buf.dropped(), 10);
        // The first surviving line's seq must equal the number dropped so the
        // frontend can detect any gap: if snapshot[0].seq > dropped, events are
        // missing without a visible discontinuity in the transcript.
        assert_eq!(snapshot[0].seq, buf.dropped());
    }

    // Dropping lines silently would make a truncated transcript look complete,
    // so the count is part of the state the pane reads.
    #[test]
    fn nothing_is_reported_dropped_below_the_cap() {
        let mut buf = OutputBuffer::default();
        buf.push("stdout", "only".into());
        assert_eq!(buf.dropped(), 0);
    }

    #[test]
    fn a_clean_exit_succeeds_and_anything_else_fails() {
        assert_eq!(final_status(false, Some(0)), BuildStatus::Succeeded);
        assert_eq!(final_status(false, Some(1)), BuildStatus::Failed);
        assert_eq!(final_status(false, None), BuildStatus::Failed);
    }

    // A killed process exits non-zero, so without the flag every cancel would
    // be reported to the user as a build failure.
    #[test]
    fn a_requested_cancel_outranks_the_exit_code() {
        assert_eq!(final_status(true, Some(1)), BuildStatus::Cancelled);
        assert_eq!(final_status(true, None), BuildStatus::Cancelled);
    }

    // Cancel and success are not exclusive: the build can finish while the
    // cancel is still in flight, and killing a process that has exited but not
    // been reaped still succeeds. A kill leaves no exit code at all, so a clean
    // zero here can only mean the build completed. Reporting that as Cancelled
    // tells the user nothing was built while the tagged image sits in
    // `image ls`, so they never go looking for it.
    #[test]
    fn a_build_that_finished_before_the_cancel_landed_still_succeeded() {
        assert_eq!(final_status(true, Some(0)), BuildStatus::Succeeded);
    }
}
