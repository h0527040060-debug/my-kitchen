import { DesignChooser, type KitchenDesign } from "./designs.tsx";
import { InstallPrompt } from "./install.tsx";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  CalendarDays,
  ShoppingBasket,
  Menu,
  ChefHat,
  Plus,
  X,
  LogOut,
} from "lucide-react";
import { api, go } from "./api.ts";
import { NoticeContext, useAction, LoadState } from "./ui.tsx";
import { RecipeHome, RecipeDetail } from "./recipes.tsx";
import { Imports } from "./imports.tsx";
import { Cooking } from "./cooking.tsx";
import {
  Meals,
  MealDetail,
  Shopping,
  ShoppingDetail,
  Pantry,
} from "./plans.tsx";
import { More } from "./more.tsx";
import "./kitchen.css";
import { AccountRecovery } from "./account.tsx";
export default function KitchenApp() {
  const preview =
    window.location.pathname === "/designs" ||
    new URLSearchParams(window.location.search).has("design");
  const requestedDesign = new URLSearchParams(window.location.search).get(
    "design",
  );
  const [design, setDesign] = useState<KitchenDesign>(
    ["sage", "night", "paper"].includes(requestedDesign ?? "")
      ? (requestedDesign as KitchenDesign)
      : "sage",
  );
  const [session, setSession] = useState<any>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [route, setRoute] = useState(window.location.hash.slice(1) || "/recipes");
  useEffect(() => {
    let active = true;
    api("/session")
      .then((s) => {
        if (active) setSession(s);
      })
      .catch((e) => {
        if (e.status !== 401 && active) setError(e.message);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    const change = () => {
      setRoute(window.location.hash.slice(1) || "/recipes");
      window.scrollTo({ top: 0 });
    };
    const logout = () => setSession(null);
    window.addEventListener("hashchange", change);
    window.addEventListener("kitchen-signed-out", logout);
    return () => {
      active = false;
      window.removeEventListener("hashchange", change);
      window.removeEventListener("kitchen-signed-out", logout);
    };
  }, []);
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        { sage: "#52664c", night: "#121b16", paper: "#ffffff" }[design],
      );
  }, [design]);
  useEffect(() => {
    if (!session || preview) return;
    api("/settings")
      .then((s: any) => {
        if (["sage", "night", "paper"].includes(s.preferences.interface_design))
          setDesign(s.preferences.interface_design);
      })
      .catch(() => {});
  }, [session?.email, preview]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 10000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [tab, id] = route.split("?")[0].split("/").filter(Boolean);
  let content;
  if (!ready) content = <LoadState loading error="" retry={() => {}} />;
  else if (!session)
    content = <Login connected={setSession} serverError={error} />;
  else
    content =
      tab === "recipes" ? (
        id ? (
          <RecipeDetail key={id} id={id} />
        ) : (
          <RecipeHome key={route} />
        )
      ) : tab === "imports" ? (
        <Imports />
      ) : tab === "cook" && id ? (
        <Cooking key={id} id={id} />
      ) : tab === "meals" ? (
        id ? (
          <MealDetail key={id} id={id} />
        ) : (
          <Meals />
        )
      ) : tab === "shopping" ? (
        id ? (
          <ShoppingDetail key={id} id={id} />
        ) : (
          <Shopping />
        )
      ) : tab === "pantry" ? (
        <Pantry />
      ) : (
        <More />
      );
  return (
    <NoticeContext value={setNotice}>
      <div className="kitchen" data-design={design}>
        {preview && (
          <DesignChooser
            design={design}
            change={(id) => {
              setDesign(id);
              const url = new URL(window.location.href);
              url.searchParams.set("design", id);
              window.history.replaceState({}, "", url);
            }}
            selected={setDesign}
          />
        )}
        <a className="skip-link" href="#k-main">
          דילוג לתוכן
        </a>
        <header className="k-header">
          <a href="#/recipes" className="k-brand">
            <ChefHat strokeWidth={1.4} />
            <span>
              המטבח שלי<span>קצת השראה, הרבה טעם</span>
            </span>
          </a>
          {session && (
            <button
              className="k-icon k-header-add"
              aria-label="מתכון חדש"
              onClick={() => {
                if (tab === "recipes" && !id)
                  window.dispatchEvent(new Event("kitchen-add-recipe"));
                else go("/recipes?new=1");
              }}
            >
              <Plus size={24} />
            </button>
          )}
          {session && (
            <button
              className="k-icon"
              aria-label="יציאה מהחשבון"
              onClick={async () => {
                try {
                  await api("/logout", "POST", {});
                  setSession(null);
                } catch (e) {
                  setNotice((e as Error).message);
                }
              }}
            >
              <LogOut size={20} />
            </button>
          )}
        </header>
        <InstallPrompt />
        <main id="k-main" className="k-main">
          {content}
        </main>
        {session && (
          <nav className="k-bottom-nav" aria-label="ניווט ראשי">
            {[
              ["recipes", BookOpen, "מתכונים"],
              ["meals", CalendarDays, "תכנון ארוחה"],
              ["imports", Plus, "הוספה"],
              ["shopping", ShoppingBasket, "קניות"],
              ["more", Menu, "עוד"],
            ].map(([path, Icon, label]: any) => (
              <button
                key={path}
                className={tab === path ? "active" : ""}
                onClick={() => go("/" + path)}
                aria-current={tab === path ? "page" : undefined}
              >
                <Icon size={22} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        )}
        {notice && <Notice text={notice} close={() => setNotice("")} />}
      </div>
    </NoticeContext>
  );
}
function Login({
  connected,
  serverError,
}: {
  connected: (s: any) => void;
  serverError: string;
}) {
  const { run, busy } = useAction();
  const [error, setError] = useState("");
  const [recover, setRecover] = useState(false);
  return (
    <section className="k-login">
      <ChefHat size={54} strokeWidth={1} />
      <span className="k-eyebrow">כל הטעמים של הבית</span>
      <h1>
        ברוכים הבאים
        <br />
        למטבח שלך.
      </h1>
      <p>המתכונים, הסיפורים וכל מה שטוב לבשל — במקום אישי ומוגן.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(async () => {
            try {
              const s = await api("/login", "POST", {
                email: f.get("email"),
                password: f.get("password"),
              });
              connected(s);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          });
        }}
      >
        <label>
          אימייל
          <input
            type="email"
            name="email"
            dir="ltr"
            autoComplete="username"
            required
          />
        </label>
        <label>
          סיסמה
          <input
            type="password"
            name="password"
            dir="ltr"
            autoComplete="current-password"
            required
          />
        </label>
        {(error || serverError) && (
          <p className="k-alert" role="alert">
            {error || serverError}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "מתחברים…" : "כניסה למטבח שלי"}
        </button>
      </form>
      <button className="button outline" onClick={() => setRecover(true)}>
        שכחתי סיסמה
      </button>
      {recover && (
        <AccountRecovery
          close={() => setRecover(false)}
          connected={connected}
        />
      )}
      <p className="k-note">
        חשבון בעלים יחיד, זמין מהמכשירים שלך. בהפעלה הראשונה יוצרים את החשבון עם
        הוראות ההתקנה המצורפות.
      </p>
    </section>
  );
}

function Notice({ text, close }: { text: string; close: () => void }) {
  const [target, setTarget] = useState<Element>(document.body);
  useLayoutEffect(() => {
    const next = document.querySelector("dialog[open]") ?? document.body;
    setTarget((current) => (current === next ? current : next));
  });
  return createPortal(
    <div className="k-toast" role="status">
      <p>{text}</p>
      <button className="k-icon" aria-label="סגירת הודעה" onClick={close}>
        <X size={18} />
      </button>
    </div>,
    target,
  );
}
