import { useState } from "react";
import { api } from "./api.ts";
import { useAction, useResource, Dialog } from "./ui.tsx";
import {
  ChatPackageSchema,
  type ChatPackage,
} from "../../shared/chat-import.ts";

export function ChatImportPanel({ changed }: { changed: () => void }) {
  const { data } = useResource<any>("/chat-import/config", 15000);
  const [open, setOpen] = useState(false);
  return (
    <section className="k-panel">
      <h2>מתכונים מהצ׳אט ומ־Drive</h2>
      <p>
        לאוסף גדול: מעלים לתיקיית התמונות וכותבים בשיחה הקבועה „עבד את התמונות
        החדשות”. ביום־יום אפשר לשלוח תמונות בשיחה עצמה.
      </p>
      <p className="k-note">
        הצ׳אט קורא את התמונות במסגרת המנוי שלך. כאן נשמרים המקורות והטיוטות;
        הנתונים והסיווג ממתינים לאישורך. אין קריאת AI בתשלום בייבוא הזה.
      </p>
      <div className="k-actions">
        {data?.drive?.incoming && (
          <a
            className="button primary"
            href={
              "https://drive.google.com/drive/folders/" + data.drive.incoming
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            תיקיית התמונות שלי ב־Drive
          </a>
        )}
        <button className="button outline" onClick={() => setOpen(true)}>
          ייבוא חבילה מהצ׳אט
        </button>
      </div>
      {data?.summary?.length > 0 && (
        <p>
          נקלטו מהצ׳אט: {data.summary.reduce((n: number, r: any) => n + r.n, 0)}{" "}
          טיוטות ומתכונים.
        </p>
      )}
      {open && (
        <ChatPackageDialog close={() => setOpen(false)} changed={changed} />
      )}
    </section>
  );
}

function ChatPackageDialog({
  close,
  changed,
}: {
  close: () => void;
  changed: () => void;
}) {
  const [bundle, setBundle] = useState<ChatPackage | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState("");
  const { run, busy, notify } = useAction();
  return (
    <Dialog title="חבילה מהצ׳אט לטיוטות" close={close}>
      <p>
        אפשרות ידנית כאשר ההעברה הישירה מהשיחה אינה זמינה: בוחרים את קובץ ה־JSON
        שהצ׳אט הכין ואת תמונות המקור. קובץ JSON לבדו אינו מחליף מקור קריא.
      </p>
      <label>
        קובץ החבילה מהצ׳אט
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void run(async () => {
              if (file.size > 3 * 1024 * 1024)
                throw Error("יש לפצל לחבילות JSON עד 3MB");
              const parsed = ChatPackageSchema.safeParse(
                JSON.parse(await file.text()),
              );
              if (!parsed.success)
                throw Error(
                  "מבנה החבילה אינו תקין; יש לבקש מהצ׳אט חבילת my-kitchen-chat-import בגרסה 1",
                );
              setBundle(parsed.data);
            });
          }}
        />
      </label>
      {bundle && (
        <p>
          {bundle.items.length} מתכונים ו־{bundle.sources.length} תמונות מקור
          בחבילה.
        </p>
      )}
      <label>
        תמונות המקור של החבילה
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(e) => setFiles([...(e.target.files || [])])}
        />
      </label>
      <p className="k-note">
        ניסיון חוזר לא ידרוס תיקון ולא ייצור עותק נוסף. במקרה של סגירת הדפדפן,
        בוחרים שוב את אותה חבילה ותמונות; מה שהגיע לשרת נשמר.
      </p>
      <button
        className="button primary"
        disabled={busy || !bundle}
        onClick={() =>
          void run(async () => {
            if (!bundle) return;
            const state = await api("/chat-intake/status", "POST", {
              keys: bundle.sources.map((s) => s.key),
            });
            let done = 0;
            for (const source of bundle.sources) {
              const existing = state.sources.find(
                (s: any) => s.source_key === source.key,
              );
              if (existing) {
                if (
                  existing.digest !== source.sha256 ||
                  existing.provider !== source.provider ||
                  existing.external_id !== source.external_id
                )
                  throw Error("מזהה מקור שייך לקובץ אחר; לא יוחלף מקור קיים");
              } else {
                const matches = files.filter((f) => f.name === source.filename);
                if (matches.length !== 1)
                  throw Error("יש לבחור מקור יחיד בשם " + source.filename);
                const file = matches[0];
                const sum = [
                  ...new Uint8Array(
                    await crypto.subtle.digest(
                      "SHA-256",
                      await file.arrayBuffer(),
                    ),
                  ),
                ]
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
                if (sum !== source.sha256)
                  throw Error(
                    "תמונת המקור אינה תואמת לחבילה: " + source.filename,
                  );
                const form = new FormData();
                form.append("source", JSON.stringify(source));
                form.append("file", file);
                const response = await fetch("/api/chat-intake/sources", {
                  method: "POST",
                  body: form,
                  credentials: "same-origin",
                });
                const result = await response.json();
                if (!response.ok) throw Error(result.error || "המקור לא נשמר");
              }
              setProgress(
                "מקורות שנשמרו: " + ++done + " מתוך " + bundle.sources.length,
              );
            }
            let created = 0;
            for (const item of bundle.items) {
              const result = await api("/chat-intake/drafts", "POST", {
                processor: bundle.processor,
                item,
              });
              if (!result.duplicate) created++;
              setProgress("הטיוטה נקלטה: " + item.content.title);
            }
            changed();
            notify(
              created
                ? `נקלטו ${created} טיוטות חדשות לבדיקתך`
                : "החבילה כבר נקלטה; הנתונים הקיימים נשמרו",
            );
            close();
          })
        }
      >
        {busy ? "שומר בשרת…" : "ייבוא לטיוטות"}
      </button>
      {progress && <p role="status">{progress}</p>}
    </Dialog>
  );
}
