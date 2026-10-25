import { suggestCategoryPaths } from "../../shared/category-suggestions.ts";
import { categoryPath } from "../../shared/category-themes.ts";
import { useState, useEffect } from "react";
import {
  measurementDefaults,
  type MeasurementConfig,
} from "../../shared/measurements.ts";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import {
  type RecipeContent,
  type Ingredient,
  emptyRecipe,
} from "../../shared/model.ts";
import {
  amountText,
  parseAmount,
  applyEggDefault,
  readiness,
} from "../../shared/quantities.ts";
import { api } from "./api.ts";
import { useAction, useResource, Dialog } from "./ui.tsx";
const id = () => crypto.randomUUID();
export const blankIngredient = (): Ingredient => ({
  id: id(),
  group: "",
  original: "",
  name: "",
  amount: parseAmount(""),
  unit: "",
  note: "",
  alternatives: [],
  selected_alternative: null,
  egg_size: null,
  egg_size_origin: null,
  provenance: "manual",
  uncertainty: null,
});
export function ContentEditor({
  value,
  onChange,
}: {
  value: RecipeContent;
  onChange: (c: RecipeContent) => void;
}) {
  const change = <K extends keyof RecipeContent>(key: K, v: RecipeContent[K]) =>
    onChange({ ...value, [key]: v });
  const ingredient = (index: number, patch: Partial<Ingredient>) => {
    const ingredients = [...value.ingredients];
    ingredients[index] = applyEggDefault({
      ...ingredients[index],
      ...patch,
      provenance: "manual",
    });
    change("ingredients", ingredients);
  };
  return (
    <div className="k-editor">
      <label>
        שם המתכון
        <input
          value={value.title}
          onChange={(e) => change("title", e.target.value)}
          maxLength={200}
        />
      </label>
      <label>
        כמה מילים על המתכון
        <textarea
          value={value.description}
          onChange={(e) => change("description", e.target.value)}
        />
      </label>
      <fieldset>
        <legend>תפוקת הבסיס — כפי שנכתבה במקור</legend>
        <div className="k-grid-2">
          <label>
            כמות בסיס
            <input
              inputMode="decimal"
              value={value.yield?.amount ?? ""}
              onChange={(e) =>
                change(
                  "yield",
                  e.target.value
                    ? {
                        amount: e.target.value,
                        unit: value.yield?.unit ?? "",
                        pan: value.yield?.pan ?? null,
                      }
                    : null,
                )
              }
              placeholder="למשל 5 או 1½"
            />
          </label>
          <label>
            יחידת תפוקה
            <input
              value={value.yield?.unit ?? ""}
              onChange={(e) =>
                change("yield", {
                  amount: value.yield?.amount ?? "",
                  unit: e.target.value,
                  pan: value.yield?.pan ?? null,
                })
              }
              placeholder="מנות / עוגות / חלות / יחידות"
            />
          </label>
        </div>
        <label>
          תבנית וגודל, אם צוינו
          <input
            value={value.yield?.pan ?? ""}
            onChange={(e) =>
              change("yield", {
                amount: value.yield?.amount ?? "",
                unit: value.yield?.unit ?? "",
                pan: e.target.value || null,
              })
            }
          />
        </label>
        <small>
          אין תפוקה במקור? אפשר לשמור טיוטה ולהשלים לפני התאמת כמויות ואישור.
        </small>
      </fieldset>
      <div className="k-subtitle">
        <h2>מצרכים</h2>
        <button
          className="button quiet"
          onClick={() =>
            change("ingredients", [...value.ingredients, blankIngredient()])
          }
        >
          <Plus size={17} /> מצרך
        </button>
      </div>
      {value.ingredients.map((i, index) => (
        <fieldset key={i.id} className={i.uncertainty ? "k-uncertain" : ""}>
          <legend>
            מצרך {index + 1}
            {i.uncertainty ? " · דורש בדיקה" : ""}
          </legend>
          <div className="k-grid-2">
            <label>
              שם
              <input
                value={i.name}
                onChange={(e) => ingredient(index, { name: e.target.value })}
              />
            </label>
            <label>
              קבוצה
              <input
                value={i.group}
                onChange={(e) => ingredient(index, { group: e.target.value })}
                placeholder="בצק, מילוי, רוטב…"
              />
            </label>
            <label>
              כמות
              <input
                dir="auto"
                value={
                  i.amount.kind === "missing"
                    ? ""
                    : i.amount.text || amountText(i.amount)
                }
                onChange={(e) =>
                  ingredient(index, { amount: parseAmount(e.target.value) })
                }
                placeholder="½ / 1½ / 2–3 / לפי הטעם"
              />
            </label>
            <label>
              יחידה
              <input
                value={i.unit}
                onChange={(e) => ingredient(index, { unit: e.target.value })}
                placeholder="גרם, כוסות, כפית…"
              />
            </label>
          </div>
          <label>
            הערת הכנה
            <input
              value={i.note}
              onChange={(e) => ingredient(index, { note: e.target.value })}
              placeholder="מסונן, קצוץ…"
            />
          </label>
          <details>
            <summary>ניסוח מקורי, חלופות וגודל ביצה</summary>
            <label>
              הניסוח בתמונה
              <textarea
                value={i.original}
                onChange={(e) =>
                  ingredient(index, { original: e.target.value })
                }
              />
            </label>
            <label>
              גודל ביצה (ביצים שלמות בלבד)
              <select
                value={i.egg_size ?? ""}
                onChange={(e) =>
                  ingredient(index, {
                    egg_size: (e.target.value || null) as any,
                    egg_size_origin: e.target.value ? "manual" : null,
                  })
                }
              >
                <option value="">לא צוין / לא רלוונטי</option>
                {["S", "M", "L", "XL"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {i.egg_size_origin === "default" && (
              <p className="k-note">M — ברירת מחדל, לא צוין במקור.</p>
            )}
            {i.alternatives.length > 0 && (
              <label>
                <input
                  type="radio"
                  name={"alt-" + i.id}
                  checked={i.selected_alternative === -1}
                  onChange={() =>
                    ingredient(index, { selected_alternative: -1 })
                  }
                />{" "}
                שימוש במצרך הראשי: {i.name || "יש להשלים שם"}
              </label>
            )}
            {i.alternatives.map((a, ai) => (
              <div className="k-alternative" key={ai}>
                <label>
                  <input
                    type="radio"
                    name={"alt-" + i.id}
                    checked={i.selected_alternative === ai}
                    onChange={() =>
                      ingredient(index, { selected_alternative: ai })
                    }
                  />{" "}
                  שימוש בחלופה זו
                </label>
                <label>
                  שם החלופה
                  <input
                    value={a.name}
                    onChange={(e) =>
                      ingredient(index, {
                        alternatives: i.alternatives.map((a, j) =>
                          j === ai ? { ...a, name: e.target.value } : a,
                        ),
                      })
                    }
                  />
                </label>
                <div className="k-grid-2">
                  <label>
                    כמות
                    <input
                      value={a.amount.text || amountText(a.amount)}
                      onChange={(e) =>
                        ingredient(index, {
                          alternatives: i.alternatives.map((a, j) =>
                            j === ai
                              ? { ...a, amount: parseAmount(e.target.value) }
                              : a,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    יחידה
                    <input
                      value={a.unit}
                      onChange={(e) =>
                        ingredient(index, {
                          alternatives: i.alternatives.map((a, j) =>
                            j === ai ? { ...a, unit: e.target.value } : a,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
            <button
              className="button quiet"
              onClick={() =>
                ingredient(index, {
                  alternatives: i.alternatives.length
                    ? [
                        ...i.alternatives,
                        { name: "", unit: i.unit, amount: i.amount },
                      ]
                    : [{ name: "", unit: i.unit, amount: i.amount }],
                  selected_alternative: null,
                })
              }
            >
              הוספת חלופה
            </button>
          </details>
          {i.uncertainty && (
            <div className="k-alert">
              <p>{i.uncertainty}</p>
              <label>
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => ingredient(index, { uncertainty: null })}
                />{" "}
                בדקתי את השדה מול המקור ותיקנתי אותו
              </label>
            </div>
          )}
          <div className="k-row-controls">
            <button
              aria-label={`העלאת מצרך ${index + 1}`}
              disabled={index === 0}
              onClick={() => {
                const list = [...value.ingredients];
                [list[index - 1], list[index]] = [list[index], list[index - 1]];
                change("ingredients", list);
              }}
            >
              <ArrowUp size={16} />
            </button>
            <button
              aria-label={`הורדת מצרך ${index + 1}`}
              disabled={index === value.ingredients.length - 1}
              onClick={() => {
                const list = [...value.ingredients];
                [list[index + 1], list[index]] = [list[index], list[index + 1]];
                change("ingredients", list);
              }}
            >
              <ArrowDown size={16} />
            </button>
            <button
              aria-label={`מחיקת מצרך ${index + 1}`}
              onClick={() =>
                change(
                  "ingredients",
                  value.ingredients.filter((_, j) => j !== index),
                )
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        </fieldset>
      ))}
      <div className="k-subtitle">
        <h2>אופן ההכנה</h2>
        <button
          className="button quiet"
          onClick={() =>
            change("steps", [
              ...value.steps,
              {
                id: id(),
                group: "",
                text: "",
                duration_minutes: null,
                temperature_c: null,
                equipment: [],
                depends_on: [],
                links: [],
              },
            ])
          }
        >
          <Plus size={17} /> שלב
        </button>
      </div>
      {value.steps.map((s, index) => (
        <fieldset key={s.id}>
          <legend>שלב {index + 1}</legend>
          <label>
            הוראות
            <textarea
              value={s.text}
              onChange={(e) =>
                change(
                  "steps",
                  value.steps.map((s, j) =>
                    j === index ? { ...s, text: e.target.value } : s,
                  ),
                )
              }
            />
          </label>
          <div className="k-grid-2">
            <label>
              קבוצה
              <input
                value={s.group}
                onChange={(e) =>
                  change(
                    "steps",
                    value.steps.map((s, j) =>
                      j === index ? { ...s, group: e.target.value } : s,
                    ),
                  )
                }
              />
            </label>
            <label>
              משך, דקות
              <input
                type="number"
                min="0"
                value={s.duration_minutes ?? ""}
                onChange={(e) =>
                  change(
                    "steps",
                    value.steps.map((s, j) =>
                      j === index
                        ? {
                            ...s,
                            duration_minutes:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          }
                        : s,
                    ),
                  )
                }
              />
            </label>
            <label>
              טמפרטורה, °C
              <input
                type="number"
                value={s.temperature_c ?? ""}
                onChange={(e) =>
                  change(
                    "steps",
                    value.steps.map((s, j) =>
                      j === index
                        ? {
                            ...s,
                            temperature_c:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          }
                        : s,
                    ),
                  )
                }
              />
            </label>
            <label>
              ציוד, מופרד בפסיקים
              <input
                value={s.equipment.join(", ")}
                onChange={(e) =>
                  change(
                    "steps",
                    value.steps.map((s, j) =>
                      j === index
                        ? {
                            ...s,
                            equipment: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          }
                        : s,
                    ),
                  )
                }
              />
            </label>
          </div>
          <details>
            <summary>תלויות וקישור כמויות בטקסט</summary>
            <label>
              השלבים שחייבים להסתיים לפניו
              <select
                multiple
                value={s.depends_on}
                onChange={(e) =>
                  change(
                    "steps",
                    value.steps.map((s, j) =>
                      j === index
                        ? {
                            ...s,
                            depends_on: [...e.target.selectedOptions].map(
                              (o) => o.value,
                            ),
                          }
                        : s,
                    ),
                  )
                }
              >
                {value.steps
                  .filter((other) => other.id !== s.id)
                  .map((other, j) => (
                    <option value={other.id} key={other.id}>
                      {j + 1}. {other.text.slice(0, 60)}
                    </option>
                  ))}
              </select>
            </label>
            <p className="k-note">
              אפשר להכניס להוראות סימון כמו {"{{סוכר}}"} ולקשר אותו למצרך. רק
              הסימון הזה יוחלף בכמות המחושבת.
            </p>
            {s.links.map((l, li) => (
              <div className="k-grid-2" key={li}>
                <label>
                  סימון בטקסט
                  <input
                    value={l.placeholder}
                    onChange={(e) =>
                      change(
                        "steps",
                        value.steps.map((s, j) =>
                          j === index
                            ? {
                                ...s,
                                links: s.links.map((l, k) =>
                                  k === li
                                    ? { ...l, placeholder: e.target.value }
                                    : l,
                                ),
                              }
                            : s,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  מצרך
                  <select
                    value={l.ingredient_id}
                    onChange={(e) =>
                      change(
                        "steps",
                        value.steps.map((s, j) =>
                          j === index
                            ? {
                                ...s,
                                links: s.links.map((l, k) =>
                                  k === li
                                    ? { ...l, ingredient_id: e.target.value }
                                    : l,
                                ),
                              }
                            : s,
                        ),
                      )
                    }
                  >
                    <option value="">לבחור</option>
                    {value.ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  חלק מהכמות, למשל 1/2
                  <input
                    dir="ltr"
                    value={l.portion}
                    onChange={(e) =>
                      change(
                        "steps",
                        value.steps.map((s, j) =>
                          j === index
                            ? {
                                ...s,
                                links: s.links.map((l, k) =>
                                  k === li
                                    ? { ...l, portion: e.target.value }
                                    : l,
                                ),
                              }
                            : s,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
            <button
              className="button quiet"
              onClick={() =>
                change(
                  "steps",
                  value.steps.map((s, j) =>
                    j === index
                      ? {
                          ...s,
                          links: [
                            ...s.links,
                            {
                              placeholder: "{{כמות}}",
                              ingredient_id: "",
                              portion: "1",
                            },
                          ],
                        }
                      : s,
                  ),
                )
              }
            >
              קישור כמות
            </button>
          </details>
          <div className="k-row-controls">
            <button
              aria-label={`העלאת שלב ${index + 1}`}
              disabled={index === 0}
              onClick={() => {
                const steps = [...value.steps];
                [steps[index - 1], steps[index]] = [
                  steps[index],
                  steps[index - 1],
                ];
                change("steps", steps);
              }}
            >
              <ArrowUp size={16} />
            </button>
            <button
              aria-label={`הורדת שלב ${index + 1}`}
              disabled={index === value.steps.length - 1}
              onClick={() => {
                const steps = [...value.steps];
                [steps[index + 1], steps[index]] = [
                  steps[index],
                  steps[index + 1],
                ];
                change("steps", steps);
              }}
            >
              <ArrowDown size={16} />
            </button>
          </div>
          <button
            className="k-text danger"
            onClick={() =>
              change(
                "steps",
                value.steps.filter((_, j) => j !== index),
              )
            }
          >
            מחיקת שלב
          </button>
        </fieldset>
      ))}
      <div className="k-grid-2">
        <label>
          זמן עבודה פעיל, דקות
          <input
            type="number"
            min="0"
            value={value.active_minutes ?? ""}
            onChange={(e) =>
              change(
                "active_minutes",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </label>
        <label>
          זמן כולל, דקות
          <input
            type="number"
            min="0"
            value={value.total_minutes ?? ""}
            onChange={(e) =>
              change(
                "total_minutes",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </label>
        <label>
          סיווג
          <select
            value={value.classification}
            onChange={(e) => change("classification", e.target.value as any)}
          >
            {["לא ידוע", "בשרי", "חלבי", "פרווה"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          קושי
          <select
            value={value.difficulty}
            onChange={(e) =>
              onChange({
                ...value,
                difficulty: e.target.value as any,
                difficulty_origin: "manual",
              })
            }
          >
            {["לא ידוע", "קל", "בינוני", "מורכב"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        תגים, מופרדים בפסיקים
        <input
          value={value.tags.join(",")}
          onChange={(e) =>
            change(
              "tags",
              e.target.value.split(",").map((s) => s.trim()),
            )
          }
        />
      </label>
      <label>
        ציוד כללי
        <input
          value={value.equipment.join(",")}
          onChange={(e) =>
            change(
              "equipment",
              e.target.value.split(",").map((s) => s.trim()),
            )
          }
        />
      </label>
      <label>
        ממי המתכון
        <input
          value={value.source_name}
          onChange={(e) => change("source_name", e.target.value)}
        />
      </label>
      <label>
        הסיפור של המתכון
        <textarea
          value={value.story}
          onChange={(e) => change("story", e.target.value)}
        />
      </label>
      <label>
        הערות וטיפים
        <textarea
          value={value.notes}
          onChange={(e) => change("notes", e.target.value)}
        />
      </label>
      {value.split_suggestion && (
        <div className="k-alert">
          <strong>המקור עשוי להכיל כמה מתכונים</strong>
          <p>{value.split_suggestion}</p>
          <button
            className="button outline"
            onClick={() => change("split_suggestion", null)}
          >
            בדקתי את המקור ואישרתי שזה מתכון אחד
          </button>
          <button
            className="button outline"
            onClick={() => change("split_suggestion", null)}
          >
            פיצלתי את המקור לטיוטות נפרדות ובדקתי כל אחת
          </button>
        </div>
      )}
      {value.uncertainties.map((u, index) => (
        <div className="k-alert" key={index}>
          <strong>{u.path}</strong>
          <p>{u.reason}</p>
          <button
            className="button outline"
            onClick={() =>
              change(
                "uncertainties",
                value.uncertainties.filter((_, j) => j !== index),
              )
            }
          >
            בדקתי ותיקנתי את השדה מול המקור
          </button>
        </div>
      ))}
      <details>
        <summary>הטקסט שחולץ מהמקור</summary>
        <textarea
          value={value.raw_text}
          onChange={(e) => change("raw_text", e.target.value)}
        />
      </details>
    </div>
  );
}
export function CategoryPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, reload } = useResource<{ items: any[] }>("/categories");
  const [paths, setPaths] = useState(""),
    [preview, setPreview] = useState<any>(null);
  const { run, busy } = useAction();
  const label = (c: any): string => {
    const p = data?.items.find((p) => p.id === c.parent_id);
    return p ? label(p) + " ← " + c.name : c.name;
  };
  return (
    <fieldset>
      <legend>קטגוריות — בחירה ואישור</legend>
      <div className="k-category-options">
        {data?.items.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={() =>
                onChange(
                  selected.includes(c.id)
                    ? selected.filter((id) => id !== c.id)
                    : [...selected, c.id],
                )
              }
            />
            {label(c)}
          </label>
        ))}
      </div>
      <label>
        יצירת מסלול חדש (רמות מופרדות ב־ / )
        <input
          value={paths}
          onChange={(e) => {
            setPaths(e.target.value);
            setPreview(null);
          }}
          placeholder="בישול / תוספות"
        />
      </label>
      <button
        className="button outline"
        disabled={!paths.trim() || busy}
        onClick={() =>
          run(async () =>
            setPreview(
              await api("/categories/preview", "POST", {
                paths: [paths.split("/").map((s) => s.trim())],
              }),
            ),
          )
        }
      >
        בדיקת המסלול
      </button>
      {preview && (
        <div className="k-note">
          <p>
            {preview.new_images} תמונות קטגוריה חדשות יתווספו לתור עם האישור.
            בלי חיבור AI הן ימתינו.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await api("/categories", "POST", {
                  paths: [paths.split("/").map((s) => s.trim())],
                  confirmed: true,
                  expected_new_images: preview.new_images,
                });
                onChange([...new Set([...selected, ...result.ids])]);
                setPaths("");
                setPreview(null);
                reload();
              })
            }
          >
            אישור יצירת הקטגוריות
          </button>
        </div>
      )}
    </fieldset>
  );
}
export function RecipeEditor({
  recipe,
  close,
  saved,
}: {
  recipe?: any;
  close: () => void;
  saved: (id: string) => void;
}) {
  const [content, setContent] = useState<RecipeContent>(
      recipe?.content ?? emptyRecipe(),
    ),
    [categories, setCategories] = useState<string[]>(
      recipe?.category_ids ?? [],
    );
  const { run, busy, notify } = useAction();
  const [measurements, setMeasurements] = useState<MeasurementConfig>(
    recipe?.measurement_config ?? measurementDefaults,
  );
  const tree = useResource<any>("/categories"),
    [categoryTouched, setCategoryTouched] = useState(false);
  const proposals = suggestCategoryPaths(content);
  useEffect(() => {
    if (recipe || categoryTouched || !tree.data) return;
    const ids = proposals
      .map(
        (path) =>
          tree.data.items.find(
            (c: any) =>
              categoryPath(tree.data.items, c.id).join("/") === path.join("/"),
          )?.id,
      )
      .filter(Boolean);
    setCategories(ids);
  }, [content, tree.data, categoryTouched]);
  const issues = readiness(content);
  async function save(status: "draft" | "published") {
    const result = await api(
      recipe ? `/recipes/${recipe.id}` : "/recipes",
      recipe ? "PUT" : "POST",
      {
        revision: recipe?.revision,
        content,
        status,
        category_ids: categories,
        confirm_categories: true,
        measurement_config: measurements,
      },
    );
    notify(status === "draft" ? "הטיוטה נשמרה בשרת" : "המתכון אושר ונשמר");
    saved(result.id);
  }
  return (
    <Dialog title={recipe ? "עריכת מתכון" : "מתכון חדש"} close={close}>
      <ContentEditor value={content} onChange={setContent} />
      <fieldset>
        <legend>מידות מוגדרות למתכון הזה בלבד</legend>
        <label>
          נפח כוס במ״ל (ריק = לא מוגדר)
          <input
            type="number"
            min="1"
            max="1000"
            value={measurements.cup_ml ?? ""}
            onChange={(e) =>
              setMeasurements({
                ...measurements,
                cup_ml: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
        {measurements.packages.map((p, index) => (
          <div className="k-grid-2" key={index}>
            <label>
              שם מצרך באריזה
              <input
                value={p.ingredient}
                onChange={(e) =>
                  setMeasurements({
                    ...measurements,
                    packages: measurements.packages.map((p, j) =>
                      j === index ? { ...p, ingredient: e.target.value } : p,
                    ),
                  })
                }
              />
            </label>
            <label>
              גרם באריזה
              <input
                value={p.grams}
                onChange={(e) =>
                  setMeasurements({
                    ...measurements,
                    packages: measurements.packages.map((p, j) =>
                      j === index ? { ...p, grams: e.target.value } : p,
                    ),
                  })
                }
              />
            </label>
          </div>
        ))}
        <button
          className="button outline"
          onClick={() =>
            setMeasurements({
              ...measurements,
              packages: [
                ...measurements.packages,
                { ingredient: "", grams: "" },
              ],
            })
          }
        >
          הגדרת משקל אריזה
        </button>
        <p className="k-note">
          כוס יכולה להפוך לנפח במ״ל, אך לא לגרמים ללא הגדרה נפרדת. משקל אריזה חל
          רק על שם המצרך שהוגדר.
        </p>
      </fieldset>
      {!recipe && !categoryTouched && proposals.length > 0 && (
        <p className="k-note">
          סיווג מוצע: {proposals.map((p) => p.join(" ← ")).join(" · ")}. אפשר
          לשנות את הבחירה; שמירת המתכון מאשרת את הקטגוריות המסומנות.
        </p>
      )}
      <CategoryPicker
        selected={categories}
        onChange={(ids) => {
          setCategoryTouched(true);
          setCategories(ids);
        }}
      />
      {(issues.length > 0 || !categories.length) && (
        <details className="k-note">
          <summary>פרטים שאפשר להשלים בהמשך — אינם מעכבים שמירה</summary>
          <ul>
            {[
              ...issues,
              ...(!categories.length ? ["המתכון יישמר ללא קטגוריה"] : []),
            ].map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="k-save-bar">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => run(() => save("published"))}
        >
          אישור ושמירת מתכון
        </button>
        <button
          className="button outline"
          disabled={busy}
          onClick={() => run(() => save("draft"))}
        >
          שמירת טיוטה
        </button>
      </div>
    </Dialog>
  );
}
