//! Running a build and holding its state while it runs.
//!
//! This is the only place in the app with a live child process. The pieces
//! worth testing on their own, the ring buffer and the exit-status decision,
//! are plain values with no process behind them.

use serde::Serialize;
use std::collections::VecDeque;

/// Enough to read a long build back, small enough to bound memory on one that
/// prints without restraint.
pub const MAX_LINES: usize = 5000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildLine {
    pub seq: u64,
    pub stream: &'static str,
    pub line: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildStatus {
    Idle,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

/// A kill makes the process exit non-zero, so a cancel that was asked for has
/// to outrank the code the child reports.
pub fn final_status(cancel_requested: bool, exit_code: Option<i32>) -> BuildStatus {
    if cancel_requested {
        BuildStatus::Cancelled
    } else if exit_code == Some(0) {
        BuildStatus::Succeeded
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

    pub fn snapshot(&self) -> Vec<BuildLine> {
        self.lines.iter().cloned().collect()
    }

    pub fn next_seq(&self) -> u64 {
        self.next_seq
    }

    pub fn dropped(&self) -> u64 {
        self.dropped
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequence_numbers_are_monotonic_across_both_streams() {
        let mut buf = OutputBuffer::default();
        assert_eq!(buf.push("stdout", "one".into()).seq, 0);
        assert_eq!(buf.push("stderr", "two".into()).seq, 1);
        assert_eq!(buf.push("stdout", "three".into()).seq, 2);
        assert_eq!(buf.next_seq(), 3);
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
}
