import { useState } from "react";
import { Plus, ShoppingBasket, ChefHat } from "lucide-react";
import { api, go } from "./api.ts";
import { useAction, useResource, LoadState, PageTitle, Dialog } from "./ui.tsx";
import { amountText, parseAmount } from "../../shared/quantities.ts";
export function Meals() {
  const { data, error, loading, reload } = useResource<any>("/meals");
  const { run, busy } = useAction();
  const [create, setCreate] = useState(false);
  return (
    <>
      <PageTitle
        title="מה מבשלים ביחד?"
        subtitle="תכנון ארוחה, כמויות והכנות — במטבח שלך."
      >
        <button className="button primary" onClick={() => setCreate(true)}>
          <Plus size={18} /> ארוחה חדשה
        </button>
      </PageTitle>
      <LoadState loading={loading} error={error} retry={reload} />
      <div className="k-simple-grid">
        {data?.items.map((m: any) => (
          <article className="k-panel" key={m.id}>
            <button className="k-text" onClick={() => go("/meals/" + m.id)}>
              <h2>{m.name}</h2>
            </button>
            <p>
              {m.adults} מבוגרים, {m.children} ילדים
            </p>
            <p>
              {m.scheduled_at
                ? new Date(m.scheduled_at).toLocaleString("he")
                : "מועד פתוח"}{" "}
              · {m.style}
            </p>
            {m.outcome && (
              <p>
                בפעם הקודמת:{" "}
                {
                  (
                    {
                      enough: "הכמות הספיקה",
                      short: "הכמות לא הספיקה",
                      leftovers: "נשאר אוכל",
                    } as any
                  )[m.outcome]
                }
              </p>
            )}
          </article>
        ))}
      </div>
      {!data?.items.length && !loading && (
        <div className="k-empty">
          <ChefHat size={40} />
          <h2>ארוחה טובה מתחילה בתכנון נעים</h2>
          <p>בוחרים מתכונים שכבר שמרת וכמות נפרדת לכל מנה.</p>
        </div>
      )}
      {create && (
        <Dialog title="ארוחה חדשה" close={() => setCreate(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const m = await api("/meals", "POST", {
                  name: f.get("name"),
                  scheduled_at: f.get("date")
                    ? new Date(String(f.get("date"))).toISOString()
                    : null,
                  adults: Number(f.get("adults")),
                  children: Number(f.get("children")),
                  style: f.get("style"),
                  notes: "",
                });
                go("/meals/" + m.id);
              });
            }}
          >
            <label>
              שם הארוחה
              <input
                name="name"
                required
                placeholder="שבת, יום הולדת, ערב רגיל…"
              />
            </label>
            <label>
              מועד (לא חובה)
              <input name="date" type="datetime-local" />
            </label>
            <div className="k-grid-2">
              <label>
                מבוגרים
                <input name="adults" type="number" min="0" defaultValue="2" />
              </label>
              <label>
                ילדים
                <input name="children" type="number" min="0" defaultValue="0" />
              </label>
            </div>
            <label>
              סגנון
              <input name="style" placeholder="חלבי, חגיגי, הכנה מראש…" />
            </label>
            <button className="button primary" disabled={busy}>
              יצירת הארוחה
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
export function MealDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useResource<any>("/meals/" + id);
  const { run, busy, notify } = useAction();
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [target, setTarget] = useState<Record<string, string>>({}),
    [prep, setPrep] = useState(false);
  const recipes = useResource<any>(
    "/recipes?q=" + encodeURIComponent(search) + "&limit=24",
  );
  if (!data)
    return <LoadState loading={loading} error={error} retry={reload} />;
  const m = data.meal;
  return (
    <>
      <PageTitle
        title={m.name}
        subtitle={`${m.adults} מבוגרים · ${m.children} ילדים · ${m.style}`}
        back={() => go("/meals")}
      >
        <button
          className="button outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await api(
                "/meals/" + id + "/duplicate",
                "POST",
                {},
              );
              go("/meals/" + result.id);
            })
          }
        >
          שכפול ארוחה
        </button>
      </PageTitle>
      <p className="k-note">
        כמות לכל מנה נבחרת ביחידת התפוקה שלה. מספר סועדים אינו הופך עוגייה למנה
        באופן אוטומטי.
      </p>
      <div className="k-actions">
        <button
          className="button primary"
          disabled={busy || !data.items.length}
          onClick={() =>
            run(async () => {
              const l = await api("/shopping", "POST", {
                name: "קניות ל" + m.name,
                meal_id: id,
              });
              go("/shopping/" + l.id);
            })
          }
        >
          <ShoppingBasket size={18} /> קניות לארוחה
        </button>
        <button
          className="button outline"
          disabled={!data.items.length}
          onClick={() => setPrep(true)}
        >
          מנהל הכנות משולב
        </button>
      </div>

      <section className="k-panel">
        <h2>התפריט שלי</h2>
        {data.items.map((i: any) => (
          <div className="k-meal-item" key={i.id}>
            <div>
              <strong>{i.snapshot.title}</strong>
              <p>
                גרסה {i.recipe_revision} · {i.target} {i.snapshot.yield.unit}
              </p>
            </div>
            <button
              className="k-text"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const next = window.prompt(
                    "כמות רצויה באותה יחידה",
                    i.target,
                  );
                  if (next) {
                    await api("/meal-items/" + i.id, "PATCH", { target: next });
                    reload();
                    notify(
                      "הכמות עודכנה. רשימות קניות ותוכניות קיימות לא נדרסו.",
                    );
                  }
                })
              }
            >
              כמות
            </button>
            <button
              className="k-text danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/meal-items/" + i.id, "DELETE");
                  reload();
                })
              }
            >
              הסרה
            </button>
          </div>
        ))}
      </section>
      <section className="k-panel">
        <h2>מוסיפים מנות מהספר</h2>
        <form
          className="k-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="חיפוש מנה לארוחה"
            placeholder="שם או מצרך"
          />
          <button className="button outline">חיפוש</button>
        </form>
        {recipes.data?.items.map((r: any) => (
          <div className="k-meal-add" key={r.id}>
            <span>{r.title}</span>
            <label>
              כמות ({r.yield?.unit ?? "חסרה תפוקה"})
              <input
                value={target[r.id] ?? r.yield?.amount ?? ""}
                onChange={(e) =>
                  setTarget({ ...target, [r.id]: e.target.value })
                }
              />
            </label>
            <button
              className="button outline"
              disabled={busy || !r.yield}
              onClick={() =>
                run(async () => {
                  await api("/meals/" + id + "/items", "POST", {
                    recipe_id: r.id,
                    target: target[r.id] ?? r.yield?.amount,
                    meal_revision: m.revision,
                  });
                  reload();
                })
              }
            >
              הוספה
            </button>
          </div>
        ))}
      </section>
      {data.preparations.map((p: any) => (
        <Preparation key={p.id} preparation={p} reload={reload} />
      ))}
      <section className="k-panel">
        <h2>מה לזכור מהארוחה?</h2>
        <p>{m.notes}</p>
        <p>
          {m.outcome
            ? (
                {
                  enough: "הכמות הספיקה",
                  short: "הכמות לא הספיקה",
                  leftovers: "נשאר אוכל",
                } as any
              )[m.outcome]
            : "עדיין לא תועדה תוצאה"}
        </p>
        <button
          className="button outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const notes = window.prompt("הערות לארוחה הבאה", m.notes);
              if (notes === null) return;
              const answer = window.prompt(
                "הכמות הספיקה? כתבו הספיקה / חסרה / נשאר",
                m.outcome === "short"
                  ? "חסרה"
                  : m.outcome === "leftovers"
                    ? "נשאר"
                    : "הספיקה",
              );
              const outcome =
                answer === "חסרה"
                  ? "short"
                  : answer === "נשאר"
                    ? "leftovers"
                    : answer === "הספיקה"
                      ? "enough"
                      : null;
              await api("/meals/" + id, "PATCH", {
                revision: m.revision,
                notes,
                outcome,
              });
              reload();
            })
          }
        >
          תיעוד ותיקון הניסיון
        </button>
      </section>
      {prep && (
        <Dialog title="סדר עבודה משולב" close={() => setPrep(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                await api("/meals/" + id + "/preparation", "POST", {
                  anchor: new Date(String(f.get("anchor"))).toISOString(),
                  anchor_type: f.get("type"),
                  equipment: { תנור: Number(f.get("oven")) },
                });
                setPrep(false);
                reload();
              });
            }}
          >
            <label>
              מתכננים לפי
              <select name="type">
                <option value="start">מועד התחלה</option>
                <option value="serve">יעד הגשה</option>
              </select>
            </label>
            <label>
              מועד
              <input type="datetime-local" name="anchor" required />
            </label>
            <label>
              תנורים זמינים
              <input
                type="number"
                name="oven"
                min="1"
                max="10"
                defaultValue="1"
              />
            </label>
            <p className="k-note">
              קיבולת אחרת תונח כיחידה אחת עם התרעה. אין הנחה ששתי תבניות נכנסות
              יחד.
            </p>
            <button className="button primary" disabled={busy}>
              יצירת תוכנית
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
function Preparation({
  preparation: p,
  reload,
}: {
  preparation: any;
  reload: () => void;
}) {
  const { run, busy } = useAction();
  return (
    <section className="k-panel">
      <h2>מנהל הכנות</h2>
      {p.plan.warnings.map((w: string, i: number) => (
        <p className="k-alert" key={i}>
          {w}
        </p>
      ))}
      {p.plan.assumptions.map((s: string, i: number) => (
        <p className="k-note" key={i}>
          {s}
        </p>
      ))}
      {p.plan.tasks.map((t: any) => (
        <div className="k-prep-task" key={t.id}>
          <label>
            <input
              type="checkbox"
              checked={p.checked.includes(t.id)}
              disabled={busy}
              onChange={() =>
                run(async () => {
                  await api("/preparation/" + p.id, "PATCH", {
                    revision: p.revision,
                    checked: p.checked.includes(t.id)
                      ? p.checked.filter((id: string) => id !== t.id)
                      : [...p.checked, t.id],
                  });
                  reload();
                })
              }
            />
            <div>
              <strong>{t.title}</strong>
              <p>{t.text}</p>
              <small>
                {t.time_origin === "unknown"
                  ? "זמן לא ידוע"
                  : new Date(t.start_at).toLocaleTimeString("he", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }) +
                    "–" +
                    new Date(t.end_at).toLocaleTimeString("he", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                {t.temperature_c !== null ? ` · ${t.temperature_c}°C` : ""}
              </small>
            </div>
          </label>
          <button
            className="k-text"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const text = window.prompt("התאמת הפעולה לתוכנית", t.text);
                if (text === null) return;
                const plan = {
                  ...p.plan,
                  tasks: p.plan.tasks.map((s: any) =>
                    s.id === t.id ? { ...s, text, time_origin: "manual" } : s,
                  ),
                };
                await api("/preparation/" + p.id, "PATCH", {
                  revision: p.revision,
                  checked: p.checked,
                  plan,
                });
                reload();
              })
            }
          >
            עריכה
          </button>
        </div>
      ))}
    </section>
  );
}

export function Shopping() {
  const { data, error, loading, reload } = useResource<any>("/shopping");
  const { run, busy } = useAction();
  return (
    <>
      <PageTitle
        title="בדרך לקניות"
        subtitle="רשימות אישיות, מחוברות למתכונים ולכמויות."
      >
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const name = window.prompt("שם הרשימה");
              if (name) {
                const r = await api("/shopping", "POST", { name });
                go("/shopping/" + r.id);
              }
            })
          }
        >
          <Plus size={18} /> רשימה חדשה
        </button>
      </PageTitle>
      <LoadState loading={loading} error={error} retry={reload} />
      {data?.items.map((l: any) => (
        <button
          className="k-list-link"
          key={l.id}
          onClick={() => go("/shopping/" + l.id)}
        >
          <ShoppingBasket />
          <span>{l.name}</span>
        </button>
      ))}
    </>
  );
}
export function ShoppingDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useResource<any>("/shopping/" + id);
  const { run, busy } = useAction();
  const [diff, setDiff] = useState<any>(null),
    [removeIds, setRemoveIds] = useState<string[]>([]),
    [addIndices, setAddIndices] = useState<number[]>([]);
  if (!data)
    return <LoadState loading={loading} error={error} retry={reload} />;
  return (
    <>
      <PageTitle
        title={data.list.name}
        subtitle="שורות מאוחדות רק כששם המצרך והיחידה תואמים."
        back={() => go("/shopping")}
      >
        <button
          className="button outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const name = window.prompt("מצרך להוספה");
              if (!name) return;
              const amount = parseAmount(
                  window.prompt("כמות, או לפי הטעם") || "",
                ),
                unit = window.prompt("יחידה") || "",
                department = window.prompt("מחלקה", "כללי") || "כללי";
              await api("/shopping/" + id + "/items", "POST", {
                name,
                amount,
                unit,
                department,
              });
              reload();
            })
          }
        >
          הוספה ידנית
        </button>
        {data.list.meal_id && (
          <button
            className="button outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await api(
                  "/shopping/" + id + "/refresh-preview",
                  "POST",
                  {},
                );
                setDiff(result);
                setRemoveIds([]);
                setAddIndices([]);
              })
            }
          >
            בדיקת שינויים בתפריט
          </button>
        )}
      </PageTitle>
      <div className="k-shopping-list">
        {data.items.map((i: any) => (
          <article key={i.id} className={i.state !== "needed" ? "done" : ""}>
            <div>
              <small>{i.department}</small>
              <h2>{i.name}</h2>
              <p>
                <bdi>{amountText(i.amount)}</bdi> {i.unit}
              </p>
              <small>
                {i.manual
                  ? "נוסף ידנית"
                  : i.source_refs.map((r: any, index: number) => (
                      <button
                        className="k-text"
                        key={index}
                        onClick={() => go("/recipes/" + r.recipe_id)}
                      >
                        {r.title ?? "מתכון שמור"} · כמות {r.target}
                      </button>
                    ))}
                {i.edited ? " · ערוך" : ""}
              </small>
              {i.assumptions?.length > 0 && (
                <p className="k-note">{i.assumptions.join(" · ")}</p>
              )}
            </div>
            <label>
              מצב
              <select
                disabled={busy}
                value={i.state}
                onChange={(e) =>
                  run(async () => {
                    await api("/shopping-items/" + i.id, "PATCH", {
                      revision: i.revision,
                      name: i.name,
                      amount: i.amount,
                      unit: i.unit,
                      department: i.department,
                      state: e.target.value,
                    });
                    reload();
                  })
                }
              >
                <option value="needed">צריך לקנות</option>
                <option value="at_home">יש בבית</option>
                <option value="bought">נקנה</option>
              </select>
            </label>
            <button
              className="k-text"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const name = window.prompt("שם המצרך", i.name);
                  if (!name) return;
                  const amount = parseAmount(
                      window.prompt("כמות", amountText(i.amount)) || "",
                    ),
                    unit = window.prompt("יחידה", i.unit) ?? i.unit,
                    department =
                      window.prompt("מחלקה", i.department) ?? i.department;
                  await api("/shopping-items/" + i.id, "PATCH", {
                    revision: i.revision,
                    name,
                    amount,
                    unit,
                    department,
                    state: i.state,
                  });
                  reload();
                })
              }
            >
              עריכה
            </button>
          </article>
        ))}
      </div>
      {diff && (
        <Dialog title="בדיקת שינויים ברשימה" close={() => setDiff(null)}>
          <p className="k-note">
            שום עריכה או סימון לא יימחקו בלי בחירה מפורשת. בוחרים אילו שורות
            להסיר ואילו הצעות להוסיף.
          </p>
          <h3>שורות קיימות — סמנו רק להסרה</h3>
          {diff.existing.map((i: any) => (
            <label key={i.id}>
              <input
                type="checkbox"
                checked={removeIds.includes(i.id)}
                onChange={() =>
                  setRemoveIds((p) =>
                    p.includes(i.id)
                      ? p.filter((id) => id !== i.id)
                      : [...p, i.id],
                  )
                }
              />
              {i.name} {amountText(i.amount)} {i.unit}{" "}
              {i.edited ? "· ערוך" : ""} {i.state}
            </label>
          ))}
          <h3>הכמויות לפי התפריט הנוכחי — סמנו להוספה</h3>
          {diff.proposed.map((i: any, index: number) => (
            <label key={index}>
              <input
                type="checkbox"
                checked={addIndices.includes(index)}
                onChange={() =>
                  setAddIndices((p) =>
                    p.includes(index)
                      ? p.filter((i) => i !== index)
                      : [...p, index],
                  )
                }
              />
              {i.name} {amountText(i.amount)} {i.unit}
            </label>
          ))}
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("/shopping/" + id + "/refresh-apply", "POST", {
                  confirmed: true,
                  revision: diff.list_revision,
                  remove_ids: removeIds,
                  add: diff.proposed.filter((_: any, i: number) =>
                    addIndices.includes(i),
                  ),
                });
                setDiff(null);
                reload();
              })
            }
          >
            אישור השינויים שנבחרו בלבד
          </button>
        </Dialog>
      )}
    </>
  );
}
export function Pantry() {
  const { data, reload } = useResource<any>("/pantry");
  const matches = useResource<any>("/pantry/matches");
  const { run, busy, notify } = useAction();
  const [text, setText] = useState("");
  return (
    <>
      <PageTitle
        title="מה יש לי בבית?"
        subtitle="נמצא מה אפשר להכין, ונראה במפורש מה חסר."
        back={() => go("/more")}
      />
      <section className="k-panel">
        <label>
          מצרכים, מופרדים בפסיקים
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="קמח, עגבניות, לימון…"
          />
        </label>
        <div className="k-actions">
          <button
            className="button primary"
            disabled={busy || !text.trim()}
            onClick={() =>
              run(async () => {
                for (const name of text
                  .split(",")
                  .map((n) => n.trim())
                  .filter(Boolean))
                  await api("/pantry", "PUT", {
                    name,
                    amount: null,
                    unit: null,
                    staple: false,
                    use_soon: false,
                  });
                setText("");
                reload();
                matches.reload();
              })
            }
          >
            הוספה לבית
          </button>
          <button
            className="button outline"
            onClick={() => {
              const SR =
                (window as any).SpeechRecognition ||
                (window as any).webkitSpeechRecognition;
              if (!SR) {
                notify("זיהוי קולי אינו נתמך בדפדפן הזה. אפשר להקליד.");
                return;
              }
              const r = new SR();
              r.lang = "he-IL";
              r.onresult = (e: any) => setText(e.results[0][0].transcript);
              r.onerror = () => notify("לא הצלחנו לשמוע. אפשר להקליד.");
              r.start();
            }}
          >
            אמירת מצרכים
          </button>
        </div>
        <p className="k-note">
          קיום מצרך אינו מבטיח שיש מספיק. בדיקת כמות מתבצעת רק כשכמות ויחידה
          ידועות.
        </p>
        {data?.items.map((p: any) => (
          <div className="k-pantry-item" key={p.id}>
            <strong>{p.name}</strong>
            <span>
              {p.amount ? amountText(p.amount) + " " + p.unit : "כמות לא ידועה"}
            </span>
            <label>
              <input
                type="checkbox"
                checked={p.use_soon}
                disabled={busy}
                onChange={() =>
                  run(async () => {
                    await api("/pantry", "PUT", {
                      ...p,
                      use_soon: !p.use_soon,
                    });
                    reload();
                    matches.reload();
                  })
                }
              />{" "}
              לנצל בקרוב
            </label>
            <label>
              <input
                type="checkbox"
                checked={p.staple}
                disabled={busy}
                onChange={() =>
                  run(async () => {
                    await api("/pantry", "PUT", { ...p, staple: !p.staple });
                    reload();
                    matches.reload();
                  })
                }
              />{" "}
              מצרך יסוד
            </label>
            <button
              className="k-text"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const amount = window.prompt(
                      "כמות (ריק = לא ידוע)",
                      p.amount ? amountText(p.amount) : "",
                    ),
                    unit = window.prompt("יחידה", p.unit ?? "");
                  if (amount !== null) {
                    await api("/pantry", "PUT", {
                      ...p,
                      amount: amount ? parseAmount(amount) : null,
                      unit: unit || null,
                    });
                    reload();
                    matches.reload();
                  }
                })
              }
            >
              כמות
            </button>
            <button
              className="k-text"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/pantry/" + p.id, "DELETE");
                  reload();
                  matches.reload();
                })
              }
            >
              הסרה
            </button>
          </div>
        ))}
      </section>
      <div className="k-simple-grid">
        {matches.data?.items.map((m: any) => (
          <article className="k-panel" key={m.id}>
            <button className="k-text" onClick={() => go("/recipes/" + m.id)}>
              <h2>{m.title}</h2>
            </button>
            <strong>
              {m.group === "available"
                ? "כל המצרכים נמצאים"
                : m.group === "one_missing"
                  ? "חסר מצרך אחד"
                  : `חסרים ${m.missing.length} מצרכים`}
            </strong>
            {m.missing.length > 0 && <p>חסר: {m.missing.join(", ")}</p>}
            {m.unknown_quantity.length > 0 && (
              <p className="k-note">
                כמות זמינה לא נבדקה עבור: {m.unknown_quantity.join(", ")}
              </p>
            )}
            {m.use_soon.length > 0 && <p>אפשר לנצל: {m.use_soon.join(", ")}</p>}
          </article>
        ))}
      </div>
    </>
  );
}
