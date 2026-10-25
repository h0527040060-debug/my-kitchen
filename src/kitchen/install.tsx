import { useEffect, useState } from "react";
import { Dialog } from "./ui.tsx";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export const isAndroid = () => /Android/i.test(navigator.userAgent);
const installed = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as any).standalone === true;
const laterKey = "kitchen-install-later-until";
function dismissed() {
  try {
    return Number(localStorage.getItem(laterKey) || 0) > Date.now();
  } catch {
    return false;
  }
}
export function InstallPrompt() {
  const [offer, setOffer] = useState<InstallEvent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!isAndroid()) return;
    const ready = (e: Event) => {
      if (installed()) return;
      e.preventDefault();
      if (!dismissed()) setOffer(e as InstallEvent);
    };
    const done = () => setOffer(null),
      mode = window.matchMedia("(display-mode: standalone)");
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    mode.addEventListener("change", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", done);
      mode.removeEventListener("change", done);
    };
  }, []);
  if (!offer || installed()) return null;
  return (
    <aside className="k-install-offer" aria-label="התקנת האפליקציה באנדרואיד">
      <img src="/icon-192.png" width="44" height="44" alt="" />
      <div>
        <strong>המטבח שלי במסך הבית</strong>
        <p>גישה מהירה למתכונים, בלי לפתוח כרטיסייה.</p>
        {error && <p role="alert">{error}</p>}
      </div>
      <button
        className="button primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await offer.prompt();
            const choice = await offer.userChoice;
            if (choice.outcome === "dismissed") {
              try {
                localStorage.setItem(
                  laterKey,
                  String(Date.now() + 7 * 86400000),
                );
              } catch {}
            }
            setOffer(null);
          } catch {
            setError("בתפריט הדפדפן ⋮ בחר הוספה למסך הבית ואז התקנה.");
          } finally {
            setBusy(false);
          }
        }}
      >
        התקנה
      </button>
      <button
        className="k-text"
        disabled={busy}
        onClick={() => {
          try {
            localStorage.setItem(laterKey, String(Date.now() + 7 * 86400000));
          } catch {}
          setOffer(null);
        }}
      >
        אחר כך
      </button>
    </aside>
  );
}
export function InstallHelp({ close }: { close: () => void }) {
  return (
    <Dialog title="התקנה באנדרואיד" close={close}>
      <p>אם הצעת ההתקנה האוטומטית אינה מופיעה:</p>
      <ol>
        <li>פתח את כתובת המטבח שלך ב־Chrome באנדרואיד.</li>
        <li>לחץ על תפריט שלוש הנקודות ⋮ של הדפדפן.</li>
        <li>בחר „התקנת אפליקציה” או „הוספה למסך הבית”, ואשר התקנה.</li>
      </ol>
      <p>
        אחרי ההתקנה פותחים את סמל המטבח ממסך הבית ומתחברים באותו חשבון. נדרש
        חיבור לאינטרנט.
      </p>
    </Dialog>
  );
}
