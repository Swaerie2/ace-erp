import { inputClass } from "./auth-card";

export const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-full border border-forest/30 px-5 py-2.5 font-display text-sm font-semibold text-forest transition-colors hover:bg-forest hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest";

type Common = {
  label: string;
  name: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
};

function Wrap({
  label,
  required,
  hint,
  error,
  children,
}: Omit<Common, "name"> & { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-charcoal">
      {label}
      {required ? (
        <span aria-hidden="true" className="text-ochre">
          {" "}
          *
        </span>
      ) : null}
      {children}
      {hint ? (
        <span className="mt-1 block text-xs font-normal text-charcoal/60">{hint}</span>
      ) : null}
      {error ? (
        <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function TextField({
  type = "text",
  defaultValue,
  inputMode,
  autoComplete,
  autoFocus,
  ...common
}: Common & {
  type?: string;
  defaultValue?: string | undefined;
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal" | "url";
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <Wrap {...common}>
      <input
        name={common.name}
        type={type}
        defaultValue={defaultValue}
        required={common.required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={common.error ? true : undefined}
        className={inputClass}
      />
    </Wrap>
  );
}

export function TextAreaField({
  defaultValue,
  rows = 3,
  ...common
}: Common & { defaultValue?: string | undefined; rows?: number }) {
  return (
    <Wrap {...common}>
      <textarea
        name={common.name}
        defaultValue={defaultValue}
        rows={rows}
        aria-invalid={common.error ? true : undefined}
        className={inputClass}
      />
    </Wrap>
  );
}

export function SelectField({
  options,
  defaultValue,
  ...common
}: Common & {
  options: readonly { value: string; label: string }[];
  defaultValue?: string | undefined;
}) {
  return (
    <Wrap {...common}>
      <select
        name={common.name}
        defaultValue={defaultValue ?? ""}
        required={common.required}
        aria-invalid={common.error ? true : undefined}
        className={inputClass}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrap>
  );
}

export function CheckboxField({
  label,
  name,
  defaultChecked,
  hint,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-3 text-sm text-charcoal">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-1 h-4 w-4 rounded border-charcoal/30 text-forest focus:ring-forest/30"
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-charcoal/60">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FormMessage({ error }: { error?: string | undefined }) {
  return error ? (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
    >
      {error}
    </p>
  ) : null;
}
