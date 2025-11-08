import React, { useEffect, useState } from "react";
import LiveSession from "./pages/LiveSession.jsx";

const SOCKET_URL = import.meta.env.VITE_API_URL;
const socket = io(SOCKET_URL);

export default function App() {
  return <LiveSession />;
}
