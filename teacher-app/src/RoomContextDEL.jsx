// teacher-app/src/RoomContext.jsx
import React, { createContext, useState, useEffect } from "react";

export const RoomContext = createContext({
  roomCode: "",
  setRoom: () => {},
});

export function RoomProvider({ children }) {
  const [roomCode, setRoomCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("curriculate-room") || "";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (roomCode) {
      localStorage.setItem("curriculate-room", roomCode);
    } else {
      localStorage.removeItem("curriculate-room");
    }
  }, [roomCode]);

  const setRoom = (code) => {
    setRoomCode((code || "").toUpperCase());
  };

  return (
    <RoomContext.Provider value={{ roomCode, setRoom }}>
      {children}
    </RoomContext.Provider>
  );
}
