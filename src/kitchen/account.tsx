import { useState } from "react";
import { api } from "./api.ts";
import { Dialog, useResource, useAction, LoadState } from "./ui.tsx";

export function AccountSettings({ close }: { close: () => void }) {
  const { data, loading, error, reload } = useResource<any>("/account");
  const { run, busy, notify } = useAction();
  const [codes, setCodes] = useState<string[]>([]);
  return (
    <Dialog title="ניהול החשבון האישי" close={close}>
      <p>
        חשבון בעלים אחד, לאותו מאגר בכל המכשירים שלך. מתחברים בכל מכשיר באותו
        אימייל ובאותה סיסמה.
      </p>
      <LoadState loading={loading} error={error} retry={reload} />
      {data && (
        <>
          <form
            key={data.email}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void run(async () => {
                const next = String(f.get("new_password") || "");
                if (next !== f.get("confirm_password"))
                  throw Error("הסיסמאות החדשות אינן תואמות");
                await api("/account", "PUT", {
                  email: f.get("email"),
                  current_password: f.get("current_password"),
                  ...(next ? { new_password: next } : {}),
                });
                form.reset();
                reload();
                notify(
                  "פרטי החשבון עודכנו. המכשיר הזה נשאר מחובר ושאר ההתחברויות בוטלו.",
                );
              });
            }}
          >
            <label>
              אימייל להתחברות
              <input
                name="email"
                type="email"
                autoComplete="username"
                defaultValue={data.email}
                required
              />
            </label>
            <label>
              סיסמה נוכחית
              <input
                name="current_password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            <label>
              סיסמה חדשה — רק אם רוצים לשנות
              <input
                name="new_password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
              />
            </label>
            <label>
              אימות סיסמה חדשה
              <input
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                maxLength={256}
              />
            </label>
            <p className="k-note">
              סיסמה חדשה: לפחות 12 תווים. שינוי פרטים מבטל התחברויות אחרות;
              המתכונים נשמרים.
            </p>
            <button className="button primary" disabled={busy}>
              שמירת פרטי החשבון
            </button>
          </form>
          <hr />
          <h3>שחזור אם הסיסמה נשכחת</h3>
          <p>
            נותרו {data.recovery_codes_remaining} קודי שחזור. כל קוד מאפשר איפוס
            אחד. שמור אותם במקום פרטי, למשל במנהל הסיסמאות; לא שולחים אותם
            בצ׳אט.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void run(async () => {
                const result = await api("/account/recovery-codes", "POST", {
                  current_password: f.get("current_password"),
                });
                setCodes(result.codes);
                form.reset();
                reload();
              });
            }}
          >
            <label>
              סיסמה נוכחית ליצירת קודי שחזור
              <input
                type="password"
                name="current_password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            <p className="k-note">
              יצירת קודים חדשים מבטלת את הקודמים. הם מוצגים רק עכשיו.
            </p>
            <button className="button outline" disabled={busy}>
              יצירת קודי שחזור חדשים
            </button>
          </form>
          {codes.length > 0 && (
            <div className="k-note">
              <button
                className="button primary"
                onClick={() => {
                  const blob = new Blob(
                    ["המטבח שלי — קודי שחזור פרטיים\n" + codes.join("\n")],
                    { type: "text/plain;charset=utf-8" },
                  );
                  const link = document.createElement("a"),
                    url = URL.createObjectURL(blob);
                  link.href = url;
                  link.download = "my-kitchen-private-recovery-codes.txt";
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                הורדת הקודים לקובץ פרטי
              </button>
              {codes.map((code) => (
                <p key={code} dir="ltr" style={{ overflowWrap: "anywhere" }}>
                  {code}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

export function AccountRecovery({
  close,
  connected,
}: {
  close: () => void;
  connected: (session: any) => void;
}) {
  const { run, busy } = useAction();
  return (
    <Dialog title="איפוס סיסמה עם קוד שחזור" close={close}>
      <p>
        משתמשים בקוד פרטי שנשמר קודם בניהול החשבון. הקוד חד־פעמי; כל ההתחברויות
        הקודמות יבוטלו.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(async () => {
            const password = String(f.get("password"));
            if (password !== f.get("confirm"))
              throw Error("הסיסמאות אינן תואמות");
            const result = await api("/account/recover", "POST", {
              email: f.get("email"),
              code: String(f.get("code")).replace(/\s+/g, "").toLowerCase(),
              password,
            });
            connected(result);
          });
        }}
      >
        <label>
          אימייל לחשבון
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          קוד שחזור
          <input name="code" type="password" autoComplete="off" required />
        </label>
        <label>
          סיסמה חדשה
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            required
          />
        </label>
        <label>
          אימות הסיסמה
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
          />
        </label>
        <button className="button primary" disabled={busy}>
          איפוס סיסמה וכניסה
        </button>
      </form>
      <p className="k-note">
        אם אין קוד שחזור, אפשר לבקש סיוע בשיחה הקבועה של הפרויקט באמצעות חיבור
        הניהול המורשה. אין שליחת איפוס במייל אוטומטית.
      </p>
    </Dialog>
  );
}
