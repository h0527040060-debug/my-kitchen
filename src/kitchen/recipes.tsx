import { CategoryBrowser } from "./categories.tsx";
import { useState, useEffect } from "react";
import {
  Plus,
  Search,
  Heart,
  Camera,
  ArrowLeft,
  ChefHat,
  Clock,
  ShoppingBasket,
  Expand,
} from "lucide-react";
import { api, go, mediaUrl, upload } from "./api.ts";
import {
  useAction,
  useResource,
  LoadState,
  PageTitle,
  MediaImage,
  Dialog,
  Confirm,
} from "./ui.tsx";
import { sourceLabel } from "../../shared/provenance.ts";
import { RecipeEditor } from "./editor.tsx";
import {
  scaleRecipe,
  hasBaseYield,
  amountText,
  panRatio,
  selectedIngredient,
} from "../../shared/quantities.ts";
export function RecipeHome() {
  const [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [favorite, setFavorite] = useState(false),
    [status, setStatus] = useState("published"),
    [sort, setSort] = useState("updated"),
    [offset, setOffset] = useState(0),
    [filters, setFilters] = useState({
      classification: "",
      tried: "",
      difficulty: "",
      tag: "",
      max_active: "",
      max_total: "",
    }),
    [editing, setEditing] = useState(
      new URLSearchParams(window.location.hash.split("?")[1] ?? "").has("new"),
    );

  const [selection, setSelection] = useState<any[]>([]),
    [remove, setRemove] = useState<any[] | null>(null),
    [managing, setManaging] = useState(false);
  const params = new URLSearchParams({
    q: query,
    status,
    sort,
    offset: String(offset),
    favorite: String(favorite),
    ...(category ? { category } : {}),
    ...(new URLSearchParams(window.location.hash.split("?")[1] ?? "").get(
      "source",
    )
      ? {
          source: new URLSearchParams(window.location.hash.split("?")[1]).get(
            "source",
          )!,
        }
      : {}),
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  });
  const { data, error, loading, reload } = useResource<any>(
    "/recipes?" + params.toString(),
  );
  const scope = new URLSearchParams(params);
  scope.delete("offset");
  const selectionScope = scope.toString();
  useEffect(() => setSelection([]), [selectionScope]);
  const categories = useResource<any>("/categories"),
    cooking = useResource<any>("/cooking");
  const { run, busy, notify } = useAction();
  useEffect(() => {
    const add = () => setEditing(true);
    window.addEventListener("kitchen-add-recipe", add);
    return () => window.removeEventListener("kitchen-add-recipe", add);
  }, []);
  const change = () => setOffset(0);
  return (
    <div className="k-library-page">
      <h1 className="k-sr-only">המתכונים שלי</h1>
      {cooking.data?.items
        .filter((c: any) => c.state === "active")
        .slice(0, 1)
        .map((c: any) => (
          <button
            key={c.id}
            className="k-resume"
            onClick={() => go("/cook/" + c.id)}
          >
            <ChefHat />
            <div>
              <strong>ממשיכים לבשל: {c.title}</strong>
              <span>גרסה {c.recipe_revision} · הכמות והסימונים מחכים לך</span>
            </div>
            <ArrowLeft />
          </button>
        ))}
      <form
        className="k-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
          change();
        }}
      >
        <Search />
        <input
          aria-label="חיפוש מתכונים"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="שם, מצרך, מקור או טעם שמחפשים…"
        />
        <button className="button primary" type="submit">
          חיפוש
        </button>
      </form>
      <CategoryBrowser
        items={categories.data?.items ?? []}
        selected={category}
        change={(id) => {
          setCategory(id);
          change();
        }}
      />
      <details className="k-filters">
        <summary>סינון ומיון</summary>
        <div className="k-filter-row">
          <label>
            אוסף
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                change();
              }}
            >
              <option value="published">המתכונים שלי</option>
              <option value="draft">טיוטות</option>
              <option value="trash">סל מחזור</option>
            </select>
          </label>
          <label>
            מיון
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                change();
              }}
            >
              {[
                ["updated", "עודכנו לאחרונה"],
                ["created", "נוספו לאחרונה"],
                ["cooked", "הוכנו לאחרונה"],
                ["popular", "פופולריים אצלי"],
                ["rating", "דירוג"],
                ["name", "שם"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button
            className={favorite ? "button primary" : "button outline"}
            aria-pressed={favorite}
            onClick={() => {
              setFavorite(!favorite);
              change();
            }}
          >
            <Heart size={16} /> מועדפים
          </button>
        </div>

        <div className="k-grid-2">
          <label>
            קטגוריה ותת־קטגוריה
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                change();
              }}
            >
              <option value="">הכול</option>
              {categories.data?.items.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {[
            [
              "classification",
              "סיווג",
              ["", "לא ידוע", "בשרי", "חלבי", "פרווה"],
            ],
            ["tried", "כבר ניסיתי?", ["", "yes", "no"]],
            ["difficulty", "קושי", ["", "קל", "בינוני", "מורכב", "לא ידוע"]],
          ].map(([key, label, options]) => (
            <label key={key as string}>
              {label as string}
              <select
                value={(filters as any)[key as string]}
                onChange={(e) => {
                  setFilters({ ...filters, [key as string]: e.target.value });
                  change();
                }}
              >
                {(options as string[]).map((o) => (
                  <option key={o} value={o}>
                    {o === "yes"
                      ? "נוסו"
                      : o === "no"
                        ? "טרם נוסו"
                        : o || "הכול"}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            תג
            <input
              value={filters.tag}
              onChange={(e) => {
                setFilters({ ...filters, tag: e.target.value });
                change();
              }}
              placeholder="ללא מיקסר, מתאים להקפאה…"
            />
          </label>
          <label>
            עד דקות עבודה
            <input
              type="number"
              min="0"
              value={filters.max_active}
              onChange={(e) => {
                setFilters({ ...filters, max_active: e.target.value });
                change();
              }}
            />
          </label>
          <label>
            עד דקות כולל המתנה
            <input
              type="number"
              min="0"
              value={filters.max_total}
              onChange={(e) => {
                setFilters({ ...filters, max_total: e.target.value });
                change();
              }}
            />
          </label>
        </div>
        <button
          className="k-text"
          onClick={() => {
            setFilters({
              classification: "",
              tried: "",
              difficulty: "",
              tag: "",
              max_active: "",
              max_total: "",
            });
            setFavorite(false);
            setCategory("");
            setQ("");
            setQuery("");
            change();
          }}
        >
          ניקוי מסננים
        </button>
      </details>
      <LoadState loading={loading} error={error} retry={reload} />
      {data && (
        <>
          <div className="k-collection-heading">
            <p>{data.total} מתכונים באוסף</p>
            <button
              className="k-text"
              aria-pressed={managing}
              onClick={() => setManaging(!managing)}
            >
              {managing ? "סיום בחירה" : "בחירה ופעולות"}
            </button>
          </div>
          {managing && (
            <div className="k-actions k-selection-toolbar">
              <button
                className="button outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const all = await api(
                      "/recipes?" + params + "&selection=true",
                    );
                    setSelection(all.items);
                  })
                }
              >
                בחירת הכול — כל העמודים
              </button>
              <button
                className="button outline"
                disabled={busy || !selection.length}
                onClick={() => setSelection([])}
              >
                ניקוי בחירה
              </button>
              <span role="status">נבחרו {selection.length} מתכונים</span>
              <button
                className="button outline danger"
                disabled={busy || !selection.length}
                onClick={() => setRemove(selection)}
              >
                {status === "trash" ? "שחזור הנבחרים" : "מחיקת הנבחרים"}
              </button>
            </div>
          )}
          <div className="k-recipes-grid">
            {data.items.map((r: any) => (
              <article className="k-card" key={r.id}>
                {managing && (
                  <label className="k-card-select">
                    <input
                      type="checkbox"
                      aria-label={"בחירת " + (r.title || "מתכון ללא שם")}
                      checked={selection.some((s) => s.id === r.id)}
                      onChange={(e) =>
                        setSelection((old) =>
                          e.target.checked
                            ? [...old, { id: r.id, revision: r.revision }]
                            : old.filter((s) => s.id !== r.id),
                        )
                      }
                    />{" "}
                    בחירה
                  </label>
                )}
                <button
                  className="k-card-photo"
                  onClick={() => go("/recipes/" + r.id)}
                  aria-label={"פתיחת " + r.title}
                >
                  <MediaImage id={r.primary_media_id} />
                  {r.primary_media_origin === "ai" && (
                    <span className="k-ai-badge">תמונת המחשה AI</span>
                  )}
                </button>
                <button
                  className="k-card-heart"
                  aria-label={"מועדף " + r.title}
                  aria-pressed={r.favorite}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/recipes/${r.id}/favorite`, "PATCH", {
                        favorite: !r.favorite,
                      });
                      reload();
                    })
                  }
                >
                  <Heart fill={r.favorite ? "currentColor" : "none"} />
                </button>
                <div className="k-card-content">
                  <button onClick={() => go("/recipes/" + r.id)}>
                    <h2>{r.title || "מתכון ללא שם"}</h2>
                  </button>
                  <p>{r.description}</p>
                  {managing && (
                    <button
                      className="k-text danger"
                      onClick={() =>
                        setRemove([{ id: r.id, revision: r.revision }])
                      }
                    >
                      {status === "trash" ? "שחזור" : "מחיקה"}
                    </button>
                  )}
                  <div className="k-meta">
                    {r.active_minutes !== null || r.total_minutes !== null ? (
                      <>
                        <span>
                          <Clock size={14} /> עבודה:{" "}
                          {r.active_minutes ?? "לא צוין"}
                        </span>
                        <span>כולל: {r.total_minutes ?? "לא צוין"}</span>
                      </>
                    ) : (
                      <span>זמן לא צוין</span>
                    )}
                  </div>
                  <div className="k-meta">
                    {r.classification !== "לא ידוע" && (
                      <span>{r.classification}</span>
                    )}
                    {r.cook_count > 0 && <span>הוכן {r.cook_count} פעמים</span>}
                    {r.status !== "published" && (
                      <span>{r.status === "draft" ? "טיוטה" : "נמחק"}</span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!data.items.length && (
            <div className="k-empty">
              <ChefHat size={45} />
              <h2>המתכון הבא שלך מתחיל כאן</h2>
              <p>אפשר להזין ידנית או להעלות את צילומי המתכונים שכבר אספת.</p>
              <button
                className="button primary"
                onClick={() => setEditing(true)}
              >
                הוספת מתכון
              </button>
            </div>
          )}
          <div className="k-pagination">
            <button
              className="button outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 24))}
            >
              הקודמים
            </button>
            <span>
              {data.total ? offset + 1 : 0}–{Math.min(offset + 24, data.total)}{" "}
              מתוך {data.total}
            </span>
            <button
              className="button outline"
              disabled={offset + 24 >= data.total}
              onClick={() => setOffset(offset + 24)}
            >
              הבאים
            </button>
          </div>
        </>
      )}
      {remove && (
        <Confirm
          close={() => setRemove(null)}
          text={
            status === "trash"
              ? `לשחזר ${remove.length} מתכונים?`
              : `למחוק ${remove.length} מתכונים? הם יעברו לסל המחזור עם אפשרות שחזור, והתמונות יישמרו.`
          }
          onConfirm={async () => {
            for (let at = 0; at < remove.length; at += 50)
              await api(
                "/recipe-collection/" +
                  (status === "trash" ? "restore" : "trash"),
                "POST",
                { confirmed: true, selection: remove.slice(at, at + 50) },
              );
            setRemove(null);
            setSelection([]);
            reload();
            notify("הפעולה נשמרה בשרת");
          }}
        />
      )}
      {editing && (
        <RecipeEditor
          close={() => setEditing(false)}
          saved={(id) => {
            setEditing(false);
            go("/recipes/" + id);
          }}
        />
      )}
    </div>
  );
}
export function RecipeDetail({ id }: { id: string }) {
  const settings = useResource<any>("/settings");
  const { data, error, loading, reload } = useResource<any>(
    "/recipes/" + id,
    5000,
  );
  const [target, setTarget] = useState(""),
    [editing, setEditing] = useState(false),
    [zoom, setZoom] = useState<any>(null),
    [confirmDelete, setConfirmDelete] = useState(false),
    [pan, setPan] = useState(false);
  const { run, busy, notify } = useAction();
  if (!data)
    return <LoadState loading={loading} error={error} retry={reload} />;
  const r = data.recipe,
    c = r.content;
  let scaled = c,
    scaleError = "";
  try {
    if (target) scaled = scaleRecipe(c, target);
  } catch (e) {
    scaleError = (e as Error).message;
  }
  return (
    <>
      <PageTitle
        title={c.title || "מתכון ללא שם"}
        subtitle={`גרסה ${r.revision} · ${r.status === "published" ? "מתכון שמור במאגר" : r.status === "trash" ? "בסל המחזור" : "טיוטה — עדיין לא מאושרת"}`}
        back={() => go("/recipes")}
      >
        <button className="button outline" onClick={() => setEditing(true)}>
          עריכה
        </button>
        {r.status !== "trash" && (
          <button
            className="button outline danger"
            onClick={() => setConfirmDelete(true)}
          >
            מחיקת מתכון
          </button>
        )}
        <button
          className="button primary"
          disabled={busy || r.status !== "published" || !!scaleError}
          onClick={() =>
            run(async () => {
              const cooking = await api("/cooking", "POST", {
                recipe_id: id,
                target: target || "",
              });
              go("/cook/" + cooking.id);
            })
          }
        >
          <ChefHat size={17} /> מתחילים לבשל
        </button>
      </PageTitle>
      {r.primary_media_id && (
        <div className="k-recipe-hero">
          <MediaImage id={r.primary_media_id} variant="display" />
          {data.media.find((m: any) => m.id === r.primary_media_id)?.origin ===
            "ai" && <span>תמונת המחשה באמצעות AI</span>}
        </div>
      )}
      <p className="k-lead">{c.description}</p>
      <div className="k-meta">
        <span>עבודה: {c.active_minutes ?? "לא צוין"} דקות</span>
        <span>כולל: {c.total_minutes ?? "לא צוין"} דקות</span>
        <span>{c.classification}</span>
        <span>
          קושי: {c.difficulty}
          {c.difficulty_origin === "ai" ? " — הערכת AI" : ""}
        </span>
      </div>
      <div className="k-yield">
        <div>
          <strong>
            בסיס: {c.yield ? `${c.yield.amount} ${c.yield.unit}` : "תפוקה חסרה"}
          </strong>
          {c.yield?.pan && <p>{c.yield.pan}</p>}
        </div>
        <label>
          כמה מכינים?
          <input
            dir="auto"
            value={target}
            disabled={!hasBaseYield(c)}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={c.yield?.amount || "נדרשת תפוקת בסיס"}
          />
        </label>
        <button className="k-text" onClick={() => setTarget("")}>
          חזרה לבסיס
        </button>
      </div>
      {!hasBaseYield(c) && (
        <p className="k-note">
          תפוקת בסיס לא צוינה. אפשר לקרוא ולבשל לפי המקור; התאמת כמויות תהיה
          זמינה אחרי השלמת תפוקה בעריכה.
        </p>
      )}
      {r.warnings?.length > 0 && (
        <details className="k-note">
          <summary>פרטים להשלמה בהמשך ({r.warnings.length})</summary>
          <ul>
            {r.warnings.map((w: string, n: number) => (
              <li key={n}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {scaleError && <p className="k-alert">{scaleError}</p>}
      {target && !scaleError && (
        <p className="k-note">
          הכמויות מחושבות מערכי הבסיס. המקור, הזמנים והטמפרטורות לא השתנו.
        </p>
      )}
      <details className="k-note">
        <summary>מאיפה הנתונים?</summary>
        <p>
          תפוקה: {sourceLabel(r.field_sources?.yield)} · זמן עבודה:{" "}
          {sourceLabel(r.field_sources?.active_minutes)} · זמן כולל:{" "}
          {sourceLabel(r.field_sources?.total_minutes)}. הצעות הסיווג ותמונות
          ההמחשה מסומנות בנפרד.
        </p>
      </details>
      <div className="k-recipe-body">
        <section>
          <h2>מה צריך?</h2>
          {scaled.ingredients.map(selectedIngredient).map((i: any) => (
            <div className="k-ingredient" key={i.id}>
              {i.group && <small>{i.group}</small>}
              <p>
                <bdi>{amountText(i.amount)}</bdi> {i.unit}{" "}
                <strong>{i.name}</strong> {i.note}
              </p>
              {i.egg_size && (
                <small>
                  ביצה {i.egg_size}
                  {i.egg_size_origin === "default"
                    ? " · ברירת מחדל — לא צוין במקור"
                    : ""}
                </small>
              )}
              {i.uncertainty && <p className="k-alert">{i.uncertainty}</p>}
              <details>
                <summary>הניסוח המקורי</summary>
                <p>{i.original || "הזנה ידנית"}</p>
              </details>
            </div>
          ))}
        </section>
        <section>
          <h2>איך מכינים?</h2>
          {scaled.steps.map((s: any, index: number) => (
            <div className="k-step" key={s.id}>
              <span>{index + 1}</span>
              <div>
                {s.group && <small>{s.group}</small>}
                <p>{s.text}</p>
                <small>
                  {s.duration_minutes !== null
                    ? `${s.duration_minutes} דקות`
                    : ""}{" "}
                  {s.temperature_c !== null ? ` · ${s.temperature_c}°C` : ""}
                </small>
              </div>
            </div>
          ))}
        </section>
      </div>
      {c.equipment.length > 0 && <p>ציוד: {c.equipment.join(", ")}</p>}
      <section className="k-panel">
        <h2>המקור והגלריה</h2>

        <p className="k-note">
          צילומי המקור נשמרים תמיד. לחיצה פותחת זום; סרטונים נטענים רק כשפותחים
          אותם.
        </p>
        <div className="k-gallery">
          {data.media.map((m: any) => (
            <figure key={m.id}>
              <button
                aria-label={
                  "פתיחת " + (m.origin === "source" ? "תמונת מקור" : "מדיה")
                }
                onClick={() => setZoom(m)}
              >
                <MediaImage
                  id={m.id}
                  variant={m.kind === "video" ? "poster" : "thumbnail"}
                />
                <Expand size={17} />
              </button>
              <figcaption>
                {m.origin === "source"
                  ? "המקור"
                  : m.origin === "ai"
                    ? "תמונת המחשה באמצעות AI"
                    : "צילום שלי"}
                {m.kind === "video" ? " · סרטון" : ""} {m.caption}
              </figcaption>
              <button
                className="k-text"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const caption = window.prompt("כיתוב לתמונה", m.caption);
                    if (caption !== null) {
                      await api("/media/" + m.id, "PATCH", { caption });
                      reload();
                    }
                  })
                }
              >
                כיתוב
              </button>
              <button
                className="k-text"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const position = Number(
                      window.prompt(
                        "מיקום בגלריה (0 ראשון)",
                        String(m.position),
                      ),
                    );
                    if (Number.isInteger(position) && position >= 0) {
                      await api(`/recipes/${id}/media`, "POST", {
                        media_id: m.id,
                        primary: false,
                        position,
                      });
                      reload();
                    }
                  })
                }
              >
                סדר
              </button>
            </figure>
          ))}
        </div>
        <label className="button outline k-file-button">
          <Plus size={16} /> הוספת צילום, סרטון או הקלטה
          <input
            type="file"
            accept="image/*,video/*,audio/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                run(async () => {
                  const m = await upload(file);
                  await api(`/recipes/${id}/media`, "POST", {
                    media_id: m.id,
                    primary: false,
                    position: data.media.length,
                  });
                  notify("הקובץ נשמר בשרת ונשלח לעיבוד");
                  reload();
                });
            }}
          />
        </label>
        <p className="k-note">
          {settings.data?.limits
            ? `תמונה עד ${settings.data.limits.image_mb}MB, סרטון עד ${settings.data.limits.video_mb}MB ו־${settings.data.limits.video_minutes} דקות, הקלטה עד ${settings.data.limits.audio_mb}MB.`
            : "מגבלות המדיה נטענות מהשרת."}
        </p>
      </section>
      {c.notes && (
        <section className="k-panel">
          <h2>טיפים למטבח</h2>
          <p>{c.notes}</p>
        </section>
      )}
      {c.source_name && <p>ממי המתכון: {c.source_name}</p>}
      {c.story && (
        <section className="k-panel">
          <h2>הסיפור של המתכון</h2>
          <p>{c.story}</p>
        </section>
      )}
      <section className="k-panel">
        <h2>מה למדתי בפעמים הקודמות?</h2>
        {data.experiences.length ? (
          data.experiences.map((e: any) => (
            <div className="k-history" key={e.id}>
              <strong>
                {new Date(e.created_at).toLocaleDateString("he")} · כמות{" "}
                {e.target} · גרסה {e.recipe_revision} · {e.rating ?? "ללא"}{" "}
                כוכבים
              </strong>
              <p>{e.notes}</p>
              <div className="k-gallery">
                {e.media?.map((m: any) => (
                  <figure key={m.id}>
                    <button
                      aria-label="פתיחת תמונת תוצאה"
                      onClick={() => setZoom(m)}
                    >
                      <MediaImage id={m.id} />
                    </button>
                  </figure>
                ))}
              </div>
              <button
                className="k-text"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const notes = window.prompt("תיקון הערת הבישול", e.notes);
                    if (notes !== null) {
                      await api("/experiences/" + e.id, "PATCH", {
                        notes,
                        rating: e.rating,
                        media_ids: [],
                      });
                      reload();
                    }
                  })
                }
              >
                תיקון הערה
              </button>
              <label className="k-text k-file-button">
                הוספת תמונת תוצאה
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      run(async () => {
                        const m = await upload(file);
                        await api("/experiences/" + e.id, "PATCH", {
                          notes: e.notes,
                          rating: e.rating,
                          media_ids: [m.id],
                        });
                        notify("התמונה נוספה לחוויית הבישול");
                      });
                  }}
                />
              </label>
            </div>
          ))
        ) : (
          <p className="k-note">
            אחרי השלמת בישול יופיעו כאן הדירוג, הכמות וההערות שלך.
          </p>
        )}
      </section>
      <div className="k-actions">
        <button
          className="button outline"
          disabled={busy || !!scaleError}
          onClick={() =>
            run(async () => {
              const list = await api("/shopping", "POST", {
                name: c.title || "קניות למתכון",
                recipe_id: id,
                target: target || (hasBaseYield(c) ? c.yield.amount : ""),
              });
              go("/shopping/" + list.id);
            })
          }
        >
          <ShoppingBasket size={17} /> לרשימת קניות
        </button>
        <button className="button outline" onClick={() => setPan(true)}>
          התאמת תבנית
        </button>
        <button className="button outline" onClick={() => setEditing(true)}>
          יצירת הגרסה שלי
        </button>
      </div>
      <details className="k-panel">
        <summary>היסטוריית גרסאות ושחזור</summary>
        {data.versions.map((v: any) => (
          <div className="k-history" key={v.id}>
            <span>
              גרסה {v.revision} · {v.reason}
            </span>
            <button
              className="k-text"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (
                    window.confirm(
                      "לשחזר כטיוטה חדשה? המקור והבישולים הקודמים יישמרו.",
                    )
                  ) {
                    await api(`/recipes/${id}/restore-version`, "POST", {
                      version: v.revision,
                      revision: r.revision,
                    });
                    reload();
                  }
                })
              }
            >
              שחזור לטיוטה
            </button>
          </div>
        ))}
      </details>
      {r.status === "trash" ? (
        <button
          className="button outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api(`/recipes/${id}/restore`, "POST", {
                revision: r.revision,
              });
              reload();
            })
          }
        >
          שחזור מסל המחזור
        </button>
      ) : (
        <button
          className="k-text danger"
          onClick={() => setConfirmDelete(true)}
        >
          העברה לסל המחזור
        </button>
      )}
      {editing && (
        <RecipeEditor
          recipe={r}
          close={() => setEditing(false)}
          saved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          text="המתכון יעבור לסל המחזור. המקור והמדיה יישמרו וניתן יהיה לשחזר."
          close={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api("/recipes/" + id, "DELETE", {
              confirmed: true,
              revision: r.revision,
            });
            reload();
          }}
        />
      )}
      {zoom && (
        <MediaViewer
          media={zoom}
          recipeId={id}
          close={() => setZoom(null)}
          changed={reload}
        />
      )}

      {pan && <PanTool close={() => setPan(false)} />}
    </>
  );
}
function MediaViewer({
  media,
  recipeId,
  close,
  changed,
}: {
  media: any;
  recipeId: string;
  close: () => void;
  changed: () => void;
}) {
  const [zoom, setZoom] = useState(100),
    [crop, setCrop] = useState({ left: 0, top: 0, width: 500, height: 500 }),
    [cropped, setCropped] = useState<string | null>(null);
  const { run, busy } = useAction();
  return (
    <Dialog
      title={media.origin === "source" ? "תמונת המקור" : "הגלריה שלי"}
      close={close}
    >
      {media.kind === "image" ? (
        <>
          <label>
            זום {zoom}%
            <input
              type="range"
              min="100"
              max="400"
              step="25"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <div className="k-zoom">
            <img
              src={mediaUrl(media.id, "original")}
              alt={media.caption || "מקור המתכון"}
              style={{ width: zoom + "%", maxWidth: "none" }}
            />
          </div>
          <details>
            <summary>חיתוך אזור המנה ללא AI</summary>
            <p className="k-note">
              מידות בפיקסלים מהתמונה המסובבת. המקור אינו משתנה.
            </p>
            <div className="k-grid-2">
              {Object.entries(crop).map(([k, v]) => (
                <label key={k}>
                  {
                    (
                      {
                        left: "מרחק משמאל",
                        top: "מרחק מלמעלה",
                        width: "רוחב",
                        height: "גובה",
                      } as any
                    )[k]
                  }
                  <input
                    type="number"
                    min={k === "left" || k === "top" ? 0 : 1}
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
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const m = await api(
                    "/media/" + media.id + "/crop",
                    "POST",
                    crop,
                  );
                  setCropped(m.id);
                })
              }
            >
              תצוגת חיתוך
            </button>
            {cropped && (
              <>
                <MediaImage id={cropped} variant="original" />
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/recipes/${recipeId}/media`, "POST", {
                        media_id: cropped,
                        primary: true,
                        position: 0,
                      });
                      changed();
                      close();
                    })
                  }
                >
                  שמירת החיתוך כתמונה ראשית
                </button>
              </>
            )}
          </details>
          <button
            className="button outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(`/recipes/${recipeId}/media`, "POST", {
                  media_id: media.id,
                  primary: true,
                  position: media.position,
                });
                changed();
                close();
              })
            }
          >
            בחירה כתמונה ראשית
          </button>
        </>
      ) : media.kind === "video" ? (
        <video
          controls
          preload="none"
          poster={mediaUrl(media.id, "poster")}
          src={mediaUrl(media.id, "video")}
        />
      ) : (
        <audio controls preload="none" src={mediaUrl(media.id, "original")} />
      )}
      <p>
        {media.origin === "ai"
          ? "תמונת המחשה באמצעות AI"
          : media.origin === "source"
            ? "מקור המתכון — נשמר ללא שינוי"
            : "צילום או הקלטה אישיים"}
      </p>
    </Dialog>
  );
}
function PanTool({ close }: { close: () => void }) {
  const [from, setFrom] = useState({
      shape: "round" as "round" | "rectangle",
      a: 24,
      b: 24,
      depth: 5,
    }),
    [to, setTo] = useState({
      shape: "round" as "round" | "rectangle",
      a: 26,
      b: 26,
      depth: 5,
    });
  let result: any = null;
  try {
    result = panRatio(from, to);
  } catch {}
  return (
    <Dialog title="התאמת תבנית" close={close}>
      {[
        [from, setFrom, "תבנית המקור"],
        [to, setTo, "תבנית רצויה"],
      ].map(([p, set, label]: any) => (
        <fieldset key={label}>
          <legend>{label}</legend>
          <label>
            צורה
            <select
              value={p.shape}
              onChange={(e) => set({ ...p, shape: e.target.value })}
            >
              <option value="round">עגולה</option>
              <option value="rectangle">מלבנית</option>
            </select>
          </label>
          <div className="k-grid-2">
            {(["a", "b", "depth"] as const)
              .filter((k) => p.shape !== "round" || k !== "b")
              .map((k) => (
                <label key={k}>
                  {k === "depth"
                    ? "עומק"
                    : k === "a"
                      ? p.shape === "round"
                        ? "קוטר"
                        : "אורך"
                      : "רוחב"}{" "}
                  בס״מ
                  <input
                    type="number"
                    min="0.1"
                    value={p[k]}
                    onChange={(e) => set({ ...p, [k]: Number(e.target.value) })}
                  />
                </label>
              ))}
          </div>
        </fieldset>
      ))}
      {result && (
        <p className="k-note">
          מקדם גאומטרי משוער: {result.ratio.toFixed(3)}. {result.assumption}{" "}
          החישוב אינו משנה מתכון.
        </p>
      )}
    </Dialog>
  );
}
