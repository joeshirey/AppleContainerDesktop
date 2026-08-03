/// What to show the user when a call failed.
///
/// A Tauri command that returns `Err(String)` rejects with that string rather
/// than an Error, and `open` from the dialog plugin rejects with an Error, so
/// both shapes reach the same catch blocks. `String(e)` alone turns the Error
/// case into "Error: …" with the prefix showing.
///
/// Its own module rather than a fourth export from `validation`: that one is
/// about whether input can be sent, and a view that only wants to render a
/// rejection should not have to import a module named for the other question.
export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
