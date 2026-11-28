"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button for a server-action form rendered by a server page. It disables itself and shows
 * `pendingLabel` while the form is being sent, so a second press cannot start a second run or issue.
 */
export function PendingButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
