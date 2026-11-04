import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  CreditCard,
  Download,
  Fingerprint,
  Flame,
  Gem,
  LayoutDashboard,
  Layers3,
  LoaderCircle,
  LogOut,
  Menu,
  Monitor,
  Play,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";
import MemberFlows, { SecurityPanel } from "./MemberFlows.jsx";
import "./member-flows.css";
import ReleaseDownload from "./ReleaseDownload.jsx";
import VersionLog from "./VersionLog.jsx";

const Auth = createContext(null);
async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Unable to complete this request.");
  return data;
}
const format = (n) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
const date = (value) =>
  new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Dryad home">
      <span className="brand-icon">
        <Layers3 size={22} />
      </span>
      dryad
      <span className="brand-dot">•</span>
    </Link>
  );
}
function DiscordLink() {
  return (
    <a
      className="discord-link"
      href="https://discord.gg/aVRx88smYU"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Join the Dryad Discord (opens in a new tab)"
      title="Join our Discord"
    >
      <img src="/icons/discord.svg" alt="" width="20" height="20" />
    </a>
  );
}
function Button({ children, className = "", to, ...props }) {
  return to ? (
    <Link to={to} className={"button " + className} {...props}>
      {children}
    </Link>
  ) : (
    <button className={"button " + className} {...props}>
      {children}
    </button>
  );
}
function App() {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false),
    [config, setConfig] = useState(null),
    [bootError, setBootError] = useState(""),
    [menu, setMenu] = useState(false);
  const location = useLocation();
  const boot = () => {
    setBootError("");
    Promise.all([api("/auth/me"), api("/config")])
      .then(([a, c]) => {
        setUser(a.user);
        setConfig(c);
        setReady(true);
      })
      .catch(() =>
        setBootError(
          "Dryad is temporarily unavailable. Please try again shortly.",
        ),
      );
  };
  useEffect(boot, []);
  useEffect(() => {
    if (!ready) return;
    const refresh = () =>
      api("/auth/me")
        .then((a) => setUser(a.user))
        .catch(() => {});
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [location.pathname, ready]);
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  };
  if (bootError)
    return (
      <div className="boot-error">
        <ShieldCheck />
        <h1>Let’s get connected.</h1>
        <p>{bootError}</p>
        <Button onClick={boot}>Try again</Button>
      </div>
    );
  if (!ready)
    return (
      <div className="loading">
        <LoaderCircle className="spin" /> Loading Dryad
      </div>
    );
  const account = location.pathname === "/account";
  return (
    <Auth.Provider value={{ user, setUser, config, logout }}>
      <div className={account ? "site account-site" : "site"}>
        <header className="header">
          <div className="nav-shell">
            <Brand />
            <nav
              className={menu ? "nav open" : "nav"}
              aria-label="Main navigation"
            >
              <NavLink
                to="/features"
                className={({ isActive }) =>
                  isActive || location.pathname === "/" ? "active" : ""
                }
              >
                Features
              </NavLink>
              <NavLink to="/purchase">Membership</NavLink>
              <NavLink to="/versions">Version log</NavLink>
              <NavLink to="/account">Dashboard</NavLink>
            </nav>
            <div className="nav-actions">
              <DiscordLink />
              {user ? (
                <Link className="signin" to="/account">
                  <span className="avatar tiny">{user.name[0]}</span>
                  {user.name.split(" ")[0]}
                </Link>
              ) : (
                <Link className="signin" to="/login">
                  Log in <ArrowUpRight size={14} />
                </Link>
              )}
              <Button
                to={user?.membershipActive ? "/account" : "/purchase"}
                className="small"
              >
                {user?.membershipActive ? "Dashboard" : "Get Dryad"}{" "}
                <ArrowRight size={15} />
              </Button>
              <button
                aria-label="Toggle navigation"
                className="mobile-menu icon-button"
                onClick={() => setMenu(!menu)}
              >
                {menu ? <X /> : <Menu />}
              </button>
            </div>
          </div>
        </header>
        <main>
          {location.pathname === "/" || location.pathname === "/features" ? (
            <Features />
          ) : ["/connect", "/recover", "/privacy", "/terms"].includes(
              location.pathname,
            ) ? (
            <MemberFlows
              kind={location.pathname.slice(1)}
              user={user}
              api={api}
              Button={Button}
            />
          ) : location.pathname === "/versions" ? (
            <VersionLog />
          ) : location.pathname === "/login" ? (
            <Login />
          ) : location.pathname === "/purchase" ? (
            <Purchase />
          ) : location.pathname === "/account" ? (
            user ? (
              <Account />
            ) : (
              <Navigate to="/login?next=account" replace />
            )
          ) : (
            <div className="empty">
              <h1>Page not found.</h1>
              <Button to="/">Back to home</Button>
            </div>
          )}
        </main>
        {!account && <Footer />}
      </div>
    </Auth.Provider>
  );
}
function Footer() {
  return (
    <footer>
      <div className="footer-top">
        <Brand />
        <p>
          Overlay tools and session tracking
          <br />
          for Clash of Clans on Windows.
        </p>
        <div>
          <Link to="/features">Features</Link>
          <Link to="/versions">Version log</Link>
          <Link to="/purchase">Membership</Link>
          <Link to="/account">Your account</Link>
          <Link to="/terms">Membership policy</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Dryad</span>
        <span>
          Independent project. Not affiliated with or endorsed by Supercell.
        </span>
        <span className="local-label">
          <i /> Windows x64
        </span>
        <DiscordLink />
      </div>
    </footer>
  );
}
function MiniChart({ bars = false }) {
  return bars ? (
    <div className="bar-chart">
      {[28, 43, 35, 59, 48, 77, 66, 90, 74, 96, 85, 100].map((v, i) => (
        <i key={i} style={{ height: v + "%" }} />
      ))}
    </div>
  ) : (
    <svg
      className="line-chart"
      viewBox="0 0 600 130"
      preserveAspectRatio="none"
      aria-label="Illustrative activity trend"
    >
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#986aff" stopOpacity=".24" />
          <stop offset="100%" stopColor="#986aff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 110 L35 105 L65 113 L100 83 L130 89 L165 65 L195 74 L235 45 L270 57 L300 39 L345 53 L370 25 L405 39 L440 17 L480 30 L515 13 L550 20 L600 4 V130 H0Z"
        fill="url(#chartFill)"
      />
      <path
        d="M0 110 L35 105 L65 113 L100 83 L130 89 L165 65 L195 74 L235 45 L270 57 L300 39 L345 53 L370 25 L405 39 L440 17 L480 30 L515 13 L550 20 L600 4"
        fill="none"
        stroke="#a57aff"
        strokeWidth="2.5"
      />
    </svg>
  );
}
function OverlayPreview() {
  return (
    <div className="preview-scene" aria-label="Illustrative overlay dashboard">
      <div className="floating-label label-one">
        <span className="status-dot" /> Everything, in your control
      </div>
      <div className="overlay-window">
        <div className="window-bar">
          <div className="window-dots">
            <i />
            <i />
            <i />
          </div>
          <span>DRYAD</span>
          <span className="window-version">PREVIEW</span>
        </div>
        <div className="overlay-inner">
          <aside>
            <div className="mini-logo">
              <Layers3 size={23} />
            </div>
            {[LayoutDashboard, Swords, Target, Activity, Cpu].map((Icon, i) => (
              <div
                className={i === 0 ? "mini-nav selected" : "mini-nav"}
                key={i}
              >
                <Icon size={18} />
              </div>
            ))}
          </aside>
          <div className="overlay-content">
            <div className="mini-heading">
              <div>
                <span className="eyebrow">YOUR SESSION, AT A GLANCE</span>
                <h3>Make every run count.</h3>
              </div>
              <span className="live">
                <i /> Running
              </span>
            </div>
            <div className="mini-stats">
              <div>
                <span>
                  <Gem size={13} /> Gold collected
                </span>
                <strong>
                  12.8<span>M</span>
                </strong>
                <small>Illustrative session</small>
              </div>
              <div>
                <span>
                  <Clock3 size={13} /> Session time
                </span>
                <strong>
                  02<span>h</span> 34<span>m</span>
                </strong>
                <small>Farming loop</small>
              </div>
              <div>
                <span>
                  <Swords size={13} /> Attacks completed
                </span>
                <strong>48</strong>
                <small>Activity preview</small>
              </div>
            </div>
            <div className="mini-chart-panel">
              <div>
                <span>Resource collection</span>
                <span className="chart-legend">
                  <i /> Gold <i /> Elixir
                </span>
              </div>
              <div className="mini-grid">
                <MiniChart />
              </div>
              <div className="chart-times">
                <span>00:00</span>
                <span>00:30</span>
                <span>01:00</span>
                <span>01:30</span>
                <span>02:00</span>
                <span>02:30</span>
              </div>
            </div>
            <div className="mini-bottom">
              <span>
                <span className="script-icon">
                  <Flame size={16} />
                </span>
                <b>Farming loop</b>
                <small>Your preset. Your pace.</small>
              </span>
              <span className="mini-toggle" />
            </div>
          </div>
        </div>
      </div>
      <div className="floating-label label-two">
        <span className="purple-icon">
          <Zap size={16} />
        </span>
        <span>
          <b>Overlay controls</b>
        </span>
      </div>
      <div className="scene-caption">INTERFACE PREVIEW · SAMPLE DATA</div>
    </div>
  );
}
const features = [
  {
    index: "01",
    tag: "BUILT AROUND YOUR ROUTINE",
    title: "Farming and\ndeployment presets.",
    description:
      "Set up your farming loop, choose your deployment preset, and keep session progress right where you need it.",
    video: "farming",
    icon: Swords,
    detail: "Farming & deployment",
  },
  {
    index: "02",
    tag: "THE DETAILS, HANDLED",
    title: "Wall upgrades and\nhero management.",
    description:
      "Keep wall upgrades and hero actions in the same workflow, with the controls and stop conditions in your hands.",
    video: "upgrades",
    icon: Target,
    detail: "Wall & hero management",
  },
  {
    index: "03",
    tag: "A CLEARER PICTURE",
    title: "Session activity\nand statistics.",
    description:
      "See elapsed time, resource changes, and script progress in the overlay. Your account dashboard is ready for usage reporting.",
    video: "insights",
    icon: Activity,
    detail: "Session insights",
  },
];
function FeatureVideo({ item }) {
  const [playing, setPlaying] = useState(
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    video = useRef(null);
  useEffect(() => {
    if (playing) video.current?.play().catch(() => setPlaying(false));
    else video.current?.pause();
  }, [playing]);
  return (
    <div className={"feature-video video-" + item.video}>
      <video
        ref={video}
        src={"/videos/" + item.video + "-v1-1-0.mp4"}
        poster={"/videos/" + item.video + "-v1-1-0.webp"}
        autoPlay={playing}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={item.detail + " recorded gameplay"}
      />
      <div className="video-caption">
        <span>
          <item.icon size={15} /> {item.detail}
        </span>
        <button
          onClick={() => setPlaying(!playing)}
          aria-label={(playing ? "Pause " : "Play ") + item.detail}
        >
          {playing ? (
            <span className="pause-symbol">Ⅱ</span>
          ) : (
            <Play size={14} />
          )}
        </button>
      </div>
    </div>
  );
}
function Features() {
  const { user } = useContext(Auth);
  const member = user?.membershipActive;
  return (
    <>
      <section className="hero">
        <div className="smoke smoke-one" />
        <div className="smoke smoke-two" />
        <div className="hero-content">
          <Link
            to={member ? "/account?tab=downloads" : "/purchase"}
            className="announcement"
          >
            <span>DRYAD FOR WINDOWS</span> Overlay and automation tools{" "}
            <ChevronRight size={13} />
          </Link>
          <h1>
            Clash of Clans
            <br />
            <span className="gradient-text">overlay tools.</span>
          </h1>
          <p>
            Configure farming, upgrades and deployment from one overlay.
            <br />
            Track session activity and manage your device from your account.
          </p>
          <div className="hero-buttons">
            <Button to={member ? "/account?tab=downloads" : "/purchase"}>
              {member ? "Download Dryad" : "View membership"}{" "}
              <ArrowRight size={17} />
            </Button>
            <a href="#features" className="button secondary">
              <Play size={14} fill="currentColor" /> See it in action
            </a>
          </div>
          <div className="hero-details">
            <span>
              <Monitor size={14} /> Built for Windows
            </span>
            <i />
            <span>
              <ShieldCheck size={14} /> Your settings. Your control.
            </span>
          </div>
        </div>
        <OverlayPreview />
        <div className="hero-foot">
          <span>MORE CONTROL. LESS REPETITION.</span>
          <a href="#features" aria-label="Explore features">
            <ArrowDown size={18} />
          </a>
          <span>MADE FOR YOUR EVERYDAY SESSIONS</span>
        </div>
      </section>
      <section className="feature-intro" id="features">
        <div>
          <span className="eyebrow">
            <span className="dash" /> THE OVERLAY, REIMAGINED
          </span>
          <h2>
            Configure your scripts.
            <br />
            Track each session.
          </h2>
        </div>
        <p>
          Farming, wall upgrades and hero management,
          <br />
          with presets, stop conditions and usage reporting.
        </p>
      </section>
      <section className="feature-list">
        {features.map((item) => (
          <article className="feature-row" key={item.index}>
            <div className="feature-copy">
              <span className="feature-index">/{item.index}</span>
              <span className="eyebrow">{item.tag}</span>
              <h3>
                {item.title.split("\n").map((line, i) => (
                  <React.Fragment key={i}>
                    {line}
                    {i === 0 && <br />}
                  </React.Fragment>
                ))}
              </h3>
              <p>{item.description}</p>
              <Link to={member ? "/account?tab=downloads" : "/purchase"}>
                {member ? "Open downloads" : "View membership"}{" "}
                <ArrowUpRight size={16} />
              </Link>
            </div>
            <FeatureVideo item={item} />
          </article>
        ))}
      </section>
      <section className="benefits">
        <div>
          <Layers3 />
          <h3>A space for everything</h3>
          <p>
            Scripts, presets, and session stats.
            <br />
            Together in one familiar interface.
          </p>
        </div>
        <div>
          <Fingerprint />
          <h3>Yours, across sessions</h3>
          <p>
            A membership and device overview
            <br />
            that keep your access in reach.
          </p>
        </div>
        <div>
          <Zap />
          <h3>Configure your overlay</h3>
          <p>
            Keep the controls close.
            <br />
            Spend less time in the settings.
          </p>
        </div>
      </section>
      <section className="cta-section">
        <div className="cta-glow" />
        <span className="eyebrow">YOUR NEXT SESSION STARTS HERE</span>
        <h2>
          Download Dryad
          <br />
          for <span className="gradient-text">Windows.</span>
        </h2>
        <Button to={member ? "/account?tab=downloads" : "/purchase"}>
          {member ? "Download Dryad" : "Get Dryad"} <ArrowRight size={17} />
        </Button>
        <p>One membership. One registered Windows device.</p>
      </section>
    </>
  );
}

function Login() {
  const { setUser, config } = useContext(Auth),
    [params] = useSearchParams(),
    navigate = useNavigate();
  const [register, setRegister] = useState(params.get("mode") === "register"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const redirect =
    params.get("next") === "connect" &&
    /^[A-Fa-f0-9]{8}$/.test(params.get("code") || "")
      ? "/connect?code=" + params.get("code")
      : params.get("next") === "purchase"
        ? "/purchase"
        : "/account";
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const data = await api(register ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: fields,
      });
      setUser(data.user);
      navigate(redirect);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const demo = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/auth/demo", { method: "POST" });
      setUser(data.user);
      navigate("/account");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="login-page">
      <div className="login-story">
        <span className="eyebrow">YOUR ROUTINE. UPGRADED.</span>
        <h1>
          A little less
          <br />
          ordinary.
          <br />
          <span className="gradient-text">A lot more you.</span>
        </h1>
        <p>
          Your sessions, your settings, your progress.
          <br />
          All waiting right where you left them.
        </p>
        <div className="login-art">
          <Layers3 size={120} strokeWidth={0.8} />
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="orbit-dot" />
        </div>
        <span className="login-note">
          <ShieldCheck size={16} /> One account. Your entire overlay experience.
        </span>
      </div>
      <div className="auth-card">
        <span className="card-symbol">
          <UserRound size={24} />
        </span>
        <h2>{register ? "Make yourself at home." : "Welcome back."}</h2>
        <p>
          {register
            ? "Create your Dryad account."
            : "Sign in and pick up where you left off."}
        </p>
        <div className="auth-switch">
          <button
            className={!register ? "selected" : ""}
            onClick={() => {
              setRegister(false);
              setError("");
            }}
          >
            Log in
          </button>
          <button
            className={register ? "selected" : ""}
            onClick={() => {
              setRegister(true);
              setError("");
            }}
          >
            Create account
          </button>
        </div>
        <form onSubmit={submit}>
          {register && (
            <label>
              Display name
              <input
                name="name"
                placeholder="Alex Morgan"
                autoComplete="name"
                required
                minLength={2}
                maxLength={60}
              />
            </label>
          )}
          <label>
            Email address
            <input
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              placeholder={
                register ? "At least 12 characters" : "Your password"
              }
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={register ? 12 : 1}
              maxLength={128}
            />
          </label>
          {error && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}
          <Button className="full" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <>
                {register ? "Create account" : "Log in"}
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        </form>
        {config.demoMode && (
          <>
            <div className="divider">
              <span>TAKE A LOOK AROUND</span>
            </div>
            <Button className="secondary full" onClick={demo} disabled={busy}>
              <LayoutDashboard size={16} /> Explore the demo account
            </Button>
            <p className="form-note">
              A local preview with sample usage. No payment needed.
            </p>
          </>
        )}
        <p className="form-note bottom-note">
          <Link to="/recover">Forgot your password?</Link>
          <br />
          Your password is securely hashed.
        </p>
      </div>
    </section>
  );
}
function Purchase() {
  const { user, config } = useContext(Auth),
    [plan, setPlan] = useState("monthly"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [params] = useSearchParams();
  const navigate = useNavigate();
  const checkout = async () => {
    if (user?.membershipActive) return navigate("/account?tab=billing");
    if (!user || user.demo)
      return navigate("/login?next=purchase&mode=register");
    setBusy(true);
    setError("");
    try {
      const data = await api("/billing/checkout", {
        method: "POST",
        body: { plan },
      });
      window.location.assign(data.url);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="purchase-page">
      <div className="page-intro">
        <span className="eyebrow">
          <span className="dash" /> DRYAD SUBSCRIPTIONS
        </span>
        <h1>
          Dryad <span className="gradient-text">membership.</span>
        </h1>
        <p>
          Full overlay access for one Windows device.
          <br />
          Choose monthly or yearly billing and cancel renewals anytime.
        </p>
      </div>
      {params.get("checkout") === "canceled" && (
        <p className="message notice" role="status">
          Checkout was canceled. No new membership has been activated.
        </p>
      )}
      <div className="purchase-layout">
        <div className="membership-card">
          <div className="membership-top">
            <span className="card-symbol">
              <Layers3 size={28} />
            </span>
            <span className="pill">THE COMPLETE EXPERIENCE</span>
          </div>
          <h2>
            Dryad<span>+</span>
          </h2>
          <p>Everything you need to make each session yours.</p>
          <div className="plan-switch">
            <button
              className={plan === "monthly" ? "selected" : ""}
              onClick={() => setPlan("monthly")}
            >
              Monthly
            </button>
            <button
              className={plan === "yearly" ? "selected" : ""}
              onClick={() => setPlan("yearly")}
            >
              Yearly <span>Save 33%</span>
            </button>
          </div>
          <div className="price">
            <strong>${plan === "monthly" ? "5.99" : "4.01"}</strong>
            <span>/ month</span>
          </div>
          <p className="billing-note">
            {plan === "monthly"
              ? "$5.99 billed monthly. Cancel future renewals anytime."
              : "$48.16 billed yearly. Cancel future renewals anytime."}
          </p>
          <div className="plan-features">
            {[
              "Full overlay access",
              "Farming, wall, and hero workflows",
              "Custom deployment presets",
              "Session insights & account dashboard",
              "One registered device per membership",
            ].map((t) => (
              <span key={t}>
                <Check size={16} />
                {t}
              </span>
            ))}
          </div>
          <Button className="full" onClick={checkout} disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                {user?.membershipActive
                  ? "Manage membership"
                  : user && !user.demo
                    ? "Continue to Stripe"
                    : "Create an account to continue"}
                <ArrowUpRight size={17} />
              </>
            )}
          </Button>
          {error && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}
          <div className="checkout-security">
            <ShieldCheck size={14} /> Secure checkout with <b>stripe</b>
          </div>
          <p className="form-note">
            Dryad membership ·{" "}
            {config.billingReady
              ? config.billingMode === "live"
                ? "Renews automatically. Cancel renewals anytime in your billing portal."
                : "Stripe test mode. Use test payment details only."
              : "Purchases are currently unavailable."}
          </p>
        </div>
        <div className="purchase-aside">
          <h3>
            Set up your account.
            <br />
            Connect your device.
          </h3>
          {[
            {
              icon: UserRound,
              title: "01 / Create an account",
              text: "Create an account to keep your membership and activity together.",
            },
            {
              icon: CreditCard,
              title: "02 / Choose your membership",
              text: "Head to Stripe’s hosted checkout. Your card details stay with Stripe.",
            },
            {
              icon: Monitor,
              title: "03 / Connect your overlay",
              text: "Sign in through the Dryad launcher and approve your Windows device in the browser.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <div className="purchase-step" key={title}>
              <span>
                <Icon size={19} />
              </span>
              <div>
                <h4>{title}</h4>
                <p>{text}</p>
              </div>
            </div>
          ))}
          <div className="purchase-help">
            <CircleHelp size={19} />
            <p>
              Just exploring?
              <br />
              <Link to="/login">
                Try the demo dashboard <ArrowRight size={13} />
              </Link>
            </p>
          </div>
        </div>
      </div>
      <div className="faq">
        <h2>A few things to know.</h2>
        {[
          [
            "How does billing work?",
            "Your subscription renews at the interval you choose. Stripe hosts checkout and the billing portal, where you can manage payment methods and cancel future renewals.",
          ],
          [
            "Can I use this on another computer?",
            "One registered device is included. You may remove and replace a device once every five days. Your replacement can pair immediately.",
          ],
          [
            "Is the overlay connected to this website yet?",
            "The protected Dryad build uses launcher-issued licenses and can report script summaries. The demo account still uses labeled sample data. Purchasing does not automatically launch or install the overlay.",
          ],
          [
            "Will a checkout redirect activate my membership?",
            "Access is updated only after the backend verifies a Stripe webhook and the subscription state. A successful redirect alone never grants access.",
          ],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>
              {q}
              <span>+</span>
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
function Account() {
  const { user, setUser, logout, config } = useContext(Auth),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [range, setRange] = useState("7"),
    [params, setParams] = useSearchParams();
  const tab = [
    "overview",
    "scripts",
    "devices",
    "downloads",
    "billing",
    "settings",
  ].includes(params.get("tab"))
    ? params.get("tab")
    : "overview";
  const navigate = useNavigate();
  const refresh = () =>
    api("/account")
      .then((d) => {
        setData(d);
        setUser((current) =>
          current?.id === d.user.id &&
          current.membershipActive !== d.user.membershipActive
            ? { ...current, membershipActive: d.user.membershipActive }
            : current,
        );
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, [user.id]);
  // The redirect can arrive before the webhook; poll briefly for confirmed state.
  useEffect(() => {
    if (params.get("checkout") !== "success") return;
    const timer = setInterval(refresh, 2500);
    const stop = setTimeout(() => clearInterval(timer), 30000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [params.get("checkout")]);
  const action = async (fn) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const portal = () =>
    action(async () => {
      const d = await api("/billing/portal", { method: "POST" });
      window.location.assign(d.url);
    });
  const active =
    !data?.billingHold &&
    data?.subscription &&
    ["active", "trialing"].includes(data.subscription.status) &&
    data.subscription.period_end * 1000 > Date.now();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Number(range) + 1);
  startDate.setHours(0, 0, 0, 0);
  const rows = (data?.usage || []).filter(
    (r) => Date.parse(r.started_at) >= startDate.getTime(),
  );
  const totals = rows.reduce(
    (t, r) => ({
      seconds: t.seconds + r.seconds,
      runs: t.runs + r.runs,
      gold: t.gold + r.gold,
      elixir: t.elixir + r.elixir,
      walls: t.walls + r.walls,
    }),
    { seconds: 0, runs: 0, gold: 0, elixir: 0, walls: 0 },
  );
  const tabs = [
    { id: "overview", name: "Overview", icon: LayoutDashboard },
    { id: "scripts", name: "Script activity", icon: Activity },
    { id: "devices", name: "Devices", icon: Monitor },
    { id: "downloads", name: "Downloads", icon: Download },
    { id: "billing", name: "Membership", icon: CreditCard },
    { id: "settings", name: "Account settings", icon: UserRound },
  ];
  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Account navigation">
          {tabs.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setParams({ tab: id });
                setError("");
                setMessage("");
              }}
            >
              <Icon size={17} />
              {name}
              {tab === id && <ChevronRight size={14} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-membership">
          <span className="purple-icon">
            <Sparkles size={19} />
          </span>
          <h4>
            {user.demo
              ? "A look at what’s possible."
              : active
                ? "You’re all set."
                : "No active membership."}
          </h4>
          <p>
            {user.demo
              ? "Sample account and session data."
              : active
                ? "Manage your membership anytime."
                : "Choose a plan to access the overlay."}
          </p>
          <Link to="/purchase">
            Explore membership <ArrowUpRight size={14} />
          </Link>
        </div>
        <button
          className="signout"
          onClick={() =>
            action(async () => {
              await logout();
              navigate("/login");
            })
          }
        >
          <LogOut size={16} /> Log out
        </button>
      </aside>
      <div className="dashboard-main">
        <div className="dashboard-topline">
          <span>
            Workspace <ChevronRight size={12} />{" "}
            {tabs.find((t) => t.id === tab).name}
          </span>
          <span>
            <span className="status-dot" />
            {user.demo ? "Demo workspace" : "Account connected"}
          </span>
        </div>
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">
              {tab === "overview"
                ? "A LITTLE PROGRESS, EVERY DAY"
                : "YOUR DRYAD WORKSPACE"}
            </span>
            <h1>
              {tab === "overview"
                ? `Hey, ${user.name.split(" ")[0]}.`
                : tabs.find((t) => t.id === tab).name}
              <span className="heading-dot">
                {tab === "overview" ? "✦" : ""}
              </span>
            </h1>
            <p>
              {tab === "overview"
                ? "Here’s how your sessions are shaping up."
                : {
                    scripts:
                      "A closer look at the routines behind your progress.",
                    devices: "Keep track of where your overlay belongs.",
                    downloads: "Your protected release, ready for Windows.",
                    billing: "Your membership, on your terms.",
                    settings: "The details that make this account yours.",
                  }[tab]}
            </p>
          </div>
          {["overview", "scripts"].includes(tab) && (
            <label className="range-label">
              <Clock3 size={14} />
              <select
                aria-label="Usage time range"
                value={range}
                onChange={(e) => setRange(e.target.value)}
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
              </select>
            </label>
          )}
        </div>
        {user.demo && (
          <div className="demo-banner">
            <Sparkles size={16} />
            <span>
              You’re exploring a demo. All activity and device details are
              sample data.
            </span>
            <Link to="/login?next=account&mode=register">
              Create your account <ArrowUpRight size={13} />
            </Link>
          </div>
        )}
        {params.get("checkout") === "success" && (
          <p className="message notice" role="status">
            {active
              ? "Your membership is active. Payment was confirmed by the backend."
              : "You’ve returned from Stripe. Waiting for verified subscription confirmation; this can take a moment. Refresh if needed."}
          </p>
        )}
        {error && (
          <p className="message error" role="alert">
            {error}
            {!data && <button onClick={refresh}>Retry</button>}
          </p>
        )}
        {message && (
          <p className="message success" role="status">
            {message}
          </p>
        )}
        {!data ? (
          !error && (
            <div className="loading">
              <LoaderCircle className="spin" /> Loading your workspace
            </div>
          )
        ) : (
          <>
            {tab === "overview" && (
              <>
                <div className="account-stats">
                  {[
                    {
                      icon: Clock3,
                      label: "Session time",
                      value: (totals.seconds / 3600).toFixed(1),
                      unit: "hrs",
                      detail: "Across all scripts",
                    },
                    {
                      icon: Swords,
                      label: "Completed runs",
                      value: format(totals.runs),
                      detail: "In the selected period",
                    },
                    {
                      icon: Gem,
                      label: "Gold collected",
                      value: format(totals.gold),
                      detail: "Reported resource gains",
                    },
                    {
                      icon: Target,
                      label: "Walls upgraded",
                      value: format(totals.walls),
                      detail: "Reported upgrades",
                    },
                  ].map(({ icon: Icon, label, value, unit, detail }) => (
                    <div className="stat-card" key={label}>
                      <span>
                        <Icon size={16} />
                        {label}
                      </span>
                      <strong>
                        {value}
                        <small>{unit}</small>
                      </strong>
                      <p>{detail}</p>
                    </div>
                  ))}
                </div>
                <div className="dashboard-middle">
                  <section className="panel activity-panel">
                    <div className="panel-title">
                      <div>
                        <h3>Time well spent</h3>
                        <p>Script runtime, day by day</p>
                      </div>
                      <span className="chart-legend">
                        <i /> Runtime
                      </span>
                    </div>
                    <div className="usage-chart">
                      <div className="y-labels">
                        <span>4h</span>
                        <span>3h</span>
                        <span>2h</span>
                        <span>1h</span>
                        <span>0</span>
                      </div>
                      <div className="day-bars">
                        {Array.from({ length: Number(range) }, (_, i) => {
                          const d = new Date();
                          d.setDate(d.getDate() - Number(range) + i + 1);
                          const seconds = rows
                            .filter(
                              (r) =>
                                new Date(r.started_at).toDateString() ===
                                d.toDateString(),
                            )
                            .reduce((n, r) => n + r.seconds, 0);
                          return (
                            <div
                              key={i}
                              title={`${date(d)}: ${(seconds / 3600).toFixed(1)} hours`}
                            >
                              <div className="bar-space">
                                <i
                                  style={{
                                    height: `${Math.min(100, seconds / 144)}%`,
                                  }}
                                />
                              </div>
                              <span>
                                {Number(range) === 7
                                  ? d.toLocaleDateString("en", {
                                      weekday: "short",
                                    })
                                  : i % 5 === 0
                                    ? d.getDate()
                                    : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                  <section className="panel membership-summary">
                    <span className="card-symbol">
                      <Layers3 size={24} />
                    </span>
                    <div className="membership-title">
                      <h3>Dryad+</h3>
                      <span className={"pill " + (active ? "green" : "")}>
                        {user.demo ? "DEMO" : active ? "ACTIVE" : "NO PLAN"}
                      </span>
                    </div>
                    <p>
                      {user.demo
                        ? "A preview of your membership hub."
                        : active
                          ? `${data.subscription.plan === "yearly" ? "Yearly" : "Monthly"} membership`
                          : "Your membership is waiting for you."}
                    </p>
                    <div className="summary-row">
                      <span>Device allowance</span>
                      <b>1 device</b>
                    </div>
                    <div className="summary-row">
                      <span>{active ? "Period ends" : "Access status"}</span>
                      <b>
                        {active
                          ? date(data.subscription.period_end * 1000)
                          : user.demo
                            ? "Sample preview"
                            : "Not subscribed"}
                      </b>
                    </div>
                    <Button
                      className="secondary full"
                      onClick={() => setParams({ tab: "billing" })}
                    >
                      Manage membership <ArrowUpRight size={14} />
                    </Button>
                    <Button
                      className="full"
                      onClick={() => setParams({ tab: "downloads" })}
                    >
                      <Download size={16} /> Get the protected release
                    </Button>
                  </section>
                </div>
                <ScriptTable
                  rows={rows.slice(0, 5)}
                  onViewAll={() => setParams({ tab: "scripts" })}
                />
              </>
            )}
            {tab === "scripts" && <ScriptTable rows={rows} />}
            {tab === "downloads" && (
              <ReleaseDownload
                api={api}
                Button={Button}
                active={!!active}
                demo={user.demo}
              />
            )}
            {tab === "devices" && (
              <section className="panel settings-panel">
                <div className="panel-title">
                  <div>
                    <h3>Your registered devices</h3>
                    <p>
                      Approve pairing through your Dryad launcher. Device resets
                      are limited to once every five days.
                    </p>
                  </div>
                  <Monitor size={21} />
                </div>
                {data.deviceResetAvailableAt * 1000 > Date.now() && (
                  <p className="message notice">
                    Next device reset available{" "}
                    {date(data.deviceResetAvailableAt * 1000)}.
                  </p>
                )}
                {data.devices.length ? (
                  data.devices.map((device) => (
                    <div className="device-row" key={device.id}>
                      <span className="device-icon">
                        <Monitor />
                      </span>
                      <div>
                        <h4>{device.name}</h4>
                        <p>
                          Last seen {date(device.last_seen)}
                          {user.demo && " · Sample device"}
                        </p>
                      </div>
                      <Button
                        className="secondary small"
                        disabled={
                          busy ||
                          user.demo ||
                          data.deviceResetAvailableAt * 1000 > Date.now()
                        }
                        onClick={() =>
                          action(async () => {
                            await api("/account/devices/" + device.id, {
                              method: "DELETE",
                            });
                            await refresh();
                            setMessage("Device removed.");
                          })
                        }
                      >
                        Remove device
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <Monitor />
                    <h3>No devices connected</h3>
                    <p>
                      Sign in through the Dryad launcher to connect your device.
                    </p>
                  </div>
                )}
                <div className="info-note">
                  <Fingerprint size={19} />
                  <p>
                    Dryad uses an installation key and a hashed computer
                    identity. Raw Windows and hardware identifiers stay on your
                    computer. Removing a device revokes its launcher session;
                    any existing lease expires within ten minutes.
                  </p>
                </div>
              </section>
            )}
            {tab === "billing" && (
              <section className="panel settings-panel">
                <div className="panel-title">
                  <div>
                    <h3>Your membership</h3>
                    <p>
                      Billing and payment methods are managed securely through
                      Stripe.
                    </p>
                  </div>
                  <CreditCard size={21} />
                </div>
                <div className="billing-status">
                  <span className="card-symbol">
                    <Layers3 size={30} />
                  </span>
                  <div>
                    <h2>Dryad+</h2>
                    <p>
                      {user.demo
                        ? "Demo preview — no paid subscription"
                        : data.subscription
                          ? `${data.subscription.plan} · ${data.subscription.status.replaceAll("_", " ")}`
                          : "No membership yet"}
                    </p>
                    {active && (
                      <p>
                        {data.subscription.cancel_at_end
                          ? "Cancels on "
                          : "Current period ends "}
                        {date(data.subscription.period_end * 1000)}
                      </p>
                    )}
                  </div>
                  <span className={"pill " + (active ? "green" : "")}>
                    {active ? "ACTIVE" : user.demo ? "DEMO" : "NOT ACTIVE"}
                  </span>
                </div>
                <div className="billing-actions">
                  <Button to="/purchase">
                    {active ? "View plans" : "Explore membership"}
                    <ArrowRight size={16} />
                  </Button>
                  <Button
                    className="secondary"
                    onClick={portal}
                    disabled={busy || user.demo}
                  >
                    Open billing portal <ArrowUpRight size={16} />
                  </Button>
                </div>
                <p className="form-note">
                  {config.billingMode === "live"
                    ? "Manage payment methods, invoices and renewal cancellation securely with Stripe."
                    : config.billingReady
                      ? "Stripe test mode. No real payment is taken."
                      : "Billing is currently unavailable."}
                </p>
              </section>
            )}
            {tab === "settings" && (
              <div className="settings-grid">
                <section className="panel settings-panel">
                  <h3>Profile details</h3>
                  <p className="muted">
                    A few details to make your workspace feel like you.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = new FormData(e.currentTarget).get("name");
                      action(async () => {
                        const d = await api("/account", {
                          method: "PATCH",
                          body: { name },
                        });
                        setUser(d.user);
                        setMessage("Profile updated.");
                      });
                    }}
                  >
                    <label>
                      Display name
                      <input
                        name="name"
                        defaultValue={user.name}
                        required
                        minLength={2}
                        maxLength={60}
                        disabled={user.demo}
                      />
                    </label>
                    <label>
                      Email address
                      <input value={user.email} disabled readOnly />
                    </label>
                    <p className="form-note">
                      Member since {date(user.createdAt)}. Email changes require
                      verification in a future release.
                    </p>
                    <Button disabled={busy || user.demo}>
                      Save changes <Check size={15} />
                    </Button>
                  </form>
                </section>
                <SecurityPanel api={api} Button={Button} />
                <section className="panel settings-panel">
                  <h3>Change password</h3>
                  <p className="muted">
                    Changing your password signs out other browser sessions.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const fields = Object.fromEntries(new FormData(form));
                      action(async () => {
                        await api("/account/password", {
                          method: "POST",
                          body: fields,
                        });
                        form.reset();
                        setMessage(
                          "Password updated. Other browser sessions were signed out.",
                        );
                      });
                    }}
                  >
                    <label>
                      Current password
                      <input
                        name="currentPassword"
                        type="password"
                        autoComplete="current-password"
                        required
                        maxLength={128}
                        disabled={user.demo}
                      />
                    </label>
                    <label>
                      New password
                      <input
                        name="newPassword"
                        type="password"
                        placeholder="At least 12 characters"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                        disabled={user.demo}
                      />
                    </label>
                    <Button className="secondary" disabled={busy || user.demo}>
                      Update password <ShieldCheck size={15} />
                    </Button>
                  </form>
                </section>
              </div>
            )}
          </>
        )}
        <div className="dashboard-bottom">
          <span>
            <ShieldCheck size={13} />{" "}
            {user.demo
              ? "Sample workspace · No overlay connected"
              : "Your workspace · Authenticated usage reporting"}
          </span>
          <Link to="/features">
            View features <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}
function ScriptTable({ rows, onViewAll }) {
  return (
    <section className="panel script-table">
      <div className="panel-title">
        <div>
          <h3>Script activity</h3>
          <p>Script usage and session history</p>
        </div>
        {onViewAll && (
          <button className="text-button" onClick={onViewAll}>
            View all activity <ArrowRight size={14} />
          </button>
        )}
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Script</th>
                <th>Day</th>
                <th>Runtime</th>
                <th>Runs</th>
                <th>Resources collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="table-script-icon">
                      {r.script === "Farming loop" ? (
                        <Swords size={17} />
                      ) : r.script === "Wall upgrades" ? (
                        <Target size={17} />
                      ) : (
                        <Flame size={17} />
                      )}
                    </span>
                    <b>{r.script}</b>
                  </td>
                  <td>{date(r.started_at)}</td>
                  <td>
                    {Math.floor(r.seconds / 3600)}h{" "}
                    {Math.round((r.seconds % 3600) / 60)}m
                  </td>
                  <td>{r.runs}</td>
                  <td>
                    <span className="resource gold">
                      <i />
                      {format(r.gold)}
                    </span>
                    <span className="resource elixir">
                      <i />
                      {format(r.elixir)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <Activity />
          <h3>Your story starts here.</h3>
          <p>
            Script sessions will appear once native usage reporting is
            connected.
          </p>
        </div>
      )}
    </section>
  );
}
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
