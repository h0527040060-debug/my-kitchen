import { useState } from "react";
import { api } from "./api.ts";
export type KitchenDesign = "sage" | "night" | "paper";
export const designs = [
  {
    id: "sage" as const,
    name: "מרווה",
    description: "שמנת וירוק, צילום חם וכרטיסים רכים",
  },
  {
    id: "night" as const,
    name: "לילה",
    description: "כהה ואלגנטי, תמונות בולטות ונגיעות פיסטוק",
  },
  {
    id: "paper" as const,
    name: "נקי וחד",
    description: "לבן וטרקוטה, כרטיסים צפופים וקווים חדים",
  },
];
export function DesignChooser({
  design,
  change,
  selected,
}: {
  design: KitchenDesign;
  change: (id: KitchenDesign) => void;
  selected: (id: KitchenDesign) => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const info = designs.find((d) => d.id === design)!;
  return (
    <section className="k-design-chooser" aria-label="בחירת עיצוב לנייד">
      <div className="k-design-intro">
        <strong>שלושה עיצובים למטבח שלך</strong>
        <span>אפשר לטייל במתכונים ובמסכים בכל עיצוב</span>
        <a href="/">חזרה למטבח</a>
      </div>
      <div className="k-design-options" role="group" aria-label="חלופות העיצוב">
        {designs.map((d, i) => (
          <button
            key={d.id}
            aria-pressed={design === d.id}
            onClick={() => {
              change(d.id);
              setMessage("");
            }}
          >
            <i className={`k-design-swatch ${d.id}`} />
            <span>
              {i + 1}. {d.name}
            </span>
          </button>
        ))}
      </div>
      <div className="k-design-description">
        <span>{info.description}</span>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/appearance", "PUT", { design });
              selected(design);
              setMessage("העיצוב שבחרת נשמר לכל המכשירים שלך");
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          בחירה בעיצוב הזה
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
