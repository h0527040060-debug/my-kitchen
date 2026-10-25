import { InstallHelp, isAndroid } from "./install.tsx";
import { CategoryPicture } from "./categories.tsx";
import { useState } from "react";
import { api, go, upload, mediaUrl } from "./api.ts";
import {
  useAction,
  useResource,
  PageTitle,
  MediaImage,
  Dialog,
} from "./ui.tsx";
import { CategoryPicker } from "./editor.tsx";
import { AccountSettings } from "./account.tsx";
export function More() {
  const [account, setAccount] = useState(false),
    [installHelp, setInstallHelp] = useState(false);
  const { data, reload } = useResource<any>("/settings");
  const categories = useResource<any>("/categories", 5000);
  const cooking = useResource<any>("/cooking");
  const sources = useResource<any>("/sources");
  const { run, busy, notify } = useAction();
  const [category, setCategory] = useState<any>(null),
    [createCat, setCreateCat] = useState(false);

  const [packageWeights, setPackageWeights] = useState<string | null>(null);
  return (
    <>
      <PageTitle
        title="עוד קצת במטבח"
        subtitle="מצרכים בבית, קטגוריות, העדפות והיסטוריה."
      />
      <div className="k-actions">
        <a className="button outline" href="/designs">
          בחירה בין שלושה עיצובים
        </a>
        {isAndroid() && (
          <button
            className="button outline"
            onClick={() => setInstallHelp(true)}
          >
            התקנה במסך הבית
          </button>
        )}
        <button className="button outline" onClick={() => setAccount(true)}>
          ניהול החשבון
        </button>
        <button className="button primary" onClick={() => go("/pantry")}>
          מה יש לי בבית?
        </button>
        <button className="button outline" onClick={() => go("/imports")}>
          תור הייבוא
        </button>
        <button
          className="button outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const data = await api("/export");
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "my-kitchen-export.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              notify(
                "הייצוא הוכן. לגיבוי קבצי המדיה עצמם יש להשתמש בפקודת הגיבוי בשרת.",
              );
            })
          }
        >
          ייצוא נתונים והפניות מדיה
        </button>
      </div>
      <section className="k-panel">
        <div className="k-subtitle">
          <h2>עץ הקטגוריות שלי</h2>
          <button
            className="button outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("/categories/starter", "POST", { confirmed: true });
                categories.reload();
                notify("עץ הקטגוריות הושלם ותמונות הנושא בתור");
              })
            }
          >
            השלמת עץ הקטגוריות
          </button>
          <button className="button outline" onClick={() => setCreateCat(true)}>
            קטגוריה חדשה
          </button>
        </div>
        <p className="k-note">
          קטגוריה נוצרת רק באישור. תמונת נושא אחת מתווספת אוטומטית לתור; תמונה
          שבחרת ידנית לא תידרס.
        </p>
        <div className="k-category-grid">
          {categories.data?.items.map((c: any) => (
            <button key={c.id} onClick={() => setCategory(c)}>
              <CategoryPicture
                category={c}
                all={categories.data?.items ?? []}
              />
              <span>{c.name}</span>
              <small>
                {c.media_id
                  ? c.manual_image
                    ? "תמונה אישית"
                    : "תמונת המחשה AI"
                  : "תמונת המחשה AI"}
              </small>
            </button>
          ))}
        </div>
      </section>

      <section className="k-panel">
        <h2>מידות והעדפות</h2>
        {data && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                await api("/settings", "PUT", {
                  ai_daily_limit: 0,
                  cup_ml: f.get("cup") ? Number(f.get("cup")) : null,
                  package_weights:
                    packageWeights === null
                      ? (data.preferences.package_weights ?? {})
                      : Object.fromEntries(
                          packageWeights
                            .split("\n")
                            .filter(Boolean)
                            .map((line) => {
                              const [name, weight] = line.split("=");
                              if (
                                !name?.trim() ||
                                !Number.isFinite(Number(weight)) ||
                                Number(weight) <= 0
                              )
                                throw Error(
                                  "יש להזין שם מצרך = משקל בגרמים, בכל שורה",
                                );
                              return [name.trim(), Number(weight)];
                            }),
                        ),
                });
                reload();
                notify("ההעדפות נשמרו בשרת");
              });
            }}
          >
            <div className="k-grid-2">
              <label>
                נפח כוס במ״ל, אם הוגדר
                <input
                  name="cup"
                  type="number"
                  min="1"
                  max="1000"
                  defaultValue={data.preferences.cup_ml ?? ""}
                />
              </label>
            </div>
            <label>
              משקל אריזה בגרמים — העדפה אישית, כל מצרך בשורה
              <textarea
                value={
                  packageWeights ??
                  Object.entries(data.preferences.package_weights ?? {})
                    .map(([name, weight]) => name + "=" + weight)
                    .join("\n")
                }
                onChange={(e) => setPackageWeights(e.target.value)}
                placeholder={"חמאה=200\nקמח=1000"}
              />
            </label>
            <p className="k-note">
              ההגדרה נשמרת כהעדפה. כוס אינה מומרת לגרמים בלי מידע מתאים למצרך.
            </p>
            <button className="button primary" disabled={busy}>
              שמירת העדפות
            </button>
          </form>
        )}
      </section>

      <section className="k-panel">
        <h2>ממי המתכון?</h2>
        <p className="k-note">
          אוספים לפי המקור והסיפור, בלי חשבונות או שיתוף משתמשים.
        </p>
        {sources.data?.items.map((s: any) => (
          <button
            key={s.name}
            className="k-list-link"
            onClick={() => go("/recipes?source=" + encodeURIComponent(s.name))}
          >
            {s.name} · {s.count} מתכונים
          </button>
        ))}
      </section>
      <section className="k-panel">
        <h2>היסטוריית בישולים</h2>
        {cooking.data?.items.map((c: any) => (
          <button
            key={c.id}
            className="k-list-link"
            onClick={() => go("/cook/" + c.id)}
          >
            {c.title} · {c.target} ·{" "}
            {
              (
                { active: "פעיל", completed: "הושלם", cancelled: "בוטל" } as any
              )[c.state]
            }{" "}
            · {new Date(c.created_at).toLocaleDateString("he")}
          </button>
        ))}
      </section>
      <section className="k-note">
        <h2>להוסיף למסך הבית</h2>
        <p>
          בדפדפן נתמך ניתן לבחור ״הוספה למסך הבית״. אין צורך במצב אופליין;
          נתונים נשמרים בשרת ונדרשת רשת.
        </p>
      </section>
      {createCat && (
        <Dialog title="יצירה ואישור קטגוריה" close={() => setCreateCat(false)}>
          <CategoryPicker
            selected={[]}
            onChange={() => {
              categories.reload();
              setCreateCat(false);
            }}
          />
        </Dialog>
      )}
      {category && (
        <CategoryManage
          category={category}
          all={categories.data?.items ?? []}
          close={() => setCategory(null)}
          changed={categories.reload}
        />
      )}
      {installHelp && <InstallHelp close={() => setInstallHelp(false)} />}
      {account && <AccountSettings close={() => setAccount(false)} />}
    </>
  );
}
function CategoryManage({
  category: c,
  all,
  close,
  changed,
}: {
  category: any;
  all: any[];
  close: () => void;
  changed: () => void;
}) {
  const [name, setName] = useState(c.name),
    [parent, setParent] = useState(c.parent_id ?? ""),
    [aliases, setAliases] = useState(c.aliases.join(", ")),
    [showLibrary, setShowLibrary] = useState(false),
    [libraryOffset, setLibraryOffset] = useState(0),
    [crop, setCrop] = useState({ left: 0, top: 0, width: 500, height: 500 }),
    [cropped, setCropped] = useState<string | null>(null),
    [merge, setMerge] = useState("");
  const library = useResource<any>(
    showLibrary ? "/media?offset=" + libraryOffset : null,
  );
  const history = useResource<any>("/categories/" + c.id + "/images");
  const { run, busy, notify } = useAction();
  return (
    <Dialog title={"הקטגוריה " + c.name} close={close}>
      <MediaImage id={c.media_id} variant="display" />
      <label>
        שם
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        מיקום בעץ
        <select value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">קטגוריה ראשית</option>
          {all
            .filter((a) => a.id !== c.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        שמות נרדפים, מופרדים בפסיקים
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </label>
      <button
        className="button primary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await api("/categories/" + c.id, "PATCH", {
              name,
              parent_id: parent || null,
              aliases: aliases
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean),
            });
            changed();
            notify("הקטגוריה עודכנה. לא הופעלה יצירת תמונה מחדש.");
          })
        }
      >
        שמירת השם והמיקום
      </button>
      <fieldset>
        <legend>תמונת נושא</legend>
        <label className="button outline k-file-button">
          העלאת תמונה שלי
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                run(async () => {
                  const m = await upload(file);
                  await api(`/categories/${c.id}/image`, "POST", {
                    media_id: m.id,
                  });
                  changed();
                  notify("התמונה האישית נבחרה ולא תידרס אוטומטית");
                  close();
                });
            }}
          />
        </label>
        <button
          className="button outline"
          onClick={() => setShowLibrary(!showLibrary)}
        >
          בחירת תמונה מהמאגר האישי
        </button>
        {showLibrary && (
          <>
            <div className="k-category-grid">
              {library.data?.items.map((m: any) => (
                <button
                  key={m.id}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/categories/${c.id}/image`, "POST", {
                        media_id: m.id,
                      });
                      changed();
                      close();
                    })
                  }
                >
                  <MediaImage id={m.id} />
                  <span>
                    {m.caption ||
                      (m.origin === "ai"
                        ? "תמונת המחשה AI"
                        : m.origin === "source"
                          ? "צילום מקור"
                          : "צילום שלי")}
                  </span>
                </button>
              ))}
            </div>
            <div className="k-pagination">
              <button
                disabled={!libraryOffset}
                onClick={() =>
                  setLibraryOffset(Math.max(0, libraryOffset - 30))
                }
              >
                הקודמות
              </button>
              <button
                disabled={(library.data?.items.length ?? 0) < 30}
                onClick={() => setLibraryOffset(libraryOffset + 30)}
              >
                הבאות
              </button>
            </div>
          </>
        )}
        {c.media_id && (
          <details>
            <summary>חיתוך ומיקום של תמונת הנושא</summary>
            <p className="k-note">
              מידות בפיקסלים מהתמונה המקורית המסובבת. התמונה הקודמת תישמר
              בהיסטוריה.
            </p>
            <div className="k-grid-2">
              {Object.entries(crop).map(([key, value]) => (
                <label key={key}>
                  {
                    (
                      {
                        left: "מרחק משמאל",
                        top: "מרחק מלמעלה",
                        width: "רוחב",
                        height: "גובה",
                      } as any
                    )[key]
                  }
                  <input
                    type="number"
                    min="0"
                    value={value}
                    onChange={(e) =>
                      setCrop({ ...crop, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <button
              className="button outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await api(
                    "/media/" + c.media_id + "/crop",
                    "POST",
                    crop,
                  );
                  setCropped(result.id);
                })
              }
            >
              תצוגה מקדימה של החיתוך
            </button>
            {cropped && (
              <>
                <MediaImage id={cropped} variant="original" />
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/categories/${c.id}/image`, "POST", {
                        media_id: cropped,
                      });
                      changed();
                      close();
                    })
                  }
                >
                  אישור החיתוך כתמונת נושא
                </button>
              </>
            )}
          </details>
        )}
        <details>
          <summary>היסטוריית תמונות הנושא</summary>
          <div className="k-category-grid">
            {history.data?.items.map((m: any) => (
              <button
                key={m.id}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`/categories/${c.id}/image`, "POST", {
                      media_id: m.media_id,
                    });
                    changed();
                    close();
                  })
                }
              >
                <MediaImage id={m.media_id} />
                <span>
                  {m.origin === "ai" ? "תמונת המחשה AI" : "תמונה אישית"} · בחירה
                  מחדש
                </span>
              </button>
            ))}
          </div>
        </details>
        <label>
          ענף יעד
          <select value={merge} onChange={(e) => setMerge(e.target.value)}>
            <option value="">בחירה</option>
            {all
              .filter((a) => a.id !== c.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <button
          className="button outline"
          disabled={busy || !merge}
          onClick={() =>
            run(async () => {
              if (window.confirm("לאחד לענף שבחרת ולשמור את כל השיוכים?")) {
                await api(`/categories/${c.id}/merge`, "POST", {
                  target_id: merge,
                });
                changed();
                close();
              }
            })
          }
        >
          אישור איחוד
        </button>
      </fieldset>
    </Dialog>
  );
}
