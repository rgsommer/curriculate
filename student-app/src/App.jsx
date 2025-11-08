// dashboard/src/App.jsx (shortened to show the idea)
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL;
const socket = io(API_URL);

export default function App() {
  const [roomCode, setRoomCode] = useState("GRADE8A");
  const [taskSets, setTaskSets] = useState([]);
  const [selectedTaskSet, setSelectedTaskSet] = useState(null);

  // fetch task sets the teacher owns
  useEffect(() => {
    // TODO: add auth header when you have login
    fetch(`${API_URL}/tasksets/mine`)
      .then(r => r.json())
      .then(data => setTaskSets(data))
      .catch(() => setTaskSets([]));
  }, []);

  const launchTask = (task) => {
    socket.emit("teacherLaunchTask", {
      roomCode,
      task
    });
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Teacher Live</h1>
      <label>Room code</label>
      <input value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} />

      <h2>Your task sets</h2>
      <select onChange={e => {
        const ts = taskSets.find(t => t._id === e.target.value);
        setSelectedTaskSet(ts);
      }}>
        <option value="">Choose…</option>
        {taskSets.map(ts => (
          <option key={ts._id} value={ts._id}>{ts.title}</option>
        ))}
      </select>

      {selectedTaskSet && (
        <>
          <h3>Tasks in this set</h3>
          {selectedTaskSet.tasks.map((t, idx) => (
            <div key={idx} style={{ border: "1px solid #eee", padding: 8, marginBottom: 6 }}>
              <p><strong>{t.prompt}</strong></p>
              <button onClick={() => launchTask(t)}>Launch this task</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
