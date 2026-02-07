// teacher-app/src/components/RoomPicker.jsx
import React, { useContext, useEffect, useState } from "react";
import { RoomContext } from "../RoomContext.jsx";

export default function RoomPicker() {
  const { roomCode, setRoom } = useContext(RoomContext);
  const [val, setVal] = useState(roomCode);

  // keep the input in sync when the context changes (e.g. from another tab)
  useEffect(() => setVal(roomCode), [roomCode]);

  const handleChange = (e) => {
    const v = e.target.value.toUpperCase();
    setVal(v);
    setRoom(v);
  };

  return (
    <div>
      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 4 }}>
        Room code
      </label>
      <input
        value={val}
        onChange={handleChange}
        placeholder="GRADE8A"
        style={{
          padding: 6,
          width: "100%",
          border: "1px solid #cbd5f5",
          borderRadius: 6,
        }}
      />
    </div>
  );
}