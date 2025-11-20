import React, { useState } from "react";

export default function MakeAndSnapTask({ task, onSubmit, disabled }) {
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

  const handleSubmit = () => {
    if (!file) return;
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
        {task.config?.rubric
          ? `Build it first, then snap a photo. Rubric: ${task.config.rubric.join(", ")}`
          : "Build or create what is described, then take a picture."}
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
        Submit
      </button>
    </div>
  );
}
