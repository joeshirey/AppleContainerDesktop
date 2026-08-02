/// A CPU count the backend can actually use, or undefined when the field is
/// blank.
///
/// Everything else has to be caught here rather than sent. `Number("abc")` is
/// NaN, which serialises to JSON `null` and reaches the backend as "unset", so
/// the build would quietly run at the default allocation. A negative or
/// fractional count survives JSON intact and dies in serde instead, putting a
/// raw deserialiser string in front of the user.
export function positiveInt(value: string): number | undefined {
  const text = value.trim();
  if (text === "") return undefined;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export const CPUS_INVALID = "Builder CPUs must be a whole number of 1 or more.";

/// What to tell the user about the CPUs field, or null when there is nothing to
/// say and the value is safe to send.
///
/// Blank is not an error: it means the CLI picks the allocation. That is the
/// half worth keeping in one place — written out at each call site, one of them
/// eventually reads a blank field as invalid and blocks the user from starting
/// anything until they name a number the CLI would have chosen anyway.
export function validateCpus(cpus: string): string | null {
  return cpus.trim() !== "" && positiveInt(cpus) === undefined ? CPUS_INVALID : null;
}
