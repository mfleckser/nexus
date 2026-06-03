import { SidebarIcon, Home as HomeIcon, FolderKanban } from "lucide-react";
import { useState } from "react"
import { Link } from "react-router-dom"
import logo from "./assets/logo.png"
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
                <Link to="/" className="sidebar-link">
                    <HomeIcon size={18} className="sidebar-link-icon" />
                    <span className="sidebar-link-label">Home</span>
                </Link>
                <Link to="/projects" className="sidebar-link">
                    <FolderKanban size={18} className="sidebar-link-icon" />
                    <span className="sidebar-link-label">Projects</span>
                </Link>
            </nav>
        </aside>
    )
}

export default Sidebar
