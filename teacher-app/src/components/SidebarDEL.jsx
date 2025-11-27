// teacher-app/src/components/Sidebar.jsx
import React, { useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import { RoomContext } from "../RoomContext.jsx";
import { Play, Monitor, FileText } from "lucide-react";

export default function Sidebar() {
  const location = useLocation();
  const { roomCode, setRoom } = useContext(RoomContext);

  const navItems = [
    { to: "/live", icon: Play, label: "Live Session" },
    { to: "/host", icon: Monitor, label: "Host View" },
    { to: "/tasksets", icon: FileText, label: "Task Sets" },
  ];

  // Removed TypeScript: no `path: string`
  const isActive = (path) => location.pathname === path;

  return (
    <aside className="w-64 bg-white border-r border-gray-200 h-screen p-6 flex flex-col">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-blue-600">Curriculate</h1>
      </div>

      {/* Room Code Input */}
      <div className="mb-6">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Room code
        </label>
        <input
          value={roomCode}
          onChange={(e) => setRoom(e.target.value.toUpperCase())}
          placeholder="GRADE8A"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Navigation */}
      <nav className="space-y-1 flex-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all ${
              isActive(to)
                ? "bg-blue-600 text-white shadow-md"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-auto pt-6 border-t border-gray-200">
        <p className="text-xs text-gray-500 text-center">© 2025 Curriculate</p>
      </div>
    </aside>
  );
}