import { SidebarIcon, Home as HomeIcon, FolderKanban, Dumbbell, CircleDollarSign, Bot } from "lucide-react";
import { useState } from "react"
import { Link, NavLink } from "react-router-dom"
import logo from "@renderer/assets/logo.png"
import "./sidebar.css"

function Sidebar(): React.JSX.Element {
    const [shown, setShown] = useState(false);

    return (
        <aside className={`sidebar ${shown ? "expanded" : "collapsed"}`}>
            <div className="sidebar-top">
                {shown && <div className="sidebar-brand">
                    <img src={logo} alt="Nexus logo" className="sidebar-logo" />
                    <span className="sidebar-title">Nexus</span>
                </div>}
                <button
                    type="button"
                    className="sidebar-toggle"
                    aria-label="Toggle sidebar"
                    onClick={() => setShown(prev => !prev)}
                >
                    <SidebarIcon size={18} />
                </button>
            </div>
            <nav className="sidebar-nav">
                <NavLink to="/" end className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
                    <HomeIcon size={18} className="sidebar-link-icon" />
                    <span className="sidebar-link-label">Home</span>
                </NavLink>
                <NavLink to="/projects" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
                    <FolderKanban size={18} className="sidebar-link-icon" />
                    <span className="sidebar-link-label">Projects</span>
                </NavLink>
                <Link to="/" className="sidebar-link">
                    <Dumbbell size={18} className="sidebar-link-icon" />
                    <span className="sidebar-link-label">Fitness</span>
                </Link>
                <Link to="/" className="sidebar-link">
                    <CircleDollarSign size={18} className="sidebar-link-icon" />
                    <span className="sidebar-link-label">Finances</span>
                </Link>
                <Link to="/" className="sidebar-link">
                    <Bot size={18} className="sidebar-link-icon" />
                    <span className="sidebar-link-label">AI Assistance</span>
                </Link>
            </nav>
        </aside>
    )
}

export default Sidebar
