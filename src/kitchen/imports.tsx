import { useEffect, useRef, useState } from "react";
import { Camera, Upload, Check, ArrowUp, ArrowDown } from "lucide-react";
import { api, go, upload, mediaUrl } from "./api.ts";
import {
  useResource,
  useAction,
  PageTitle,
  LoadState,
  MediaImage,
  Dialog,
} from "./ui.tsx";
import { ContentEditor } from "./editor.tsx";
import { amountText } from "../../shared/quantities.ts";
import { emptyRecipe, type RecipeContent } from "../../shared/model.ts";
import { ChatImportPanel } from "./chat-import.tsx";
const statuses: Record<string, string> = {
  queued: "ממתין לעיבוד",
  processing: "מעבד",
  waiting_ai: "ממתין לחיבור AI",
  needs_review: "דורש תיקון",
  waiting_classification: "ממתין לסיווג",
  ready: "מוכן לאישור",
  saved: "נשמר",
  failed: "נכשל",
};
export function Imports() {
  const { data, error, loading, reload } = useResource<any>("/imports", 4000);
  const settings = useResource<any>("/settings");
  const limits = settings.data?.limits;
  const { run, busy, notify } = useAction();
  const [uploads, setUploads] = useState<{ name: string; status: string }[]>(
      [],
    ),
    [review, setReview] = useState<any>(null),
    [selected, setSelected] = useState<string[]>([]),
    [paths, setPaths] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<any>(null),
    [offset, setOffset] = useState(0);
  const page = useResource<any>(
    offset ? "/imports?offset=" + offset : null,
    4000,
  );
  const view = offset ? page.data : data;
  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const chosen = [...files];
    setUploads(chosen.map((f) => ({ name: f.name, status: "ממתין להעלאה" })));
    let cursor = 0;
    const next = async () => {
      while (cursor < chosen.length) {
        const index = cursor++;
        setUploads((p) =>
          p.map((r, i) => (i === index ? { ...r, status: "מעלה…" } : r)),
        );
        try {
          const result = await upload(chosen[index], "/imports/upload");
          setUploads((p) =>
            p.map((r, i) =>
              i === index
                ? {
                    ...r,
                    status: result.duplicate
                      ? "קובץ זהה כבר נמצא בתור או במאגר"
                      : "הועלה ונשמר בשרת",
                  }
                : r,
            ),
          );
          reload();
        } catch (e) {
          setUploads((p) =>
            p.map((r, i) =>
              i === index
                ? { ...r, status: "נכשל: " + (e as Error).message }
                : r,
            ),
          );
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(limits?.upload_concurrency ?? 1, chosen.length) },
        next,
      ),
    );
  }
  function pathFor(item: any) {
    return (
      paths[item.id] ??
      (item.suggestions?.manual_paths ?? item.suggestions?.paths)
        ?.map((p: string[]) => p.join(" / "))
        .join("\n") ??
      ""
    );
  }
  return (
    <>
      <PageTitle
        title="מתמונות לספר מתכונים"
        subtitle="המקור נשמר. הבדיקה והאישור תמיד בידיים שלך."
        back={() => go("/recipes")}
      />
      <ChatImportPanel
        changed={() => {
          reload();
          page.reload();
        }}
      />
      <section className="k-upload-panel">
        <Camera size={36} strokeWidth={1.3} />
        <h2>מה אספת למטבח שלך?</h2>
        <p>
          תמונה אחת מועמדת למתכון אחד. אפשר לקבץ צילומים של אותו מתכון בהמשך.
        </p>
        {settings.data && !settings.data.ai.configured && (
          <p className="k-note">
            במסלול הצ׳אט שלך שולחים תמונות בשיחה או לתיקיית Drive שלמעלה. העלאה
            ישירה כאן שומרת מקור, אך קריאה אוטומטית שלו בשרת ממתינה לחיבור AI
            נפרד.
          </p>
        )}
        <div className="k-actions">
          <label className="button primary k-file-button">
            <Camera size={18} /> צילום
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                void uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className="button outline k-file-button">
            <Upload size={18} /> בחירת תמונות רבות
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                void uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <small>
          {limits
            ? `עד ${limits.image_mb}MB לתמונה. עד ${limits.upload_concurrency} העלאות במקביל. `
            : "מגבלות הקבצים נטענות מהשרת. "}
          קבצים שטרם הועלו עשויים לדרוש בחירה מחדש אחרי סגירת הדפדפן. לאחר
          העלאה, התור נשמר בשרת.
        </small>
        {settings.data?.hosting?.notice && (
          <p className="k-note">{settings.data.hosting.notice}</p>
        )}
      </section>
      {uploads.length > 0 && (
        <details className="k-panel" open>
          <summary>
            העלאה:{" "}
            {
              uploads.filter(
                (u) =>
                  u.status.startsWith("הועלה") ||
                  u.status.startsWith("קובץ זהה"),
              ).length
            }{" "}
            מתוך {uploads.length}
          </summary>
          <ul>
            {uploads.map((u, i) => (
              <li key={i}>
                {u.name} — {u.status}
              </li>
            ))}
          </ul>
          <p>
            להעלאה חוזרת של קובץ שנכשל, בוחרים אותו שוב. חתימת הקובץ מונעת
            כפילות מדויקת.
          </p>
        </details>
      )}
      <LoadState loading={loading} error={error} retry={reload} />
      <div className="k-summary">
        {view?.summary
          .filter((s: any) => s.status !== "merged")
          .map((s: any) => (
            <span key={s.status}>
              {statuses[s.status] || s.status}: {s.n}
            </span>
          ))}
      </div>
      <div className="k-actions">
        <button
          className="button outline"
          disabled={busy || selected.length < 2}
          onClick={() =>
            run(async () => {
              const items = view.items.filter((i: any) =>
                selected.includes(i.id),
              );
              await api("/imports/group", "POST", {
                item_ids: selected,
                media_order: items.flatMap((i: any) =>
                  i.media.map((m: any) => m.id),
                ),
              });
              setSelected([]);
              reload();
              page.reload();
              notify("התמונות קובצו. הצעת החילוץ החדשה תמתין לבדיקתך.");
            })
          }
        >
          איחוד הצילומים שנבחרו למתכון אחד
        </button>
        <button
          className="button primary"
          disabled={busy || !selected.length}
          onClick={() =>
            run(async () => {
              const items = view.items
                .filter(
                  (i: any) => selected.includes(i.id) && i.status !== "saved",
                )
                .map((i: any) => ({
                  id: i.id,
                  revision: i.revision,
                  content: i.draft,
                  paths: pathFor(i)
                    .split("\n")
                    .filter(Boolean)
                    .map((p: string) =>
                      p.split("/").map((s: string) => s.trim()),
                    ),
                }));
              if (items.some((i: any) => !i.content || !i.paths.length))
                throw Error("לכל פריט נדרשים נתונים ומסלול קטגוריה לפני אישור");
              const result = await api("/categories/preview", "POST", {
                paths: items.flatMap((i: any) => i.paths),
              });
              setPreview({ ...result, items });
            })
          }
        >
          בדיקת סיווג ואישור אצווה ({selected.length})
        </button>
      </div>
      <div className="k-import-list">
        {view?.items.map((item: any) => (
          <article className="k-import-row" key={item.id}>
            <div className="k-import-select">
              <input
                type="checkbox"
                aria-label={"בחירת " + (item.draft?.title || "פריט ייבוא")}
                disabled={["saved", "processing"].includes(item.status)}
                checked={selected.includes(item.id)}
                onChange={() => {
                  setSelected((p) =>
                    p.includes(item.id)
                      ? p.filter((id) => id !== item.id)
                      : [...p, item.id],
                  );
                  setPreview(null);
                }}
              />
              <div className="k-source-thumbs">
                {item.media.map((m: any) => (
                  <button
                    key={m.id}
                    aria-label="פתיחת תמונת מקור"
                    onClick={() =>
                      window.open(
                        mediaUrl(m.id, "original"),
                        "_blank",
                        "noopener",
                      )
                    }
                  >
                    <MediaImage key={m.id + ":" + m.state} id={m.id} />
                  </button>
                ))}
              </div>
            </div>
            <div className="k-import-copy">
              <h2>{item.draft?.title || "מתכון מתמונה"}</h2>
              <span className="k-status">
                {statuses[item.status] || item.status}
              </span>
              {item.error && <p className="k-alert">{item.error}</p>}
              {item.suggestions?.reason && (
                <p className="k-note">הצעת AI: {item.suggestions.reason}</p>
              )}
              {item.suggestions?.possible_duplicates?.length > 0 && (
                <div className="k-note">
                  ייתכן שיש תוכן דומה בספר:{" "}
                  {item.suggestions.possible_duplicates.map((r: any) => (
                    <button
                      className="k-text"
                      key={r.id}
                      onClick={() => go("/recipes/" + r.id)}
                    >
                      {r.title}
                    </button>
                  ))}
                  . לא נמחק או אוחד דבר אוטומטית.
                </div>
              )}
              {item.draft?.split_suggestion && (
                <p className="k-alert">
                  ייתכן שנדרש פיצול: {item.draft.split_suggestion}
                </p>
              )}
              {item.status !== "saved" && (
                <label>
                  מסלולי קטגוריות מוצעים — כל מסלול בשורה
                  <textarea
                    value={pathFor(item)}
                    onChange={(e) => {
                      setPaths({ ...paths, [item.id]: e.target.value });
                      setPreview(null);
                    }}
                    onBlur={(e) => {
                      const value = e.currentTarget.value;
                      void run(async () => {
                        await api(
                          `/imports/${item.id}/classification`,
                          "PATCH",
                          {
                            paths: value
                              .split("\n")
                              .filter(Boolean)
                              .map((p) => p.split("/").map((s) => s.trim())),
                          },
                        );
                        reload();
                        page.reload();
                      });
                    }}
                    placeholder="בישול / תוספות"
                  />
                </label>
              )}
              <div className="k-actions">
                {item.status === "saved" ? (
                  <button
                    className="button outline"
                    onClick={() => go("/recipes/" + item.recipe_id)}
                  >
                    פתיחת המתכון שנשמר
                  </button>
                ) : (
                  <>
                    <button
                      className="button outline"
                      onClick={() => setReview(item)}
                    >
                      בדיקת נתונים, מקור ותיקון
                    </button>
                    <button
                      className="k-text"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(`/imports/${item.id}/rescan`, "POST", {});
                          reload();
                          page.reload();
                        })
                      }
                    >
                      סריקה נוספת להשוואה
                    </button>
                    <button
                      className="k-text"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(`/imports/${item.id}/split`, "POST", {});
                          reload();
                          page.reload();
                          notify(
                            "נוצרה טיוטה נוספת עם אותם מקורות. יש למלא ולסווג כל מתכון בנפרד.",
                          );
                        })
                      }
                    >
                      פיצול לטיוטה נוספת
                    </button>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="k-pagination">
        <button
          className="button outline"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          הקודמים
        </button>
        <span>
          {offset + 1}–{Math.min(offset + 50, view?.total ?? 0)} מתוך{" "}
          {view?.total ?? 0}
        </span>
        <button
          className="button outline"
          disabled={offset + 50 >= (view?.total ?? 0)}
          onClick={() => setOffset(offset + 50)}
        >
          הבאים
        </button>
      </div>
      {preview && (
        <Dialog title="אישור סיווג האצווה" close={() => setPreview(null)}>
          <p className="k-note">
            {preview.new_images} תמונות קטגוריה חדשות יתווספו לתור בעקבות
            האישור. אם AI אינו זמין, הקטגוריות והמתכונים יישמרו והתמונות ימתינו.
          </p>
          {preview.items.map((i: any) => (
            <div className="k-panel" key={i.id}>
              <strong>{i.content.title}</strong>
              <p>{i.paths.map((p: string[]) => p.join(" ← ")).join(" · ")}</p>
            </div>
          ))}
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("/imports/approve", "POST", {
                  confirmed: true,
                  expected_new_images: preview.new_images,
                  items: preview.items,
                });
                setPreview(null);
                setSelected([]);
                reload();
                page.reload();
                notify("המתכונים וסיווגיהם אושרו ונשמרו בשרת");
              })
            }
          >
            <Check size={16} /> אישור ההצעות ושמירת המתכונים
          </button>
          <button className="button outline" onClick={() => setPreview(null)}>
            חזרה לשינוי לפני אישור
          </button>
        </Dialog>
      )}
      {review && (
        <ImportReview
          key={review.id}
          item={review}
          close={() => {
            setReview(null);
            reload();
            page.reload();
          }}
        />
      )}
    </>
  );
}
function ImportReview({ item, close }: { item: any; close: () => void }) {
  const [draft, setDraft] = useState<RecipeContent>(
      item.draft ?? emptyRecipe(),
    ),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [order, setOrder] = useState<string[]>(item.media.map((m: any) => m.id)),
    [showCandidate, setShowCandidate] = useState(false),
    [crop, setCrop] = useState({ left: 0, top: 0, width: 500, height: 500 }),
    [cropMedia, setCropMedia] = useState(item.media[0]?.id ?? "");
  const revision = useRef(item.revision),
    pending = useRef<RecipeContent | null>(null),
    working = useRef(false),
    mounted = useRef(true);
  const { run, busy, notify } = useAction();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function flush() {
    if (working.current || !pending.current) return;
    working.current = true;
    setSaving(true);
    try {
      while (pending.current) {
        const snapshot = pending.current;
        pending.current = null;
        try {
          const result = await api(`/imports/${item.id}`, "PUT", {
            revision: revision.current,
            draft: snapshot,
          });
          revision.current = result.revision;
          if (mounted.current) setSaveError("");
        } catch (e) {
          pending.current ??= snapshot;
          throw e;
        }
      }
    } catch (e) {
      if (mounted.current) setSaveError((e as Error).message);
    } finally {
      working.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  function change(next: RecipeContent) {
    setDraft(next);
    pending.current = next;
    void flush();
  }
  return (
    <Dialog
      title="בודקים מול המקור"
      close={() => {
        if (saving || pending.current) {
          notify(
            "יש להמתין לשמירת הטיוטה או לפתור את שגיאת השמירה לפני היציאה",
          );
          return;
        }
        close();
      }}
    >
      <p className="k-note" role="status">
        {saving
          ? "שומר טיוטה בשרת…"
          : saveError
            ? "השמירה לא הושלמה"
            : "הטיוטה שמורה בשרת. שינויים נשמרים אוטומטית."}
      </p>
      {saveError && (
        <div className="k-alert">
          {saveError}
          <button className="button outline" onClick={() => void flush()}>
            ניסיון שמירה נוסף
          </button>
        </div>
      )}
      <div className="k-gallery">
        {order.map((mediaId, index) => (
          <figure key={mediaId}>
            <button
              onClick={() =>
                window.open(mediaUrl(mediaId, "original"), "_blank", "noopener")
              }
            >
              <MediaImage id={mediaId} />
            </button>
            <figcaption>מקור {index + 1} · פתיחה בזום</figcaption>
            <div className="k-actions">
              <button
                aria-label="הקדמת מקור"
                disabled={!index}
                onClick={() =>
                  setOrder((p) => {
                    const out = [...p];
                    [out[index - 1], out[index]] = [out[index], out[index - 1]];
                    return out;
                  })
                }
              >
                <ArrowUp size={18} />
              </button>
              <button
                aria-label="דחיית מקור"
                disabled={index === order.length - 1}
                onClick={() =>
                  setOrder((p) => {
                    const out = [...p];
                    [out[index + 1], out[index]] = [out[index], out[index + 1]];
                    return out;
                  })
                }
              >
                <ArrowDown size={18} />
              </button>
            </div>
          </figure>
        ))}
      </div>
      <button
        className="button outline"
        disabled={busy || saving || !!saveError}
        onClick={() =>
          run(async () => {
            const result = await api(`/imports/${item.id}/order`, "PUT", {
              revision: revision.current,
              media_ids: order,
            });
            revision.current = result.revision;
            notify("סדר המקורות נשמר. לא הופעלה סריקת AI נוספת.");
          })
        }
      >
        שמירת סדר המקורות
      </button>
      {item.previous_draft && (
        <section className="k-panel">
          <h3>התקבלה תוצאת סריקה נוספת</h3>
          <p>התיקונים שלך לא נדרסו. אפשר להשוות ולבחור שדות להחלפה.</p>
          <button
            className="button outline"
            onClick={() => setShowCandidate(!showCandidate)}
          >
            הצגת ההבדלים
          </button>
          {showCandidate &&
            (
              [
                "title",
                "description",
                "classification",
                "tags",
                "source_name",
                "notes",
                "yield",
                "ingredients",
                "steps",
                "raw_text",
                "active_minutes",
                "total_minutes",
                "equipment",
              ] as const
            ).map((field) => (
              <details key={field}>
                <summary>
                  {field}{" "}
                  {JSON.stringify(draft[field]) ===
                  JSON.stringify(item.previous_draft[field])
                    ? "— ללא שינוי"
                    : "— שונה"}
                </summary>
                <div className="k-grid-2">
                  <div>
                    <strong>הטיוטה שלי</strong>
                    <DiffValue field={field} value={draft[field]} />
                  </div>
                  <div>
                    <strong>סריקה חדשה</strong>
                    <DiffValue
                      field={field}
                      value={item.previous_draft[field]}
                    />
                  </div>
                </div>
                <button
                  className="button outline"
                  onClick={() =>
                    change({ ...draft, [field]: item.previous_draft[field] })
                  }
                >
                  אישור החלפת שדה זה בלבד
                </button>
              </details>
            ))}
        </section>
      )}
      <ContentEditor value={draft} onChange={change} />
      <details className="k-panel">
        <summary>קריאה ממוקדת של אזור לא ברור</summary>
        <p>
          ניסיון AI נוסף לפי בקשתך, במסגרת מגבלת הקריאות. החיתוך אינו מוחק את
          המקור.
        </p>
        <label>
          תמונה
          <select
            value={cropMedia}
            onChange={(e) => setCropMedia(e.target.value)}
          >
            {order.map((id, i) => (
              <option key={id} value={id}>
                מקור {i + 1}
              </option>
            ))}
          </select>
        </label>
        <div className="k-grid-2">
          {Object.entries(crop).map(([k, v]) => (
            <label key={k}>
              {k}
              <input
                type="number"
                min="0"
                value={v}
                onChange={(e) =>
                  setCrop({ ...crop, [k]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <button
          className="button outline"
          disabled={busy || saving || !!saveError}
          onClick={() =>
            run(async () => {
              await api(`/imports/${item.id}/rescan`, "POST", {
                media_order: order,
                crop: { media_id: cropMedia, rect: crop },
              });
              notify("הסריקה נשלחה. התוצאה תוצג להשוואה ולא תדרוס את הטיוטה");
              close();
            })
          }
        >
          סריקה ממוקדת והשוואה
        </button>
      </details>
      <div className="k-save-bar">
        <button
          className="button primary"
          disabled={saving || !!saveError}
          onClick={close}
        >
          סיום הבדיקה — חזרה לסיווג ואישור
        </button>
      </div>
    </Dialog>
  );
}

function DiffValue({ field, value }: { field: string; value: any }) {
  if (value === null || value === "") return <p>לא צוין או לא נקרא</p>;
  if (field === "ingredients")
    return (
      <ul>
        {value.map((i: any, index: number) => (
          <li key={index}>
            {i.group && i.group + ": "}
            {amountText(i.amount)} {i.unit} {i.name} {i.note}
          </li>
        ))}
      </ul>
    );
  if (field === "steps")
    return (
      <ol>
        {value.map((s: any, index: number) => (
          <li key={index}>
            {s.group && s.group + ": "}
            {s.text}
          </li>
        ))}
      </ol>
    );
  if (field === "yield")
    return (
      <p>
        {value.amount} {value.unit} {value.pan}
      </p>
    );
  if (Array.isArray(value)) return <p>{value.join(", ")}</p>;
  return <p>{String(value)}</p>;
}
