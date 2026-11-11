import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Activity,
  Bot,
  ChevronsUpDown,
  FolderGit2,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquarePlus,
  Monitor,
  Moon,
  ScrollText,
  Send,
  Sun,
  X,
} from "lucide-react";
import { DEMO, signOut } from "../api/client";
import { useMe, useTheme, useWorkspaces, useLogin, type ThemeChoice } from "../lib/hooks";
import { Avatar } from "./Layout";
import { Segmented } from "./Form";
import { FeatureRequestDialog } from "./FeatureRequest";
import { Logo } from "./Logo";
import "./shell.css";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export function AppShell() {
  const login = useLogin();
  const [open, setOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "Triage",
      items: [
        { to: `/w/${login}`, label: "Overview", icon: <LayoutDashboard />, end: true },
        { to: `/w/${login}/reports`, label: "Reports", icon: <Activity /> },
      ],
    },
    {
      label: "Configure",
      items: [
        { to: `/w/${login}/checks`, label: "Checks & scoring", icon: <ListChecks /> },
        { to: `/w/${login}/destinations`, label: "Destinations", icon: <Send /> },
        { to: `/w/${login}/ai`, label: "AI model", icon: <Bot /> },
        { to: `/w/${login}/repos`, label: "Repositories", icon: <FolderGit2 /> },
      ],
    },
    { label: "Workspace", items: [{ to: `/w/${login}/audit`, label: "Audit log", icon: <ScrollText /> }] },
  ];

  return (
    <div className={`shell${open ? " nav-open" : ""}`}>
      {DEMO && (
        <div className="demo-banner">
          Demo data. Nothing here is real, and changes reset when you reload.
        </div>
      )}
      <header className="topbar">
        <button className="topbar-menu" type="button" aria-label="Open navigation" onClick={() => setOpen(true)}>
          <Menu />
        </button>
        <Logo />
      </header>

      <aside className="sidebar" aria-label="Main">
        <div className="sidebar-top">
          <WorkspaceSwitcher current={login} />
          <button className="sidebar-close" type="button" aria-label="Close navigation" onClick={() => setOpen(false)}>
            <X />
          </button>
        </div>
        <nav className="sidebar-nav">
          {groups.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-group-label">{g.label}</div>
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-item${isActive ? " is-active" : ""}`}>
                  {i.icon}
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button type="button" className="nav-item" onClick={() => setRequestOpen(true)}>
            <MessageSquarePlus />
            Request a feature
          </button>
          <ThemeSwitch />
          <UserRow />
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} aria-hidden />

      <main className="main">
        <div className="main-inner">
          <Outlet />
        </div>
      </main>
      <FeatureRequestDialog open={requestOpen} onClose={() => setRequestOpen(false)} workspace={login} />
    </div>
  );
}

function WorkspaceSwitcher({ current }: { current: string }) {
  const { data } = useWorkspaces();
  const navigate = useNavigate();
  const others = (data?.workspaces ?? []).filter((w) => w.login !== current);
  return (
    <label className="ws-switch">
      <Avatar src={DEMO ? null : `https://github.com/${current}.png?size=64`} name={current} size={26} square />
      <span className="ws-switch-text">
        <span className="ws-switch-name">{current}</span>
        <span className="ws-switch-sub">Workspace</span>
      </span>
      <ChevronsUpDown className="ws-switch-icon" aria-hidden />
      <select
        className="ws-switch-select"
        aria-label="Switch workspace"
        value={current}
        onChange={(e) => (e.target.value === "__add" ? navigate("/") : navigate(`/w/${e.target.value}`))}
      >
        <option value={current}>{current}</option>
        {others.map((w) => (
          <option key={w.login} value={w.login}>
            {w.login}
          </option>
        ))}
        <option value="__add">Add an organization…</option>
      </select>
    </label>
  );
}

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-row">
      <span className="theme-label">Theme</span>
      <Segmented<ThemeChoice>
        size="sm"
        label="Theme"
        value={theme}
        onChange={setTheme}
        options={[
          { value: "system", label: "", icon: <Monitor />, title: "Match system" },
          { value: "light", label: "", icon: <Sun />, title: "Light" },
          { value: "dark", label: "", icon: <Moon />, title: "Dark" },
        ]}
      />
    </div>
  );
}

function UserRow() {
  const { data } = useMe();
  const navigate = useNavigate();
  if (!data) return null;
  const u = data.user;
  return (
    <div className="user-row">
      <Avatar src={u.avatarUrl} name={u.login} size={24} />
      <span className="user-name">{u.name ?? u.login}</span>
      <button
        type="button"
        className="user-signout"
        aria-label="Sign out"
        title="Sign out"
        onClick={async () => {
          await signOut();
          navigate("/signin");
        }}
      >
        <LogOut />
      </button>
    </div>
  );
}
