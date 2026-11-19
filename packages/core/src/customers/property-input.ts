/** The label field is prefilled on the add-customer form, so an untouched form already has it. */
const PREFILLED_LABEL = "Main property";

/**
 * True when any `prefix`-ed field holds something the person typed or chose. Blank fields, empty
 * selects and the prefilled "Main property" label do not count. The add-customer form uses this
 * to decide whether a property was meant, so details are never dropped silently when only the
 * street was left empty.
 */
export function hasPropertyInput(values: Record<string, string>, prefix: string): boolean {
  return Object.entries(values).some(([key, value]) => {
    if (!key.startsWith(prefix)) return false;
    const text = value.trim();
    if (!text) return false;
    return !(key === `${prefix}label` && text === PREFILLED_LABEL);
  });
}
