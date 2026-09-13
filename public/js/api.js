// Thin wrappers over the existing backend pipeline endpoints.
// No new services are called here — /process and /speak are the only routes used.

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_) {
    return {};
  }
}

export async function processAudio(blob) {
  const formData = new FormData();
  formData.append("audio", blob, "recording.wav");

  const response = await fetch("/process", { method: "POST", body: formData });
  const data = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(data.error || `Processing failed (${response.status}).`);
  }

  return data;
}

export async function speakText(text) {
  const response = await fetch("/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(data.error || `Speech synthesis failed (${response.status}).`);
  }

  return data;
}
