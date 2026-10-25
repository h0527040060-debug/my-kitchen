import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Mic,
  Volume2,
  Timer,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { api, go } from "./api.ts";
import { useAction, useResource, LoadState, PageTitle, Dialog } from "./ui.tsx";
import {
  scaleRecipe,
  amountText,
  hasBaseYield,
} from "../../shared/quantities.ts";
import { selectedIngredient } from "../../shared/planning.ts";
export function Cooking({ id }: { id: string }) {
  const { data, error, loading, reload, setData } = useResource<any>(
    "/cooking/" + id,
    15000,
  );
  const { run, busy, notify } = useAction();
  const [mode, setMode] = useState<"ingredients" | "steps">("ingredients"),
    [single, setSingle] = useState(false),
    [finish, setFinish] = useState(false),
    [rating, setRating] = useState(""),
    [notes, setNotes] = useState(""),
    [listening, setListening] = useState(false),
    [wake, setWake] = useState(false),
    [tick, setTick] = useState(Date.now());
  const recognition = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null),
    streamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(
    () => () => {
      recognition.current?.stop();
      if (recorderRef.current) {
        recorderRef.current.onstop = null;
        if (recorderRef.current.state === "recording")
          recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      window.speechSynthesis?.cancel();
    },
    [],
  );
  useEffect(() => {
    let lock: any = null;
    let active = true;
    if (wake && "wakeLock" in navigator)
      (navigator as any).wakeLock
        .request("screen")
        .then((l: any) => {
          if (active) lock = l;
          else l.release();
        })
        .catch(() => notify("לא ניתן להשאיר את המסך פעיל בדפדפן הזה"));
    return () => {
      active = false;
      lock?.release();
    };
  }, [wake]);
  if (!data)
    return <LoadState loading={loading} error={error} retry={reload} />;
  const c = data.cooking,
    scaled = c.target
      ? scaleRecipe(c.snapshot, c.target)
      : (c.snapshot as ReturnType<typeof scaleRecipe>),
    step = scaled.steps[c.step_index],
    active = c.state === "active";
  async function patch(patch: any) {
    const result = await api("/cooking/" + id, "PATCH", {
      revision: c.revision,
      checked_ingredients: c.checked_ingredients,
      checked_steps: c.checked_steps,
      step_index: c.step_index,
      ...patch,
    });
    setData({ ...data, cooking: result });
  }
  async function command(text: string) {
    const normalized = text.trim().replace(/[.!?]/g, "");
    if (normalized.includes("הקרא שוב")) {
      speak();
      return;
    }
    if (normalized.includes("הבא")) {
      await patch({
        step_index: Math.max(
          0,
          Math.min(c.step_index + 1, scaled.steps.length - 1),
        ),
      });
      setMode("steps");
      return;
    }
    if (normalized.includes("הקודם")) {
      await patch({ step_index: Math.max(0, c.step_index - 1) });
      setMode("steps");
      return;
    }
    if (normalized.includes("סמן שבוצע") && step) {
      await patch({
        checked_steps: [...new Set([...c.checked_steps, step.id])],
      });
      return;
    }
    notify("הפקודה לא זוהתה. אפשר לומר הבא, הקודם, סמן שבוצע או הקרא שוב.");
  }
  function speak() {
    if (!step) return;
    const voices = window.speechSynthesis?.getVoices() ?? [],
      hebrew = voices.find((v) => v.lang.startsWith("he"));
    if (hebrew) {
      const utterance = new SpeechSynthesisUtterance(step.text);
      utterance.lang = "he-IL";
      utterance.voice = hebrew;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } else
      notify("אין קול עברי זמין בדפדפן הזה. אפשר לקרוא את השלבים על המסך.");
  }
  async function listen() {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const r = new SpeechRecognition();
      recognition.current = r;
      r.lang = "he-IL";
      r.continuous = false;
      r.interimResults = false;
      r.onresult = (event: any) => {
        setListening(false);
        run(() => command(event.results[0][0].transcript));
      };
      r.onerror = () => {
        setListening(false);
        notify("הזיהוי הקולי לא הצליח. אפשר להמשיך במגע או לנסות שוב.");
      };
      r.onend = () => setListening(false);
      try {
        r.start();
        setListening(true);
      } catch {
        notify("המיקרופון אינו זמין");
      }
      return;
    }
    notify("הדפדפן אינו תומך בזיהוי דיבור בעברית. כל הפעולות זמינות במגע.");
  }
  return (
    <>
      <PageTitle
        title={c.snapshot.title || "מתכון ללא שם"}
        subtitle={`בישול ${active ? "פעיל" : c.state === "completed" ? "שהושלם" : "שבוטל"} · גרסה ${c.recipe_revision} · ${c.target ? c.target + " " + c.snapshot.yield?.unit : "כמויות המקור"}`}
        back={() => go("/recipes/" + c.recipe_id)}
      ></PageTitle>
      <div className="k-note">
        הבישול מחזיק עותק קבוע. עריכת המתכון אינה משנה את הכמויות או הסימונים
        כאן.
      </div>
      <div className="k-actions">
        <button
          className={
            mode === "ingredients" ? "button primary" : "button outline"
          }
          onClick={() => setMode("ingredients")}
        >
          מכינים מצרכים ({c.checked_ingredients.length}/
          {scaled.ingredients.length})
        </button>
        <button
          className={mode === "steps" ? "button primary" : "button outline"}
          onClick={() => setMode("steps")}
        >
          שלבי ההכנה ({c.checked_steps.length}/{scaled.steps.length})
        </button>
      </div>
      {active && (
        <div className="k-cook-tools">
          <button
            className="button outline"
            disabled={busy || !hasBaseYield(c.snapshot)}
            onClick={() =>
              run(async () => {
                const target = window.prompt(
                  "כמות חדשה באותה יחידת תפוקה",
                  c.target || c.snapshot.yield?.amount || "",
                );
                if (
                  target &&
                  target !== c.target &&
                  window.confirm(
                    "חלק מהמצרכים אולי כבר נמדדו. לאשר שינוי בכמויות של הבישול הפעיל?",
                  )
                )
                  await patch({ target, confirm_quantity_change: true });
              })
            }
          >
            שינוי כמות באישור
          </button>
          <label>
            <input
              type="checkbox"
              checked={wake}
              onChange={(e) => setWake(e.target.checked)}
            />{" "}
            שמירת מסך פעיל, אם נתמך
          </label>
        </div>
      )}
      {mode === "ingredients" ? (
        <section className="k-panel k-cook-checks">
          <h2>קודם מכינים את הכול</h2>
          {scaled.ingredients.map((raw) => {
            const i = selectedIngredient(raw);
            return (
              <label
                key={i.id}
                className={c.checked_ingredients.includes(i.id) ? "done" : ""}
              >
                <input
                  type="checkbox"
                  disabled={busy || !active}
                  checked={c.checked_ingredients.includes(i.id)}
                  onChange={() =>
                    run(() =>
                      patch({
                        checked_ingredients: c.checked_ingredients.includes(
                          i.id,
                        )
                          ? c.checked_ingredients.filter(
                              (id: string) => id !== i.id,
                            )
                          : [...c.checked_ingredients, i.id],
                      }),
                    )
                  }
                />
                <span>
                  <bdi>{amountText(i.amount)}</bdi> {i.unit}{" "}
                  <strong>{i.name}</strong> {i.note}
                </span>
              </label>
            );
          })}
        </section>
      ) : (
        <section className="k-panel">
          <div className="k-subtitle">
            <h2>עכשיו מבשלים</h2>
            <label>
              <input
                type="checkbox"
                checked={single}
                onChange={(e) => setSingle(e.target.checked)}
              />{" "}
              שלב יחיד, טקסט גדול
            </label>
          </div>
          {(single ? [step] : scaled.steps).filter(Boolean).map((s: any) => {
            const index = scaled.steps.findIndex((x) => x.id === s.id);
            return (
              <article
                className={single ? "k-cook-step big" : "k-cook-step"}
                key={s.id}
              >
                <label>
                  <input
                    type="checkbox"
                    disabled={busy || !active}
                    checked={c.checked_steps.includes(s.id)}
                    onChange={() =>
                      run(() =>
                        patch({
                          checked_steps: c.checked_steps.includes(s.id)
                            ? c.checked_steps.filter(
                                (id: string) => id !== s.id,
                              )
                            : [...c.checked_steps, s.id],
                        }),
                      )
                    }
                  />
                  <strong>שלב {index + 1}</strong>
                </label>
                <p>{s.text}</p>
                <div className="k-meta">
                  <span>
                    {s.temperature_c !== null ? `${s.temperature_c}°C` : ""}
                  </span>
                  <span>
                    {s.duration_minutes !== null
                      ? `${s.duration_minutes} דקות`
                      : ""}
                  </span>
                </div>
                {s.duration_minutes > 0 && (
                  <button
                    className="button outline"
                    disabled={busy || !active}
                    onClick={() =>
                      run(async () => {
                        await api(`/cooking/${id}/timers`, "POST", {
                          name: `שלב ${index + 1}`,
                          duration_seconds: Math.round(s.duration_minutes * 60),
                        });
                        reload();
                      })
                    }
                  >
                    <Timer size={16} /> טיימר לשלב
                  </button>
                )}
              </article>
            );
          })}
          {single && (
            <div className="k-actions">
              <button
                className="button outline"
                disabled={busy || !active || c.step_index === 0}
                onClick={() =>
                  run(() => patch({ step_index: c.step_index - 1 }))
                }
              >
                <ChevronRight /> הקודם
              </button>
              <span>
                {c.step_index + 1} / {scaled.steps.length}
              </span>
              <button
                className="button primary"
                disabled={
                  busy || !active || c.step_index >= scaled.steps.length - 1
                }
                onClick={() =>
                  run(() => patch({ step_index: c.step_index + 1 }))
                }
              >
                הבא <ChevronLeft />
              </button>
            </div>
          )}
        </section>
      )}
      <section className="k-panel">
        <h2>ידיים מלוכלכות?</h2>
        <p className="k-note">
          פקודות: הבא, הקודם, סמן שבוצע, הקרא שוב. הרשאת מיקרופון מתבקשת רק
          בלחיצה.
        </p>
        <div className="k-actions">
          <button
            className={listening ? "button primary" : "button outline"}
            disabled={busy || !active}
            onClick={() => {
              if (listening) {
                recognition.current?.stop();
                if (recorderRef.current?.state === "recording")
                  recorderRef.current.stop();
                setListening(false);
              } else void listen();
            }}
          >
            <Mic size={18} />{" "}
            {listening ? "מקשיב… עצירה" : "פקודה קולית בעברית"}
          </button>

          <button className="button outline" disabled={!step} onClick={speak}>
            <Volume2 size={18} /> הקראת השלב הנוכחי
          </button>
        </div>
      </section>
      <section className="k-panel">
        <h2>הטיימרים שלי</h2>
        <p className="k-note">
          הזמן מחושב לפי מועד הסיום בשרת. אין הבטחה לצלצול כשהטלפון נעול או
          כשהדפדפן ברקע.
        </p>
        {data.timers.map((t: any) => {
          const remaining =
            t.state === "running"
              ? Math.max(
                  0,
                  Math.ceil((new Date(t.ends_at).getTime() - tick) / 1000),
                )
              : t.remaining_seconds;
          return (
            <div className="k-timer" key={t.id}>
              <strong>{t.name}</strong>
              <bdi role="timer">
                {Math.floor(remaining / 60)}:
                {String(remaining % 60).padStart(2, "0")}
                {remaining === 0 ? " · הזמן הסתיים" : ""}
              </bdi>
              <div className="k-actions">
                {[
                  ["start", Play, "הפעלה"],
                  ["pause", Pause, "השהיה"],
                  ["reset", RotateCcw, "איפוס"],
                ].map(([action, Icon, label]: any) => (
                  <button
                    className="k-icon"
                    key={action}
                    aria-label={label + " " + t.name}
                    disabled={busy || !active}
                    onClick={() =>
                      run(async () => {
                        await api("/timers/" + t.id, "PATCH", { action });
                        reload();
                      })
                    }
                  >
                    <Icon size={18} />
                  </button>
                ))}
                <button
                  className="k-text"
                  disabled={busy || !active}
                  onClick={() =>
                    run(async () => {
                      const name = window.prompt("שם הטיימר", t.name),
                        minutes = Number(
                          window.prompt(
                            "משך בדקות",
                            String(t.duration_seconds / 60),
                          ),
                        );
                      if (name && minutes > 0) {
                        await api("/timers/" + t.id, "PATCH", {
                          action: "edit",
                          name,
                          duration_seconds: Math.round(minutes * 60),
                        });
                        reload();
                      }
                    })
                  }
                >
                  עריכה
                </button>
              </div>
            </div>
          );
        })}
        <button
          className="button outline"
          disabled={busy || !active}
          onClick={() =>
            run(async () => {
              const name = window.prompt("שם הטיימר"),
                minutes = Number(window.prompt("משך בדקות"));
              if (name && minutes > 0) {
                await api(`/cooking/${id}/timers`, "POST", {
                  name,
                  duration_seconds: Math.round(minutes * 60),
                });
                reload();
              }
            })
          }
        >
          טיימר נוסף
        </button>
      </section>
      {active && (
        <div className="k-save-bar">
          <button className="button primary" onClick={() => setFinish(true)}>
            <Check size={17} /> סיום בישול
          </button>
          <button
            className="button outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (window.confirm("לבטל את הבישול? ההיסטוריה תישמר.")) {
                  await api(`/cooking/${id}/finish`, "POST", {
                    revision: c.revision,
                    state: "cancelled",
                    rating: null,
                    notes: "",
                  });
                  reload();
                }
              })
            }
          >
            ביטול הבישול
          </button>
        </div>
      )}
      {finish && (
        <Dialog title="איך יצא?" close={() => setFinish(false)}>
          <label>
            דירוג
            <select value={rating} onChange={(e) => setRating(e.target.value)}>
              <option value="">ללא דירוג</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            מה נרצה לזכור לפעם הבאה?
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <p className="k-note">
            ההערה תישמר עם כמות {c.target} וגרסה {c.recipe_revision}.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(`/cooking/${id}/finish`, "POST", {
                  revision: c.revision,
                  state: "completed",
                  rating: rating ? Number(rating) : null,
                  notes,
                });
                setFinish(false);
                reload();
                notify("הבישול הושלם ונוסף להיסטוריה");
              })
            }
          >
            שמירת ניסיון וסיום
          </button>
        </Dialog>
      )}
    </>
  );
}
