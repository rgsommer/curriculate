import React, { useState } from "react";

export default function PhotoTask({ task, onSubmit, disabled }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [file, setFile] = useState(null);

  const onFileChange = (e) => {
    if (disabled) return;
    const f = e.target.files[0];
    if (f) {
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
    }
  };

  const handleSubmit = async () => {
    if (!file) return;

    // For now, send as base64; you can swap this for a direct upload endpoint.
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result;
      onSubmit({ base64 });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="p-4">
      <h2 className="font-bold text-xl mb-3">{task.prompt}</h2>
      <p className="mb-3 text-sm text-gray-600">
        {task.config?.requirements || "Take a photo that matches the instructions."}
      </p>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFileChange}
        disabled={disabled}
        className="mb-3"
      />

      {previewUrl && (
        <div className="mb-3">
          <img src={previewUrl} alt="preview" className="max-h-64 mx-auto" />
        </div>
      )}

      <button
        className="w-full border rounded px-3 py-2 font-bold"
        onClick={handleSubmit}
        disabled={disabled || !file}
      >
        Submit Photo
      </button>
    </div>
  );
}
