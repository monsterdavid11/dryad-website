import { useEffect, useState } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";

export default function ReleaseDownload({ api, Button, active, demo }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setData(await api("/account/release"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [active]);
  return (
    <section className="panel settings-panel release-download">
      <span className="card-symbol">
        <Download size={24} />
      </span>
      <h3>Download Dryad for Windows</h3>
      <p className="muted">
        The protected release includes the launcher, overlay and setup
        instructions.
      </p>
      {data?.release && (
        <p>
          Stable {data.release.version} ·{" "}
          {(data.release.bytes / 1048576).toFixed(1)} MB · Windows x64
        </p>
      )}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Checking release availability…</p>}
      {data &&
        (demo ? (
          <p>
            Create your own account and choose a membership to download Dryad.
          </p>
        ) : !active ? (
          <p>
            An active membership is required to download the protected release.
          </p>
        ) : !data.emailVerified ? (
          <p>
            Verify your email in Account settings, then refresh availability
            here.
          </p>
        ) : !data.release ? (
          <p>
            The protected release is currently unavailable. Check back shortly.
          </p>
        ) : !data.canDownload ? (
          <p>Downloads are temporarily unavailable. Refresh to check again.</p>
        ) : null)}
      {data?.canDownload ? (
        <a className="button" href="/api/account/release/download">
          <Download size={17} /> Download protected release
        </a>
      ) : (
        !active && <Button to="/purchase">View membership plans</Button>
      )}
      <button className="text-button" onClick={refresh} disabled={busy}>
        <RefreshCw size={14} /> {busy ? "Checking…" : "Refresh availability"}
      </button>
      <ol className="release-steps">
        <li>Download the ZIP and extract all files to a folder.</li>
        <li>
          Open Dryad.exe and sign in. Approve your Windows device in the
          browser.
        </li>
        <li>Follow the included README to start the protected overlay.</li>
      </ol>
      <p className="muted">
        <ShieldCheck size={15} /> Downloading does not register a device. The
        launcher checks your membership and binds access to your Windows
        installation.
      </p>
      {data?.release && (
        <details>
          <summary>Verify file integrity</summary>
          <p className="muted">SHA-256 of the downloaded ZIP:</p>
          <code className="release-hash">{data.release.sha256}</code>
        </details>
      )}
    </section>
  );
}
