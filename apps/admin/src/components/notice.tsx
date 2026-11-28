export type NoticeText = { text: string; ok: boolean };

/** Only a fixed code arrives in the address bar; anything unknown shows nothing. */
export function noticeFor(
  code: string | undefined,
  table: Record<string, NoticeText>,
): NoticeText | null {
  if (!code || !Object.hasOwn(table, code)) return null;
  return table[code] ?? null;
}

export function Notice({ notice }: { notice: NoticeText | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.ok ? "status" : "alert"}
      className={`rounded-lg px-3 py-2 text-sm ring-1 ${notice.ok ? "bg-forest/10 text-forest ring-forest/25" : "bg-red-50 text-red-800 ring-red-200"}`}
    >
      {notice.text}
    </p>
  );
}
