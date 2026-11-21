"use client";

import { useState } from "react";
import { secondaryButtonClass } from "@/components/form";

/** Copies the link to the clipboard and says so. Falls back to telling the person to select it by hand. */
export function CopyButton({ text }: { text: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied.");
    } catch {
      setMessage("Could not copy. Select the link and copy it by hand.");
    }
    setTimeout(() => setMessage(""), 3000);
  }
  return (
    <>
      <button type="button" onClick={copy} className={secondaryButtonClass}>
        Copy link
      </button>
      <span role="status" className="text-sm text-charcoal/70">
        {message}
      </span>
    </>
  );
}
