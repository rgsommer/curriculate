// src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import TeacherLayout from "./components/TeacherLayout";
import AnalyticsOverview from "./pages/AnalyticsOverview";
import SessionAnalyticsPage from "./pages/SessionAnalyticsPage";
import TasksetGeneratorPage from "./pages/TasksetGeneratorPage";
import TasksetListPage from "./pages/TasksetListPage";

function ProtectedTeacherApp() {
  const { user, loading } = useAuth();

  if (loading) return <div className="p-4">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <TeacherLayout>
      <Routes>
        <Route path="/analytics" element={<AnalyticsOverview />} />
        <Route
          path="/analytics/sessions/:id"
          element={<SessionAnalyticsPage />}
        />
        <Route
          path="/tasksets/generator"
          element={<TasksetGeneratorPage />}
        />
        <Route path="/tasksets/mine" element={<TasksetListPage />} />
        <Route path="*" element={<Navigate to="/analytics" replace />} />
      </Routes>
    </TeacherLayout>
  );
}

function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Login failed.");
    }
  };

  if (user) return <Navigate to="/analytics" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white border rounded-lg p-6 w-full max-w-sm space-y-3"
      >
        <h1 className="text-xl font-bold">Curriculate Teacher Login</h1>
        <div className="text-xs text-gray-500">
          (In dev, seed a user in MongoDB with a password hash.)
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">Email</label>
          <input
            type="email"
            className="w-full border rounded px-3 py-1 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">Password</label>
          <input
            type="password"
            className="w-full border rounded px-3 py-1 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <button
          type="submit"
          className="w-full text-sm border rounded px-3 py-2 bg-gray-900 text-white hover:bg-black"
        >
          Log in
        </button>
      </form>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<ProtectedTeacherApp />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
