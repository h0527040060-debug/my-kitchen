import { useState } from "react";
import { categoryPath, categoryTheme } from "../../shared/category-themes.ts";
import { MediaImage } from "./ui.tsx";
export function CategoryPicture({
  category,
  all,
}: {
  category: any;
  all: any[];
}) {
  const theme = category.theme ?? categoryTheme(categoryPath(all, category.id));
  const fallback = (
    <span
      className="k-category-art"
      role="img"
      aria-label={theme.disclosure}
      style={{
        backgroundImage: `url(${theme.url})`,
        backgroundSize: `${theme.columns * 100}% ${theme.columns * 100}%`,
        backgroundPosition: theme.position,
      }}
    />
  );
  return category.media_id ? (
    <MediaImage
      id={category.media_id}
      alt={category.name}
      fallback={fallback}
    />
  ) : (
    fallback
  );
}
export function CategoryBrowser({
  items,
  selected,
  change,
}: {
  items: any[];
  selected: string;
  change: (id: string) => void;
}) {
  const [browseId, setBrowseId] = useState("");
  const roots = items
    .filter((c) => !c.parent_id)
    .sort((a, b) => {
      const rank = (n: string) => ["בישול", "אפייה", "קינוחים"].indexOf(n);
      return (
        (rank(a.name) < 0 ? 99 : rank(a.name)) -
        (rank(b.name) < 0 ? 99 : rank(b.name))
      );
    });
  const browse = items.find((c) => c.id === browseId) ?? roots[0];
  const children = items.filter((c) => c.parent_id === browse?.id),
    path = browse ? categoryPath(items, browse.id) : [];
  return (
    <section className="k-category-browser" aria-label="קטגוריות ותתי קטגוריות">
      <div className="k-category-roots" aria-label="קטגוריות ראשיות">
        {roots.map((c) => (
          <button
            key={c.id}
            aria-label={c.name}
            className={path[0] === c.name ? "browsing" : ""}
            aria-pressed={selected === c.id}
            onClick={() => {
              setBrowseId(c.id);
              change(c.id);
            }}
          >
            <CategoryPicture category={c} all={items} />
            <span>
              {c.name}
              <small>{c.recipe_count ?? 0}</small>
            </span>
          </button>
        ))}
      </div>
      <nav className="k-category-trail" aria-label="מסלול הקטגוריה">
        <button aria-pressed={!selected} onClick={() => change("")}>
          כל המתכונים
        </button>
        {path.map((name, i) => {
          const id = items.find(
            (c) =>
              categoryPath(items, c.id).join("/") ===
              path.slice(0, i + 1).join("/"),
          )?.id;
          return (
            <button
              key={i}
              onClick={() => {
                if (id) {
                  setBrowseId(id);
                  change(id);
                }
              }}
            >
              <span aria-hidden="true">‹</span> {name}
            </button>
          );
        })}
      </nav>
      {children.length > 0 && (
        <div
          className="k-category-slider"
          role="region"
          aria-label={`תתי קטגוריות ${browse.name}`}
          tabIndex={0}
        >
          {children.map((c) => (
            <button
              key={c.id}
              aria-label={c.name}
              aria-pressed={selected === c.id}
              onClick={() => {
                change(c.id);
                if (items.some((x) => x.parent_id === c.id)) setBrowseId(c.id);
              }}
            >
              <CategoryPicture category={c} all={items} />
              <span className="k-category-caption">
                <strong>{c.name}</strong>
                <small>{c.recipe_count ?? 0}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <small className="k-art-disclosure">
        תמונות הקטגוריות הן תמונות המחשה באמצעות AI
      </small>
    </section>
  );
}
