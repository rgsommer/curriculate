// src/components/TeacherLayout.jsx
import React from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const tierColors = {
  FREE: "bg-gray-200 text-gray-800",
  PLUS: "bg-blue-100 text-blue-800",
  PRO: "bg-yellow-100 text-yellow-800",
};

export default function TeacherLayout({ children }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-64 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <h1 className="font-bold text-lg">Curriculate Teacher</h1>
          {user && (
            <div className="mt-2 text-sm">
              <div>{user.name}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-500">{user.email}</span>
              </div>
              <div className="mt-1">
                <span
                  className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                    tierColors[user.subscriptionTier] ||
                    "bg-gray-200 text-gray-800"
                  }`}
                >
                  {user.subscriptionTier} plan
                </span>
              </div>
            </div>
          )}
        </div>
        <nav className="flex-1 p-3 space-y-1 text-sm">
          <NavLink
            to="/analytics"
            className={({ isActive }) =>
              `block px-3 py-2 rounded ${
                isActive ? "bg-gray-900 text-white" : "hover:bg-gray-100"
              }`
            }
          >
            Analytics
          </NavLink>
          <NavLink
            to="/tasksets/generator"
            className={({ isActive }) =>
              `block px-3 py-2 rounded ${
                isActive ? "bg-gray-900 text-white" : "hover:bg-gray-100"
              }`
            }
          >
            Taskset Generator
          </NavLink>
          <NavLink
            to="/tasksets/mine"
            className={({ isActive }) =>
              `block px-3 py-2 rounded ${
                isActive ? "bg-gray-900 text-white" : "hover:bg-gray-100"
              }`
            }
          >
            My Tasksets
          </NavLink>
        </nav>
        <div className="p-3 border-t">
          <button
            onClick={logout}
            className="w-full text-sm border rounded px-3 py-1 hover:bg-gray-100"
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  );
}
