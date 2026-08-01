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
