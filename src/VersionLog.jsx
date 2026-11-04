import { Link } from "react-router-dom";
import { Download, ArrowRight } from "lucide-react";

const updates = [
  {
    title: "Dryad 1.1.0",
    date: "2026-11-03",
    label: "Windows release",
    changes: [
      "Updated the launcher and injector interface.",
      "Added signed package updates with release integrity and membership checks.",
      "Published the complete Windows x64 package in account downloads.",
    ],
  },
  {
    title: "Website update",
    date: "2026-11-04",
    label: "Website",
    changes: [
      "Added a version log and clearer descriptions of the overlay features.",
      "Member navigation now links to the dashboard and protected downloads.",
      "Added persistent limits for login attempts, downloads, billing requests and account emails.",
    ],
  },
  {
    title: "Membership and downloads",
    date: "2026-11-03",
    label: "Website",
    changes: [
      "Enabled monthly and yearly Stripe subscriptions and self-service billing management.",
      "Added protected release ZIP downloads for verified members with active access.",
      "Published setup instructions and file integrity details in Account → Downloads.",
    ],
  },
  {
    title: "Dryad 1.0.0",
    date: "2026-10-31",
    label: "Windows release",
    changes: [
      "Initial protected Windows release with launcher, overlay and injector.",
      "Added browser-approved device pairing and membership-based licenses bound to your Windows installation.",
      "Included farming, wall and hero tools, deployment presets and session reporting.",
    ],
  },
];

export default function VersionLog() {
  return (
    <section className="version-page">
      <div className="page-intro">
        <span className="eyebrow">DRYAD UPDATES</span>
        <h1>Version log</h1>
        <p>Release notes for the Windows overlay and website.</p>
      </div>
      <div className="version-list">
        {updates
          .toSorted((a, b) => b.date.localeCompare(a.date))
          .map((update) => (
            <article className="panel version-entry" key={update.title}>
              <div className="version-meta">
                <span className="pill">{update.label}</span>
                <time dateTime={update.date}>
                  {new Date(update.date + "T12:00:00").toLocaleDateString(
                    "en-US",
                    { month: "long", day: "numeric", year: "numeric" },
                  )}
                </time>
              </div>
              <h2>{update.title}</h2>
              <ul>
                {update.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </article>
          ))}
        <div className="version-links">
          <Link className="button" to="/account?tab=downloads">
            <Download size={17} /> Account downloads
          </Link>
          <Link className="text-button" to="/features">
            View features <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  );
}
