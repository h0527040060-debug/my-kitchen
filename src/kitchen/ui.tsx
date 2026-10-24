import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X, ArrowRight, Image as ImageIcon } from "lucide-react";
import { api, mediaUrl } from "./api.ts";
export const NoticeContext = createContext<(text: string) => void>(() => {});
export function useAction() {
  const notify = useContext(NoticeContext);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  async function run(fn: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const error = e as any;
      notify(
        error.message +
          (Array.isArray(error.details) ? "\n" + error.details.join("\n") : ""),
      );
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return { run, busy, notify };
}
export function useResource<T = any>(path: string | null, poll = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let active = true,
      inFlight = false;
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await api<T>(path!);
        if (active) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = poll ? window.setInterval(load, poll) : undefined;
    return () => {
      active = false;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, revision, poll]);
  return {
    data,
    error,
    loading,
    reload: () => setRevision((r) => r + 1),
    setData,
  };
}
export function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  return loading ? (
    <div className="k-empty" role="status">
      פותחים את המטבח…
    </div>
  ) : error ? (
    <div className="k-alert" role="alert">
      {error}
      <button className="button outline" onClick={retry}>
        ניסיון נוסף
      </button>
    </div>
  ) : null;
}
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current!.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      className="k-dialog"
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="k-dialog-head">
        <h2>{title}</h2>
        <button className="k-icon" aria-label="סגירה" onClick={close}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function PageTitle({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="k-page-title">
      <div>
        {back && (
          <button className="k-back" onClick={back}>
            <ArrowRight size={17} /> חזרה
          </button>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="k-page-actions">{children}</div>
    </div>
  );
}
export function MediaImage({
  id,
  alt = "",
  variant = "thumbnail",
}: {
  id?: string | null;
  alt?: string;
  variant?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!failed || attempt >= 12) return;
    const timer = setTimeout(() => {
      setAttempt((a) => a + 1);
      setFailed(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [failed, attempt]);
  useEffect(() => setFailed(false), [id, variant]);
  return id && !failed ? (
    <img
      src={mediaUrl(id, variant) + "&attempt=" + attempt}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="k-media-pending">
      <ImageIcon strokeWidth={1} />
      <span>תמונה ממתינה</span>
    </div>
  );
}
export function Confirm({
  text,
  onConfirm,
  close,
}: {
  text: string;
  onConfirm: () => Promise<void>;
  close: () => void;
}) {
  const { run, busy } = useAction();
  return (
    <Dialog title="אישור פעולה" close={close}>
      <p>{text}</p>
      <div className="k-actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await onConfirm();
              close();
            })
          }
        >
          אישור
        </button>
        <button className="button quiet" disabled={busy} onClick={close}>
          ביטול
        </button>
      </div>
    </Dialog>
  );
}
export function JobResult({
  jobId,
  onImage,
  onDone,
}: {
  jobId: string;
  onImage?: (id: string) => void;
  onDone?: (job: any) => void;
}) {
  const {
    data: j,
    error,
    loading,
    reload,
  } = useResource<any>("/jobs/" + jobId, 2500);
  const delivered = useRef<string | null>(null);
  useEffect(() => {
    if (j?.status === "succeeded" && delivered.current !== j.id) {
      delivered.current = j.id;
      onDone?.(j);
    }
  }, [j?.status, j?.id, onDone]);
  const { run, busy } = useAction();
  return (
    <div className="k-ai-result" role="status">
      <LoadState loading={loading} error={error} retry={reload} />
      {j && (
        <>
          <strong>
            {(
              {
                queued: "ממתין לעיבוד",
                running: "בעיבוד",
                succeeded: "העיבוד הסתיים",
                blocked: "הפעולה ממתינה לחיבור או למכסה",
                uncertain: "תוצאת החיוב אינה ודאית",
                failed: "הפעולה נכשלה",
              } as any
            )[j.status] || j.status}
          </strong>
          {j.error && <p>{j.error}</p>}
          {j.status === "succeeded" && (
            <>
              {j.result?.media_id ? (
                <>
                  <MediaImage id={j.result.media_id} variant="display" />
                  {onImage && (
                    <button
                      className="button primary"
                      onClick={() => onImage(j.result.media_id)}
                    >
                      בחירת התמונה לשמירה
                    </button>
                  )}
                </>
              ) : (
                <StructuredResult value={j.result} />
              )}
            </>
          )}
          {["blocked", "failed", "uncertain"].includes(j.status) && (
            <button
              className="button outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (
                    j.status === "uncertain" &&
                    !window.confirm(
                      "ייתכן שהספק כבר חייב על הפעולה. לשלוח שוב בידיעה שייתכן חיוב נוסף?",
                    )
                  )
                    return;
                  await api(`/jobs/${j.id}/retry`, "POST", {
                    acknowledge_possible_charge: j.status === "uncertain",
                  });
                  reload();
                })
              }
            >
              ניסיון חוזר
            </button>
          )}
        </>
      )}
    </div>
  );
}
function StructuredResult({ value }: { value: any }) {
  if (!value) return null;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <StructuredResult value={v} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <div>
        {Object.entries(value)
          .filter(([k]) => !k.endsWith("_id") && !k.endsWith("_ids"))
          .map(([k, v]) => (
            <section key={k}>
              <small>
                {(
                  {
                    recipe_facts: "מה כתוב במתכון",
                    general_advice: "עצה כללית",
                    question: "שאלה להמשך",
                    suggested_change: "שינוי מוצע — לא הוחל",
                    cautions: "לתשומת לב",
                    explanation: "פירוש החיפוש",
                    model: "מודל",
                    accessible: "גישה לרשימת המודלים",
                    operation_tested: "בדיקת פעולה בפועל",
                  } as any
                )[k] || k}
              </small>
              <StructuredResult value={v} />
            </section>
          ))}
      </div>
    );
  return (
    <p>{typeof value === "boolean" ? (value ? "כן" : "לא") : String(value)}</p>
  );
}
